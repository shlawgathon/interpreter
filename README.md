# 🌐 Interpreter — Live Speaker Translation

A Chrome extension + FastAPI backend that translates live audio from any web chat app (Google Meet, Zoom, Discord, etc.) in real time. Hear everything in your native tongue.

## Architecture

```
Tab Audio → Chrome Extension (tabCapture) → FastAPI WebSocket Backend
                                                    ↓
                                            Speechmatics STT
                                                    ↓
                                           MiniMax Translation
                                                    ↓
                                            MiniMax TTS (Speech 2.6)
                                                    ↓
                                        ← Translated Audio ←
```

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env    # Add your API keys
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
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

### 3. Use It

1. Open any web chat (Google Meet, YouTube, etc.)
2. Click the Interpreter extension icon
3. Pick source + target language
4. Hit **Start Translation**
5. Hear translated audio live 🎧

## API Keys Required

| Service          | Credit                       | How to Get                                                 |
| ---------------- | ---------------------------- | ---------------------------------------------------------- |
| **Speechmatics** | $200 (code: `VOICEAGENT200`) | [portal.speechmatics.com](https://portal.speechmatics.com) |
| **MiniMax**      | $20                          | [minimax.io](https://www.minimax.io)                       |

## Tech Stack

- **Extension**: React, TypeScript, Vite, CRXJS, Chrome MV3
- **Backend**: Python, FastAPI, WebSocket
- **STT**: Speechmatics Real-time API
- **Translation + TTS**: MiniMax M2.5 + Speech 2.6 Turbo
