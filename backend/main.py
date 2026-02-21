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
    connection_open = True

    # Buffer for accumulating transcript before translation
    transcript_buffer = ""
    translation_lock = asyncio.Lock()
    translation_queue: asyncio.Queue[str | None] = asyncio.Queue()
    translation_worker_task: asyncio.Task | None = None

    async def safe_send_json(payload: dict) -> bool:
        nonlocal connection_open
        if not connection_open:
            return False
        try:
            await ws.send_json(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            connection_open = False
            return False

    async def safe_send_bytes(payload: bytes) -> bool:
        nonlocal connection_open
        if not connection_open:
            return False
        try:
            await ws.send_bytes(payload)
            return True
        except (WebSocketDisconnect, RuntimeError):
            connection_open = False
            return False

    async def enqueue_translation(text: str) -> None:
        if not text.strip() or not connection_open:
            return
        await translation_queue.put(text.strip())

    async def translation_worker() -> None:
        while True:
            item = await translation_queue.get()
            try:
                if item is None:
                    return
                await translate_and_speak(item)
            finally:
                translation_queue.task_done()

    async def on_transcript(text: str, is_final: bool):
        """Called when Speechmatics produces a transcript segment."""
        nonlocal transcript_buffer

        if not connection_open:
            return

        try:
            # Send transcript to client
            sent = await safe_send_json({
                "type": "transcript",
                "text": text,
                "is_final": is_final,
            })
            if not sent:
                return

            if is_final and text.strip():
                transcript_buffer += " " + text.strip()

                # Translate when we have enough text (sentence-ish)
                if (
                    len(transcript_buffer) > 20
                    or transcript_buffer.rstrip().endswith((".", "!", "?", "。", "！", "？"))
                ):
                    await enqueue_translation(transcript_buffer.strip())
                    transcript_buffer = ""
        except (ConnectionError, RuntimeError) as e:
            logger.error("Error in on_transcript: %s", e)

    async def translate_and_speak(text: str):
        """Translate text and send back TTS audio."""
        async with translation_lock:
            if not connection_open or not text.strip():
                return
            try:
                # Step 1: Translate via MiniMax LLM
                src_name = get_language_name(source_lang)
                tgt_name = get_language_name(target_lang)

                translated_chunks: list[str] = []
                translated = ""
                async for chunk in minimax.translate_stream(
                    text=text,
                    source_language=src_name,
                    target_language=tgt_name,
                ):
                    if not connection_open:
                        return
                    translated_chunks.append(chunk)
                    translated = "".join(translated_chunks).strip()
                    if translated:
                        sent = await safe_send_json({
                            "type": "translated_text_partial",
                            "text": translated,
                        })
                        if not sent:
                            return

                # Fallback if streaming returned no text.
                if not translated:
                    translated = await minimax.translate(
                        text=text,
                        source_language=src_name,
                        target_language=tgt_name,
                    ) or ""
                translated = translated.strip()

                if not translated:
                    return

                # Send translated text to client
                sent = await safe_send_json({
                    "type": "translated_text",
                    "text": translated,
                })
                if not sent:
                    return

                logger.info("[Translate] %s → %s", text, translated)

                # Step 2: TTS via MiniMax Speech
                audio_data = await minimax.text_to_speech(
                    text=translated,
                    language=target_lang,
                )

                if audio_data:
                    # Send binary audio back
                    sent = await safe_send_bytes(audio_data)
                    if sent:
                        logger.info("[TTS] Sent %d bytes of audio", len(audio_data))

            except (httpx.HTTPStatusError, ConnectionError, ValueError) as e:
                logger.error("Translation/TTS error: %s", e)
                await safe_send_json({
                    "type": "error",
                    "message": str(e),
                })

    try:
        translation_worker_task = asyncio.create_task(translation_worker())

        while True:
            data = await ws.receive()
            if data.get("type") == "websocket.disconnect":
                connection_open = False
                break

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
        connection_open = False
        logger.info("Client disconnected")
    except RuntimeError as e:
        connection_open = False
        logger.error("WebSocket error: %s", e)
    finally:
        connection_open = False

        if translation_worker_task:
            await translation_queue.put(None)
            try:
                await translation_worker_task
            except asyncio.CancelledError:
                pass

        if speechmatics:
            await speechmatics.close()
        await minimax.close()
        logger.info("Session cleaned up")
