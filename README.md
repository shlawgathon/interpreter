# 🌐 Interpreter — Live Speaker Translation

A Chrome extension + FastAPI backend that translates live audio from any web chat app (Google Meet, Zoom, Discord, etc.) in real time. Hear everything in your native tongue — or route the translated audio into the call so others hear it too.

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
│                                              Speechmatics STT      │
│                                                       │            │
│                                              MiniMax Translation    │
│                                                       │            │
│                                              MiniMax TTS (2.6)     │
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

## Tech Stack

- **Extension**: React, TypeScript, Vite, CRXJS, Chrome MV3
- **Backend**: Python, FastAPI, WebSocket, uv
- **STT**: Speechmatics Real-time API
- **Translation + TTS**: MiniMax M2.5 + Speech 2.6 Turbo
- **Audio Routing**: BlackHole (macOS virtual audio loopback)
