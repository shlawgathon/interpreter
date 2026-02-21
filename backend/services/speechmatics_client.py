"""
Speechmatics Real-time STT WebSocket Client

Connects to Speechmatics RT API, streams PCM audio, receives transcripts.
Docs: https://docs.speechmatics.com/rt-api-ref
"""

import asyncio
import json
import logging
from typing import Callable, Awaitable

import websockets
from websockets.client import WebSocketClientProtocol

logger = logging.getLogger("interpreter.speechmatics")

# Speechmatics RT endpoint
SM_RT_URL = "wss://eu2.rt.speechmatics.com/v2"

# Language code mapping
SM_LANGUAGE_MAP = {
    "en": "en",
    "es": "es",
    "fr": "fr",
    "de": "de",
    "it": "it",
    "pt": "pt",
    "zh": "cmn",
    "ja": "ja",
    "ko": "ko",
    "ar": "ar",
    "hi": "hi",
    "ru": "ru",
    "nl": "nl",
    "sv": "sv",
    "pl": "pl",
    "tr": "tr",
}


class SpeechmaticsClient:
    def __init__(
        self,
        api_key: str,
        language: str = "en",
        on_transcript: Callable[[str, bool], Awaitable[None]] | None = None,
    ):
        self.api_key = api_key
        self.language = SM_LANGUAGE_MAP.get(language, language)
        self.on_transcript = on_transcript
        self.ws: WebSocketClientProtocol | None = None
        self.is_connected = False
        self._receive_task: asyncio.Task | None = None
        self._seq_no = 0

    async def connect(self) -> None:
        """Connect to Speechmatics RT WebSocket."""
        url = f"{SM_RT_URL}"
        headers = {"Authorization": f"Bearer {self.api_key}"}

        try:
            self.ws = await websockets.connect(
                url,
                additional_headers=headers,
                ping_interval=20,
                ping_timeout=10,
            )

            # Send StartRecognition
            start_msg = {
                "message": "StartRecognition",
                "transcription_config": {
                    "language": self.language,
                    "operating_point": "enhanced",
                    "enable_partials": True,
                    "max_delay": 2.0,
                },
                "audio_format": {
                    "type": "raw",
                    "encoding": "pcm_s16le",
                    "sample_rate": 16000,
                },
            }
            await self.ws.send(json.dumps(start_msg))

            # Wait for RecognitionStarted
            response = await self.ws.recv()
            msg = json.loads(response)
            if msg.get("message") == "RecognitionStarted":
                self.is_connected = True
                logger.info(f"Speechmatics recognition started (lang={self.language})")
                # Start receiving in background
                self._receive_task = asyncio.create_task(self._receive_loop())
            else:
                logger.error(f"Unexpected response: {msg}")
                raise ConnectionError(f"Failed to start recognition: {msg}")

        except Exception as e:
            logger.error(f"Failed to connect to Speechmatics: {e}")
            self.is_connected = False
            raise

    async def _receive_loop(self) -> None:
        """Background loop to receive transcript messages."""
        try:
            async for raw_msg in self.ws:
                if isinstance(raw_msg, bytes):
                    continue  # Skip binary messages

                msg = json.loads(raw_msg)
                msg_type = msg.get("message", "")

                if msg_type == "AddPartialTranscript":
                    text = self._extract_text(msg)
                    if text and self.on_transcript:
                        await self.on_transcript(text, False)

                elif msg_type == "AddTranscript":
                    text = self._extract_text(msg)
                    if text and self.on_transcript:
                        await self.on_transcript(text, True)

                elif msg_type == "EndOfTranscript":
                    logger.info("Speechmatics: End of transcript")
                    break

                elif msg_type == "Error":
                    logger.error(f"Speechmatics error: {msg}")

        except websockets.exceptions.ConnectionClosed:
            logger.info("Speechmatics connection closed")
        except Exception as e:
            logger.error(f"Speechmatics receive error: {e}")
        finally:
            self.is_connected = False

    def _extract_text(self, msg: dict) -> str:
        """Extract transcript text from a Speechmatics message."""
        results = msg.get("results", [])
        words = []
        for r in results:
            alternatives = r.get("alternatives", [])
            if alternatives:
                content = alternatives[0].get("content", "")
                if content:
                    words.append(content)
        return " ".join(words)

    async def send_audio(self, audio_data: bytes) -> None:
        """Send raw PCM audio to Speechmatics."""
        if self.ws and self.is_connected:
            try:
                self._seq_no += 1
                await self.ws.send(audio_data)
            except Exception as e:
                logger.error(f"Error sending audio: {e}")
                self.is_connected = False

    async def close(self) -> None:
        """Close the Speechmatics connection."""
        if self.ws and self.is_connected:
            try:
                # Send EndOfStream
                await self.ws.send(json.dumps({"message": "EndOfStream", "last_seq_no": self._seq_no}))
                # Wait briefly for EndOfTranscript
                await asyncio.sleep(0.5)
            except Exception:
                pass

        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        if self.ws:
            await self.ws.close()
            self.ws = None

        self.is_connected = False
        logger.info("Speechmatics client closed")
