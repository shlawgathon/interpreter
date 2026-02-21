"""
Speechmatics Text-to-Speech client.

Docs:
- https://docs.speechmatics.com/text-to-speech/quickstart
"""

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("interpreter.speechmatics_tts")

TTS_BASE_URL = "https://preview.tts.speechmatics.com/generate"
DEFAULT_VOICE_ID = "sarah"
DEFAULT_OUTPUT_FORMAT = "wav_16000"

# As of current preview docs, Speechmatics TTS supports English voices.
SUPPORTED_LANGS = {"en"}

VOICE_BY_LANG = {
    "en": "sarah",
}


class SpeechmaticsTTSClient:
    """HTTP client for Speechmatics preview TTS."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.output_format = os.getenv(
            "SPEECHMATICS_TTS_OUTPUT_FORMAT",
            DEFAULT_OUTPUT_FORMAT,
        ).strip() or DEFAULT_OUTPUT_FORMAT
        self.global_voice_override = os.getenv("SPEECHMATICS_TTS_VOICE_ID", "").strip()
        self.client = httpx.AsyncClient(timeout=30.0)

    async def text_to_speech(self, text: str, language: str = "en") -> Optional[bytes]:
        """Generate WAV/PCM bytes using Speechmatics preview TTS API."""
        if not text.strip():
            return None
        if not self.api_key:
            raise ValueError("SPEECHMATICS_API_KEY is required for Speechmatics TTS")

        lang = (language or "en").lower()
        if lang not in SUPPORTED_LANGS:
            logger.warning(
                "Speechmatics TTS currently supports %s; got '%s'",
                sorted(SUPPORTED_LANGS),
                lang,
            )
            return None

        voice_id = self._resolve_voice_id(lang)
        url = f"{TTS_BASE_URL}/{voice_id}"
        params = {"output_format": self.output_format}
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"text": text}

        resp = await self.client.post(url, headers=headers, params=params, json=payload)
        resp.raise_for_status()
        audio = resp.content
        if not audio:
            return None

        logger.info(
            "Speechmatics TTS generated %d bytes (voice=%s, format=%s)",
            len(audio),
            voice_id,
            self.output_format,
        )
        return audio

    def _resolve_voice_id(self, language: str) -> str:
        if self.global_voice_override:
            return self.global_voice_override

        per_lang = os.getenv(f"SPEECHMATICS_TTS_VOICE_ID_{language.upper()}", "").strip()
        if per_lang:
            return per_lang

        return VOICE_BY_LANG.get(language, DEFAULT_VOICE_ID)

    async def close(self) -> None:
        await self.client.aclose()

