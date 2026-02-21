"""
MiniMax Client — Translation + TTS

Translation: Chat completions API with streaming
TTS: T2A v2 API with streaming
"""

import asyncio
import json
import logging
import os
from typing import AsyncGenerator, Optional

import httpx
import websockets

logger = logging.getLogger("interpreter.minimax")

# MiniMax API endpoints (current official domain)
CHAT_URL = "https://api.minimax.io/v1/text/chatcompletion_v2"
TTS_WS_URL = "wss://api.minimax.io/ws/v1/t2a_v2"

DEFAULT_TEXT_MODEL = "MiniMax-M2"
DEFAULT_TTS_MODEL = "speech-2.8-turbo"

# Language name mapping for translation prompts
LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "zh": "Chinese (Mandarin)",
    "ja": "Japanese",
    "ko": "Korean",
    "ar": "Arabic",
    "hi": "Hindi",
    "ru": "Russian",
    "nl": "Dutch",
    "sv": "Swedish",
    "pl": "Polish",
    "tr": "Turkish",
}

# MiniMax official system voices (speech-2.8-turbo).
# Source: https://platform.minimax.io/docs/guides/speech-t2a-websocket
DEFAULT_VOICE_ID = "English_expressive_narrator"
VOICE_MAP = {
    "en": "English_expressive_narrator",
    "es": "Spanish_SereneWoman",
    "fr": "French_FemaleAnchor",
    "de": "German_FriendlyMan",
    "it": "Italian_Narrator",
    "pt": "Portuguese_Narrator",
    "zh": "Arrogant_Miss",
    "ja": "Japanese_CalmLady",
    "ko": "Korean_CalmLady",
    "ar": "Arabic_CalmWoman",
    "hi": "hindi_female_1_v2",
    "ru": "Russian_ReliableMan",
    "nl": "Dutch_kindhearted_girl",
    # No Swedish voice listed in current system voices, fallback to English.
    "sv": DEFAULT_VOICE_ID,
    "pl": "Polish_female_1_sample1",
    "tr": "Turkish_CalmWoman",
}


def get_language_name(code: str) -> str:
    """Get the full language name for a language code."""
    return LANGUAGE_NAMES.get(code, code)


class MinimaxClient:
    """Async client for MiniMax translation and TTS."""

    def __init__(self, api_key: str, group_id: str):
        self.api_key = api_key
        self.group_id = group_id
        self.text_model = os.getenv("MINIMAX_TEXT_MODEL", DEFAULT_TEXT_MODEL)
        self.tts_model = os.getenv("MINIMAX_TTS_MODEL", DEFAULT_TTS_MODEL)
        self.tts_voice_override = os.getenv("MINIMAX_TTS_VOICE_ID", "").strip()
        self.client = httpx.AsyncClient(timeout=30.0)

    @property
    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def translate(
        self,
        text: str,
        source_language: str,
        target_language: str,
    ) -> Optional[str]:
        """
        Translate text using MiniMax M2.5 chat API.
        Uses a carefully engineered system prompt for fast, accurate translation.
        """
        if not text.strip():
            return None

        system_prompt = (
            f"You are a real-time interpreter translating "
            f"from {source_language} to {target_language}. "
            f"Translate the following spoken text naturally and accurately. "
            f"Preserve the speaker's tone, intent, and emotional nuance. "
            f"Output ONLY the translation, nothing else. No explanations, no quotes."
        )

        payload = {
            "model": self.text_model,
            "messages": [
                {"role": "system", "name": "system", "content": system_prompt},
                {"role": "user", "name": "user", "content": text},
            ],
            "temperature": 0.3,
            "stream": False,
        }

        try:
            resp = await self.client.post(
                CHAT_URL,
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            # Extract text from response
            choices = data.get("choices", [])
            if choices:
                message = choices[0].get("message", {})
                translated = message.get("content", "").strip()
                return translated

            logger.warning("No choices in MiniMax response: %s", data)
            return None

        except httpx.HTTPStatusError as e:
            logger.error(
                "MiniMax translation HTTP error: %s - %s",
                e.response.status_code, e.response.text,
            )
            raise
        except (ConnectionError, ValueError) as e:
            logger.error("MiniMax translation error: %s", e)
            raise

    async def translate_stream(
        self,
        text: str,
        source_language: str,
        target_language: str,
    ) -> AsyncGenerator[str, None]:
        """
        Stream translated text chunks from MiniMax.
        Yields incremental text deltas as they arrive.
        """
        if not text.strip():
            return

        system_prompt = (
            f"You are a real-time interpreter translating "
            f"from {source_language} to {target_language}. "
            f"Translate the following spoken text naturally and accurately. "
            f"Preserve the speaker's tone, intent, and emotional nuance. "
            f"Output ONLY the translation, nothing else. No explanations, no quotes."
        )

        payload = {
            "model": self.text_model,
            "messages": [
                {"role": "system", "name": "system", "content": system_prompt},
                {"role": "user", "name": "user", "content": text},
            ],
            "temperature": 0.3,
            "stream": True,
        }

        try:
            translated_so_far = ""
            async with self.client.stream(
                "POST",
                CHAT_URL,
                headers=self._headers,
                json=payload,
            ) as resp:
                resp.raise_for_status()

                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if not line or line == "[DONE]":
                        continue

                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    piece = self._extract_text_piece(chunk)
                    if not piece:
                        continue

                    # Some providers stream full text snapshots; normalize to deltas.
                    if piece.startswith(translated_so_far):
                        delta = piece[len(translated_so_far):]
                        translated_so_far = piece
                    elif translated_so_far.startswith(piece):
                        delta = ""
                    else:
                        delta = piece
                        translated_so_far += piece

                    if delta:
                        yield delta

        except httpx.HTTPStatusError as e:
            logger.error(
                "MiniMax streaming translation HTTP error: %s - %s",
                e.response.status_code, e.response.text,
            )
            raise
        except (ConnectionError, ValueError) as e:
            logger.error("MiniMax streaming translation error: %s", e)
            raise

    @staticmethod
    def _extract_text_piece(chunk: dict) -> str:
        """
        Extract text from provider chunk payloads.
        Supports both delta-style and message-style chunk schemas.
        """
        choices = chunk.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if not isinstance(first, dict):
                return ""

            delta = first.get("delta")
            if isinstance(delta, dict):
                content = delta.get("content")
                if isinstance(content, str):
                    return content

            message = first.get("message")
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str):
                    return content

            content = first.get("content")
            if isinstance(content, str):
                return content

        # Some variants use top-level fields.
        top_content = chunk.get("content")
        if isinstance(top_content, str):
            return top_content
        reply = chunk.get("reply")
        if isinstance(reply, str):
            return reply
        return ""

    async def text_to_speech(
        self,
        text: str,
        language: str = "en",
    ) -> Optional[bytes]:
        """
        Generate speech audio using MiniMax T2A WebSocket API.
        Returns MP3 audio bytes assembled from streaming chunks.
        """
        if not text.strip():
            return None

        voice_id = self._resolve_voice_id(language)
        try:
            return await self._text_to_speech_once(text=text, voice_id=voice_id)
        except ValueError as e:
            # Voice IDs can change; retry once with a known-good default voice.
            if (
                "voice id not exist" in str(e).lower()
                and voice_id != DEFAULT_VOICE_ID
            ):
                logger.warning(
                    "Voice '%s' failed; retrying TTS with fallback '%s'",
                    voice_id,
                    DEFAULT_VOICE_ID,
                )
                return await self._text_to_speech_once(
                    text=text,
                    voice_id=DEFAULT_VOICE_ID,
                )
            raise

    def _resolve_voice_id(self, language: str) -> str:
        """Resolve a TTS voice id with env overrides and language fallback."""
        if self.tts_voice_override:
            return self.tts_voice_override

        lang = (language or "en").lower()
        per_lang_override = os.getenv(f"MINIMAX_TTS_VOICE_ID_{lang.upper()}", "").strip()
        if per_lang_override:
            return per_lang_override

        return VOICE_MAP.get(lang, DEFAULT_VOICE_ID)

    async def _text_to_speech_once(self, text: str, voice_id: str) -> Optional[bytes]:
        """Single attempt at MiniMax TTS synthesis."""

        start_payload = {
            "event": "task_start",
            "model": self.tts_model,
            "language_boost": "auto",
            "voice_setting": {
                "voice_id": voice_id,
                "speed": 1.0,
                "vol": 1.0,
                "pitch": 0,
            },
            "audio_setting": {
                "sample_rate": 24000,
                "bitrate": 128000,
                "format": "mp3",
                "channel": 1,
            },
        }

        try:
            ws = await self._connect_tts_websocket()
            audio_chunks = bytearray()
            try:
                # Wait for connected_success before starting the task.
                await self._wait_for_event(
                    ws,
                    {"connected_success", "connected"},
                    timeout=10.0,
                )

                await ws.send(json.dumps(start_payload))
                await self._wait_for_event(
                    ws,
                    {"task_started", "task_start"},
                    timeout=10.0,
                )

                await ws.send(json.dumps({
                    "event": "task_continue",
                    "text": text,
                }))
                await ws.send(json.dumps({"event": "task_finish"}))

                while True:
                    raw = await ws.recv()
                    msg = json.loads(raw)
                    event = msg.get("event")
                    data = msg.get("data") if isinstance(msg.get("data"), dict) else {}
                    audio_hex = data.get("audio", "")
                    # Some payload variants don't always provide a stable event field.
                    # Treat any message with data.audio as an audio chunk.
                    if isinstance(audio_hex, str) and audio_hex:
                        try:
                            audio_chunks.extend(bytes.fromhex(audio_hex))
                        except ValueError:
                            logger.warning("Unexpected non-hex audio payload from MiniMax")
                        if msg.get("is_final"):
                            break
                        continue

                    if event in {"task_finished", "task_finish"}:
                        break

                    if event in {"task_failed", "error"}:
                        status_msg = msg.get("base_resp", {}).get(
                            "status_msg", "Unknown TTS websocket failure"
                        )
                        raise ValueError(f"MiniMax TTS task_failed: {status_msg}")
            finally:
                await ws.close()

            if audio_chunks:
                logger.info("MiniMax TTS generated %d bytes", len(audio_chunks))
                return bytes(audio_chunks)

            logger.warning("No audio chunks returned from MiniMax TTS websocket")
            return None

        except (ConnectionError, ValueError) as e:
            logger.error("MiniMax TTS error (voice_id=%s): %s", voice_id, e)
            raise
        except websockets.WebSocketException as e:
            logger.error("MiniMax TTS websocket error (voice_id=%s): %s", voice_id, e)
            raise

    async def _connect_tts_websocket(self):
        """
        Connect to MiniMax TTS websocket.
        Supports both websockets>=13 and older argument names.
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
        }
        try:
            return await websockets.connect(
                TTS_WS_URL,
                additional_headers=headers,
                open_timeout=10,
                close_timeout=5,
                ping_interval=20,
                ping_timeout=20,
            )
        except TypeError:
            # Compatibility fallback for older websockets versions.
            return await websockets.connect(
                TTS_WS_URL,
                extra_headers=headers,
                open_timeout=10,
                close_timeout=5,
                ping_interval=20,
                ping_timeout=20,
            )

    async def _wait_for_event(self, ws, expected_events: set[str], timeout: float) -> dict:
        """
        Read websocket messages until one of expected_events appears.
        Raises on task_failed or timeout.
        """
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            event = msg.get("event")

            if event in expected_events:
                return msg

            if event in {"task_failed", "error"}:
                status_msg = msg.get("base_resp", {}).get(
                    "status_msg", "Unknown TTS websocket failure"
                )
                raise ValueError(f"MiniMax TTS task_failed: {status_msg}")

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
