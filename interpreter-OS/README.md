# Interpreter OS

Hackathon-grade macOS desktop widget for live app audio translation.

## What it does

- Captures system or app audio on macOS with `ScreenCaptureKit` from the Tauri Rust layer
- Streams PCM audio to a Bun relay that you can run locally or deploy on Jade Hosting
- Uses Smallest AI Pulse STT for transcription
- Translates the transcript in the relay for visible captions
- Optionally synthesizes translated speech with Smallest Lightning v2 TTS
- Shows a floating always-on-top overlay so the demo reads well on stage

## Project layout

```text
interpreter-OS/
├── src/                 # React widget UI
├── src-tauri/           # Tauri + Rust capture/session core
└── relay/               # Bun websocket relay for Smallest + Jade Hosting
```

## Local development

### 1. Frontend + desktop shell

```bash
cd /Users/xiao/interpreter/interpreter-OS
bun install
bun run tauri dev
```

### 2. Relay

```bash
cd /Users/xiao/interpreter/interpreter-OS/relay
cp .env.example .env
bun install
bun run dev
```

Required relay env:

```bash
SMALLEST_API_KEY=...
SMALLEST_TTS_VOICE_ID=...
```

The widget defaults to `http://127.0.0.1:8787` as the relay URL.

## macOS permissions

The first time you start capture, macOS should ask for:

- `Screen & System Audio Recording`

If the permission prompt does not appear, open:

- `System Settings > Privacy & Security > Screen & System Audio Recording`

Then enable the app and restart it.

## Jade Hosting deploy

The relay is a plain Bun websocket server with a Dockerfile. On Jade Hosting:

1. Create a service pointed at `/Users/xiao/interpreter/interpreter-OS/relay`
2. Use the included `Dockerfile`
3. Set env vars from `.env.example`
4. Expose the service on port `8787`
5. Paste that public URL into the desktop widget's `Relay URL` field

## Notes

- The translation fallback currently uses the unofficial Google Translate endpoint when no other translator is configured. That is enough for a hackathon demo, but it should be swapped before production use.
- Smallest AI handles the speech interfaces here: Pulse STT for live transcript input and Lightning v2 for translated voice output.
