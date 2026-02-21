# Walkthrough — Interpreter Live Translation Extension

## What Was Built

A Chrome extension + FastAPI backend for real-time speaker translation. The pipeline:

```
Tab Audio → tabCapture → WebSocket → Speechmatics STT → MiniMax Translate → MiniMax TTS → Audio Out
```

Only **2 API providers** (Speechmatics + MiniMax). Original audio stays **loud** for live demo.

## Files Created (25 files, 2,324 lines)

### Extension (`/extension`) — React + TypeScript + CRXJS
| File | Purpose |
|------|---------|
| [manifest.json](file:///Users/xiao/interpreter/extension/manifest.json) | Chrome MV3 config (tabCapture, offscreen, storage) |
| [vite.config.ts](file:///Users/xiao/interpreter/extension/vite.config.ts) | Vite + CRXJS plugin |
| [background.ts](file:///Users/xiao/interpreter/extension/src/background.ts) | Service worker — capture orchestration + WebSocket relay |
| [offscreen.ts](file:///Users/xiao/interpreter/extension/src/offscreen/offscreen.ts) | Audio capture (16kHz PCM) + translated audio playback |
| [App.tsx](file:///Users/xiao/interpreter/extension/src/popup/App.tsx) | React popup — language pickers, start/stop, live transcript |
| [index.css](file:///Users/xiao/interpreter/extension/src/popup/index.css) | Dark glassmorphic theme |
| [languages.ts](file:///Users/xiao/interpreter/extension/src/utils/languages.ts) | 16 languages mapped for both APIs |

### Backend (`/backend`) — FastAPI + WebSocket
| File | Purpose |
|------|---------|
| [main.py](file:///Users/xiao/interpreter/backend/main.py) | WebSocket server — orchestrates full STT→Translate→TTS pipeline |
| [speechmatics_client.py](file:///Users/xiao/interpreter/backend/services/speechmatics_client.py) | Async WS client for Speechmatics real-time STT |
| [minimax_client.py](file:///Users/xiao/interpreter/backend/services/minimax_client.py) | Translation (M2.5 chat) + TTS (Speech 2.6 Turbo) |

## Verified

- ✅ Extension builds clean: `bun run dev` → CRXJS outputs `dist/` for Chrome
- ✅ Backend imports clean: all modules load without errors
- ✅ [PR #1](https://github.com/shlawgathon/interpreter/pull/1) created and pushed

## Next Steps for You

1. **Add API keys** to `backend/.env`:
   - Speechmatics: [portal.speechmatics.com](https://portal.speechmatics.com) → use code `VOICEAGENT200`
   - MiniMax: [minimax.io](https://www.minimax.io) → get API key + Group ID

2. **Run backend**: `cd backend && uvicorn main:app --reload --port 8000`

3. **Run extension**: `cd extension && bun run dev` → load `dist/` in Chrome

4. **Test**: Open Google Meet/YouTube → click Interpreter icon → pick languages → Start
