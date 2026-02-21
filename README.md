# Interpreter — Live Speaker Translation

A Chrome extension + FastAPI backend that translates live audio from web chat apps (Google Meet, Zoom, Discord, etc.) in real time. Hear everything in your native language, or route translated audio into the call.

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                            │
│                                                                    │
│  Tab Audio ──→ Offscreen Doc ──→ Service Worker ──→ WebSocket ─┐   │
│   (tabCapture)   (PCM extract)    (orchestrator)               │   │
│                                                                │   │
│                                                                ▼   │
│                                                     FastAPI Backend │
│                                                       │            │
│                                              Speechmatics STT + RT Translation │
│                                                       │            │
│                                TTS Provider (MiniMax 2.8 or Speechmatics preview) │
│                                                       │            │
│  Offscreen Doc ◀── Service Worker ◀── Translated Audio ◀──────┘   │
│   (playback via selected output device)                            │
│       │                                                            │
│       ▼                                                            │
│  BlackHole / Speakers                                              │
└────────────────────────────────────────────────────────────────────┘
```

**Audio routing flow:**

| Route                  | What happens                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| **Speakers (default)** | You hear the translated audio locally                               |
| **BlackHole → Meet**   | Translated audio is routed into the call as your "microphone" input |

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env    # Add your API keys
uv sync
uv run uvicorn main:app --reload --port 8000
```

### 2. Extension

```bash
cd extension
bun install
bun run dev
```

Then load in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select `extension/dist` folder
4. Allow microphone permission when prompted (needed for device enumeration)

### 3. Use It

1. Open any web chat (Google Meet, YouTube, etc.)
2. Click the Interpreter extension icon
3. Pick source + target language
4. Select an output device (speakers or BlackHole)
5. Hit **Start Translation**
6. Hear translated audio live 🎧

Notes:
- Original tab audio passthrough is disabled in offscreen capture, so you should not hear untranslated + translated from the extension at the same time.
- If output is set to BlackHole 2ch, local speakers are silent by design unless you monitor with a Multi-Output device.

## BlackHole Setup (Route Audio into Calls)

To let other meeting participants hear the translated audio:

### Install BlackHole

```bash
brew install blackhole-2ch
```

Or download from [existential.audio/blackhole](https://existential.audio/blackhole/).

### Configure

1. **Extension**: In the popup, select **BlackHole 2ch** as the Translation Output device
2. **Google Meet**: Go to Meet Settings → Audio → set **Microphone** to **BlackHole 2ch**

Now when you start translation, the translated audio plays into BlackHole, which Meet picks up as your microphone input. Other participants hear the translation.

> **Tip:** To hear the call yourself while routing audio into Meet, create a macOS Multi-Output Device in Audio MIDI Setup that combines your speakers + BlackHole.

## API Keys Required

| Service          | Credit                       | How to Get                                                 |
| ---------------- | ---------------------------- | ---------------------------------------------------------- |
| **Speechmatics** | $200 (code: `VOICEAGENT200`) | [portal.speechmatics.com](https://portal.speechmatics.com) |
| **MiniMax**      | $20                          | [minimax.io](https://www.minimax.io)                       |

## Latency Tuning

You can tune backend chunking and partial update behavior in `backend/.env`:

```bash
# Translation chunking
TRANSLATION_TRIGGER_CHAR_THRESHOLD=24

# Partial translated-text UI throttling
TRANSLATION_PARTIAL_MIN_DELTA_CHARS=12
TRANSLATION_PARTIAL_MIN_INTERVAL_MS=300

# Speechmatics finalization speed
SPEECHMATICS_MAX_DELAY=1.0
SPEECHMATICS_RT_WS_URL=wss://eu.rt.speechmatics.com/v2/

# Translation provider mode
USE_SPEECHMATICS_TRANSLATION=1
SPEECHMATICS_TRANSLATION_ENABLE_PARTIALS=1

# TTS provider mode
TTS_PROVIDER=speechmatics
# TTS_PROVIDER=minimax
# SPEECHMATICS_TTS_OUTPUT_FORMAT=wav_16000
# SPEECHMATICS_TTS_VOICE_ID=sarah
```

Guidance:
- Keep `USE_SPEECHMATICS_TRANSLATION=1` for the lowest end-to-end delay.
- `TTS_PROVIDER=speechmatics` is now the default.
- Switch to `TTS_PROVIDER=minimax` for broader multilingual voice coverage.
- Lower `TRANSLATION_TRIGGER_CHAR_THRESHOLD` for faster response.
- Higher `TRANSLATION_TRIGGER_CHAR_THRESHOLD` for fewer, larger chunks.
- Lower `SPEECHMATICS_MAX_DELAY` for faster final transcripts.
- Raise partial throttles if live text appears to constantly rewrite.

## Tech Stack

- **Extension**: React, TypeScript, Vite, CRXJS, Chrome MV3
- **Backend**: Python, FastAPI, WebSocket, uv
- **STT**: Speechmatics Real-time API
- **Translation**: Speechmatics RT Translation (recommended low-latency mode) or MiniMax M2 fallback
- **TTS**: MiniMax Speech 2.8 Turbo (default) or Speechmatics preview TTS (test option)
- **Audio Routing**: BlackHole (macOS virtual audio loopback)
