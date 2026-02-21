"""
Interpreter Backend — FastAPI WebSocket Server
Handles: Audio → Speechmatics STT → MiniMax Translation → MiniMax TTS → Audio
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from services.speechmatics_client import SpeechmaticsClient
from services.minimax_client import MinimaxClient, get_language_name

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("interpreter")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan context manager."""
    logger.info("Interpreter backend starting...")
    yield
    logger.info("Interpreter backend shutting down.")


app = FastAPI(title="Interpreter Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "interpreter-backend"}


@app.websocket("/ws/translate")
async def websocket_translate(ws: WebSocket):
    """
    Main translation WebSocket endpoint.

    Protocol:
    - Client sends JSON config first: { type: "config", source_lang, target_lang }
    - Client sends binary PCM audio chunks (16kHz, mono, int16)
    - Server sends back:
      - JSON: { type: "transcript", text: "...", is_final: bool }
      - JSON: { type: "translated_text", text: "..." }
      - Binary: translated audio (MP3 from MiniMax TTS)
    """
    await ws.accept()
    logger.info("Client connected")

    source_lang = "en"
    target_lang = "es"

    speechmatics_key = os.getenv("SPEECHMATICS_API_KEY", "")
    minimax_key = os.getenv("MINIMAX_API_KEY", "")
    minimax_group_id = os.getenv("MINIMAX_GROUP_ID", "")

    speechmatics: SpeechmaticsClient | None = None
    minimax = MinimaxClient(api_key=minimax_key, group_id=minimax_group_id)

    # Buffer for accumulating transcript before translation
    transcript_buffer = ""
    translation_lock = asyncio.Lock()

    async def on_transcript(text: str, is_final: bool):
        """Called when Speechmatics produces a transcript segment."""
        nonlocal transcript_buffer

        try:
            # Send transcript to client
            await ws.send_json({
                "type": "transcript",
                "text": text,
                "is_final": is_final,
            })

            if is_final and text.strip():
                transcript_buffer += " " + text.strip()

                # Translate when we have enough text (sentence-ish)
                if (
                    len(transcript_buffer) > 20
                    or transcript_buffer.rstrip().endswith((".", "!", "?", "。", "！", "？"))
                ):
                    await translate_and_speak(transcript_buffer.strip())
                    transcript_buffer = ""
        except (ConnectionError, RuntimeError) as e:
            logger.error("Error in on_transcript: %s", e)

    async def translate_and_speak(text: str):
        """Translate text and send back TTS audio."""
        async with translation_lock:
            try:
                # Step 1: Translate via MiniMax LLM
                src_name = get_language_name(source_lang)
                tgt_name = get_language_name(target_lang)

                translated = await minimax.translate(
                    text=text,
                    source_language=src_name,
                    target_language=tgt_name,
                )

                if not translated:
                    return

                # Send translated text to client
                await ws.send_json({
                    "type": "translated_text",
                    "text": translated,
                })

                logger.info("[Translate] %s → %s", text, translated)

                # Step 2: TTS via MiniMax Speech
                audio_data = await minimax.text_to_speech(
                    text=translated,
                    language=target_lang,
                )

                if audio_data:
                    # Send binary audio back
                    await ws.send_bytes(audio_data)
                    logger.info("[TTS] Sent %d bytes of audio", len(audio_data))

            except (httpx.HTTPStatusError, ConnectionError, ValueError) as e:
                logger.error("Translation/TTS error: %s", e)
                await ws.send_json({
                    "type": "error",
                    "message": str(e),
                })

    try:
        while True:
            data = await ws.receive()

            if "text" in data:
                # JSON message
                msg = json.loads(data["text"])

                if msg.get("type") == "config":
                    source_lang = msg.get("source_lang", "en")
                    target_lang = msg.get("target_lang", "es")
                    logger.info("Config: %s → %s", source_lang, target_lang)

                    # Initialize Speechmatics with the source language
                    if speechmatics:
                        await speechmatics.close()

                    speechmatics = SpeechmaticsClient(
                        api_key=speechmatics_key,
                        language=source_lang,
                        on_transcript=on_transcript,
                    )
                    await speechmatics.connect()
                    logger.info("Speechmatics connected")

            elif "bytes" in data:
                # Binary PCM audio — forward to Speechmatics
                if speechmatics and speechmatics.is_connected:
                    await speechmatics.send_audio(data["bytes"])

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except RuntimeError as e:
        logger.error("WebSocket error: %s", e)
    finally:
        # Flush remaining transcript buffer
        if transcript_buffer.strip():
            await translate_and_speak(transcript_buffer.strip())

        if speechmatics:
            await speechmatics.close()
        logger.info("Session cleaned up")
