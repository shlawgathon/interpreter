"""
Interpreter Backend — FastAPI WebSocket Server
Handles: Audio → STT/Translation → TTS → Audio
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.speechmatics_client import SpeechmaticsClient
from services.minimax_client import MinimaxClient, get_language_name
from services.speechmatics_tts_client import SpeechmaticsTTSClient

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


class VoiceProfileRequest(BaseModel):
    userId: str
    audio: str  # base64-encoded audio
    format: str = "webm"


@app.post("/api/voice-profile")
async def create_voice_profile(req: VoiceProfileRequest):
    """
    Create a voice profile by uploading audio to MiniMax file upload API.
    Returns the MiniMax file_id which can be used for voice clone TTS.
    """
    import base64
    import io

    minimax_key = os.getenv("MINIMAX_API_KEY", "")
    minimax_group_id = os.getenv("MINIMAX_GROUP_ID", "")

    if not minimax_key:
        raise ValueError("MINIMAX_API_KEY is required")

    # Decode base64 audio
    audio_bytes = base64.b64decode(req.audio)
    logger.info(
        "Uploading voice sample for user %s (%d bytes, format=%s)",
        req.userId, len(audio_bytes), req.format,
    )

    # Upload to MiniMax file upload API
    ext = req.format if req.format in {"mp3", "m4a", "wav", "webm"} else "wav"
    upload_url = f"https://api.minimax.io/v1/files/upload?GroupId={minimax_group_id}"
    headers = {"Authorization": f"Bearer {minimax_key}"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            files = {"file": (f"voice_sample.{ext}", io.BytesIO(audio_bytes))}
            data = {"purpose": "voice_clone"}
            resp = await client.post(upload_url, headers=headers, data=data, files=files)
            logger.info("MiniMax file upload status=%s body=%s", resp.status_code, resp.text)
            resp.raise_for_status()
            result = resp.json()
    except httpx.HTTPStatusError as e:
        logger.error("MiniMax upload HTTP error %s: %s", e.response.status_code, e.response.text)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=502, content={"error": f"MiniMax API error: {e.response.status_code}", "detail": e.response.text})
    except Exception as e:
        logger.error("MiniMax upload failed: %s", e)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e)})

    # MiniMax may return file_id at top level or nested under "file"
    file_id = result.get("file_id") or (result.get("file") or {}).get("file_id")
    if not file_id:
        logger.error("MiniMax file upload response missing file_id: %s", result)
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=502, content={"error": "No file_id in MiniMax response", "detail": str(result)})

    file_id = str(file_id)
    logger.info("MiniMax file uploaded for user %s: file_id=%s", req.userId, file_id)
    return {"voiceProfileId": file_id}


async def lookup_voice_profile(user_id: str) -> dict | None:
    """
    Query Convex HTTP API to fetch a user's voice profile.
    Returns profile dict with voiceProfileId, voiceProfileStatus, language
    or None if not found or on error.
    """
    convex_site_url = os.getenv("CONVEX_SITE_URL", "").rstrip("/")
    if not convex_site_url or not user_id:
        return None

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{convex_site_url}/api/voice-profile",
                params={"userId": user_id},
            )
            if resp.status_code == 200:
                profile = resp.json()
                logger.info(
                    "Convex voice profile for %s: status=%s, voiceProfileId=%s",
                    user_id,
                    profile.get("voiceProfileStatus"),
                    profile.get("voiceProfileId"),
                )
                return profile
            elif resp.status_code == 404:
                logger.info("No Convex profile found for user %s", user_id)
                return None
            else:
                logger.warning(
                    "Convex profile lookup failed: %d %s",
                    resp.status_code,
                    resp.text,
                )
                return None
    except Exception as e:
        logger.error("Convex profile lookup error: %s", e)
        return None


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
      - Binary: translated audio (audio bytes from selected TTS provider)
    """
    await ws.accept()
    logger.info("Client connected")

    source_lang = "en"
    target_lang = "es"

    speechmatics_key = os.getenv("SPEECHMATICS_API_KEY", "")
    minimax_key = os.getenv("MINIMAX_API_KEY", "")
    minimax_group_id = os.getenv("MINIMAX_GROUP_ID", "")
    use_speechmatics_translation = os.getenv(
        "USE_SPEECHMATICS_TRANSLATION", "1"
    ).strip().lower() not in {"0", "false", "no"}
    tts_provider = os.getenv("TTS_PROVIDER", "speechmatics").strip().lower() or "speechmatics"
    translation_trigger_chars = int(
        os.getenv("TRANSLATION_TRIGGER_CHAR_THRESHOLD", "24")
    )
    translation_partial_min_delta_chars = int(
        os.getenv("TRANSLATION_PARTIAL_MIN_DELTA_CHARS", "12")
    )
    translation_partial_min_interval = (
        int(os.getenv("TRANSLATION_PARTIAL_MIN_INTERVAL_MS", "300")) / 1000.0
    )

    speechmatics: SpeechmaticsClient | None = None
    minimax = MinimaxClient(api_key=minimax_key, group_id=minimax_group_id)
    speechmatics_tts = SpeechmaticsTTSClient(api_key=speechmatics_key)
    connection_open = True

    # Voice profile for clone TTS (set via Convex lookup on config)
    user_voice_id: str | None = None

    # Buffer for accumulating transcript before translation
    transcript_buffer = ""
    translation_lock = asyncio.Lock()
    translation_queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=1)
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
        # Keep queue low-latency by dropping stale pending items.
        while not translation_queue.empty():
            try:
                translation_queue.get_nowait()
                translation_queue.task_done()
            except asyncio.QueueEmpty:
                break
        await translation_queue.put(text.strip())

    async def translation_worker() -> None:
        while True:
            item = await translation_queue.get()
            try:
                if item is None:
                    return
                if use_speechmatics_translation:
                    await speak_translated_text(item)
                else:
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
                if use_speechmatics_translation:
                    return

                transcript_buffer += " " + text.strip()

                # Translate when we have enough text (sentence-ish)
                if (
                    len(transcript_buffer) > translation_trigger_chars
                    or transcript_buffer.rstrip().endswith((".", "!", "?", "。", "！", "？"))
                ):
                    await enqueue_translation(transcript_buffer.strip())
                    transcript_buffer = ""
        except (ConnectionError, RuntimeError) as e:
            logger.error("Error in on_transcript: %s", e)

    async def on_translation(text: str, is_final: bool):
        """Called when Speechmatics produces translated text."""
        if not connection_open:
            return

        try:
            if is_final:
                sent = await safe_send_json({
                    "type": "translated_text",
                    "text": text,
                })
                if not sent:
                    return
                await enqueue_translation(text)
            else:
                await safe_send_json({
                    "type": "translated_text_partial",
                    "text": text,
                })
        except (ConnectionError, RuntimeError) as e:
            logger.error("Error in on_translation: %s", e)

    async def synthesize_tts(translated_text: str) -> bytes | None:
        # If user has a voice clone profile (MiniMax file_id), try clone TTS first
        if user_voice_id:
            try:
                audio_data = await minimax.voice_clone_tts(
                    text=translated_text,
                    file_id=user_voice_id,
                )
                if audio_data:
                    logger.info("[TTS] Used MiniMax voice clone (file_id=%s)", user_voice_id)
                    return audio_data
            except Exception as e:
                logger.warning(
                    "MiniMax voice clone TTS failed, falling back to standard: %s", e
                )

        # Primary: Speechmatics TTS
        audio_data = await speechmatics_tts.text_to_speech(
            text=translated_text,
            language=target_lang,
        )
        if audio_data:
            return audio_data

        logger.warning(
            "Speechmatics TTS returned no audio for target language '%s'; "
            "falling back to MiniMax TTS.",
            target_lang,
        )

        # Fallback: MiniMax standard TTS
        return await minimax.text_to_speech(
            text=translated_text,
            language=target_lang,
        )

    async def speak_translated_text(translated_text: str):
        """Generate and send TTS audio from already-translated text."""
        async with translation_lock:
            if not connection_open or not translated_text.strip():
                return

            try:
                logger.info("[Translate] (Speechmatics) → %s", translated_text)

                audio_data = await synthesize_tts(translated_text)
                if audio_data:
                    sent = await safe_send_bytes(audio_data)
                    if sent:
                        logger.info("[TTS] Sent %d bytes of audio", len(audio_data))
            except (httpx.HTTPStatusError, ConnectionError, ValueError) as e:
                logger.error("TTS error: %s", e)
                await safe_send_json({
                    "type": "error",
                    "message": str(e),
                })

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
                last_partial_emit_at = 0.0
                last_partial_emit_len = 0
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
                        now = time.monotonic()
                        delta_len = len(translated) - last_partial_emit_len
                        should_emit_partial = (
                            delta_len >= translation_partial_min_delta_chars
                            or (now - last_partial_emit_at) >= translation_partial_min_interval
                            or translated.endswith((".", "!", "?", "。", "！", "？"))
                        )
                        if should_emit_partial:
                            sent = await safe_send_json({
                                "type": "translated_text_partial",
                                "text": translated,
                            })
                            if not sent:
                                return
                            last_partial_emit_at = now
                            last_partial_emit_len = len(translated)

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
                audio_data = await synthesize_tts(translated)

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
                    requested_tts_provider = str(msg.get("tts_provider", "")).strip().lower()
                    if requested_tts_provider in {"minimax", "speechmatics"}:
                        tts_provider = requested_tts_provider
                    logger.info("Config: %s → %s", source_lang, target_lang)
                    logger.info(
                        "Translation provider: %s",
                        "Speechmatics" if use_speechmatics_translation else "MiniMax",
                    )
                    logger.info("TTS provider: %s", tts_provider)

                    # Look up voice profile from Convex if user_id provided
                    config_user_id = msg.get("user_id", "")
                    if config_user_id:
                        profile = await lookup_voice_profile(config_user_id)
                        if (
                            profile
                            and profile.get("voiceProfileStatus") == "ready"
                            and profile.get("voiceProfileId")
                        ):
                            user_voice_id = profile["voiceProfileId"]
                            logger.info(
                                "Using voice profile %s for user %s",
                                user_voice_id,
                                config_user_id,
                            )
                        else:
                            user_voice_id = None
                            logger.info(
                                "No ready voice profile for user %s, using default",
                                config_user_id,
                            )

                    # Initialize Speechmatics with the source language
                    if speechmatics:
                        await speechmatics.close()

                    speechmatics = SpeechmaticsClient(
                        api_key=speechmatics_key,
                        language=source_lang,
                        target_language=target_lang if use_speechmatics_translation else None,
                        on_transcript=on_transcript,
                        on_translation=on_translation if use_speechmatics_translation else None,
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
            while not translation_queue.empty():
                try:
                    translation_queue.get_nowait()
                    translation_queue.task_done()
                except asyncio.QueueEmpty:
                    break
            await translation_queue.put(None)
            try:
                await translation_worker_task
            except asyncio.CancelledError:
                pass

        if speechmatics:
            await speechmatics.close()
        await speechmatics_tts.close()
        await minimax.close()
        logger.info("Session cleaned up")
