"""
MiniMax Client — Translation (M2.5 LLM) + TTS (Speech 2.6 Turbo)

Translation: Chat completions API with streaming
TTS: T2A v2 API with streaming
"""

import base64
import logging
from typing import Optional

import httpx

logger = logging.getLogger("interpreter.minimax")

# MiniMax API endpoints
CHAT_URL = "https://api.minimax.chat/v1/text/chatcompletion_v2"
TTS_URL = "https://api.minimax.chat/v1/t2a_v2"

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

# MiniMax voice IDs per language (default voices)
VOICE_MAP = {
    "en": "English_Male_1",
    "es": "Spanish_Male_1",
    "fr": "French_Male_1",
    "de": "German_Male_1",
    "it": "Italian_Male_1",
    "pt": "Portuguese_Male_1",
    "zh": "Chinese_Male_1",
    "ja": "Japanese_Male_1",
    "ko": "Korean_Male_1",
    "ar": "Arabic_Male_1",
    "hi": "Hindi_Male_1",
    "ru": "Russian_Male_1",
    "nl": "Dutch_Male_1",
    "sv": "Swedish_Male_1",
    "pl": "Polish_Male_1",
    "tr": "Turkish_Male_1",
}


def get_language_name(code: str) -> str:
    """Get the full language name for a language code."""
    return LANGUAGE_NAMES.get(code, code)


class MinimaxClient:
    """Async client for MiniMax translation (M2.5) and TTS (Speech 2.6 Turbo)."""

    def __init__(self, api_key: str, group_id: str):
        self.api_key = api_key
        self.group_id = group_id
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
            "model": "MiniMax-Text-01",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text},
            ],
            "temperature": 0.3,
            "max_tokens": 500,
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

    async def text_to_speech(
        self,
        text: str,
        language: str = "en",
    ) -> Optional[bytes]:
        """
        Generate speech audio using MiniMax Speech 2.6 Turbo (T2A v2).
        Returns MP3 audio bytes.
        """
        if not text.strip():
            return None

        voice_id = VOICE_MAP.get(language, "English_Male_1")

        payload = {
            "model": "speech-02-turbo",
            "text": text,
            "stream": False,
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
            },
        }

        try:
            url = f"{TTS_URL}?GroupId={self.group_id}"
            resp = await self.client.post(
                url,
                headers=self._headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            # Extract audio from response
            audio_hex = data.get("data", {}).get("audio", "")
            if audio_hex:
                audio_bytes = bytes.fromhex(audio_hex)
                return audio_bytes

            # Check for base64 audio
            audio_b64 = data.get("data", {}).get("audio_base64", "")
            if audio_b64:
                return base64.b64decode(audio_b64)

            # Check if audio is directly in extra_info or different format
            extra = data.get("extra_info", {})
            if extra:
                logger.info("MiniMax TTS extra info: %s", extra)

            logger.warning(
                "No audio in MiniMax TTS response: %s", list(data.keys()),
            )
            return None

        except httpx.HTTPStatusError as e:
            logger.error(
                "MiniMax TTS HTTP error: %s - %s",
                e.response.status_code, e.response.text,
            )
            raise
        except (ConnectionError, ValueError) as e:
            logger.error("MiniMax TTS error: %s", e)
            raise

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
