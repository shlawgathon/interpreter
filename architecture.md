# Interpreter — Text-to-Audio Pipeline

Full data-flow from microphone capture to translated audio playback.

## High-Level Overview

```mermaid
flowchart LR
    A["🎤 Tab Audio"] --> B["Chrome Extension"]
    B --> C["FastAPI Backend"]
    C --> D["Speechmatics STT"]
    C --> E["MiniMax LLM"]
    C --> F["MiniMax TTS"]
    F --> B
    B --> G["🔊 BlackHole / Speaker"]
```

## Detailed Pipeline

```mermaid
sequenceDiagram
    participant Tab as Google Meet Tab
    participant OFS as offscreen.ts<br/>(AudioWorklet)
    participant BG as background.ts<br/>(Service Worker)
    participant WS as main.py<br/>(FastAPI WS)
    participant SM as speechmatics_client.py<br/>(Speechmatics RT)
    participant MM as minimax_client.py<br/>(MiniMax API)

    Note over Tab, OFS: ── 1. Audio Capture ──

    BG->>Tab: chrome.tabCapture.getMediaStreamId()
    Tab-->>BG: streamId
    BG->>OFS: start-capture {streamId, outputDeviceId}
    OFS->>OFS: getUserMedia(chromeMediaSource: tab)
    OFS->>OFS: AudioWorkletNode downsample 48kHz to 16kHz
    OFS->>OFS: Float32 to Int16 PCM

    Note over OFS, WS: ── 2. Audio Streaming ──

    loop Every ~256ms (4096 samples)
        OFS->>BG: sendMessage type audio-data, data PCM
        BG->>WS: WebSocket.send(binary PCM)
        WS->>SM: speechmatics.send_audio(bytes)
    end

    Note over SM, WS: ── 3. Speech-to-Text ──

    SM->>SM: Speechmatics RT WebSocket wss://eu2.rt.speechmatics.com/v2
    SM-->>WS: on_transcript text, is_final=false
    WS-->>BG: JSON transcript partial
    BG-->>OFS: not forwarded

    SM-->>WS: on_transcript text, is_final=true
    WS->>WS: Append to transcript_buffer

    Note over WS: Buffer triggers translation when<br/>len > 24 chars OR ends with sentence punctuation

    Note over WS, MM: ── 4. Translation (MiniMax LLM) ──

    WS->>WS: enqueue_translation → translation_worker
    WS->>MM: minimax.translate_stream(text, src_lang, tgt_lang)
    MM->>MM: POST chatcompletion_v2 stream=true

    loop Streaming chunks
        MM-->>WS: yield chunk delta text
        WS-->>BG: JSON translated_text_partial
    end

    MM-->>WS: Final translated text
    WS-->>BG: JSON translated_text
    BG-->>BG: broadcastToPopup() → Popup UI

    Note over WS, MM: ── 5. Text-to-Speech (MiniMax T2A) ──

    WS->>MM: minimax.text_to_speech translated_text, target_lang
    MM->>MM: Resolve voice_id from VOICE_MAP + env override
    MM->>MM: Connect WSS api.minimax.chat t2a_v2
    MM->>MM: Send task_start, task_continue, task_finish
    MM->>MM: Receive hex-encoded MP3 audio chunks
    MM->>MM: Assemble into bytes
    MM-->>WS: MP3 audio bytes

    Note over BG, OFS: ── 6. Audio Playback ──

    WS-->>BG: WebSocket.send binary MP3
    BG->>BG: Blob to Uint8Array
    BG->>OFS: sendMessage type translated-audio
    OFS->>OFS: new Blob as audio/mpeg
    OFS->>OFS: HTMLAudioElement.setSinkId BlackHole
    OFS->>OFS: element.play
    OFS-->>Tab: Translated audio to BlackHole virtual mic
```

## Component File Map

| Layer         | File                              | Responsibility                                                       |
| ------------- | --------------------------------- | -------------------------------------------------------------------- |
| **Extension** | `background.ts`                   | Service worker — orchestrates popup ↔ offscreen ↔ backend WS         |
| **Extension** | `offscreen/offscreen.ts`          | Tab audio capture (PCM) + translated audio playback (MP3→BlackHole)  |
| **Extension** | `popup/`                          | UI — language selector, start/stop, transcript display               |
| **Backend**   | `main.py`                         | FastAPI WebSocket `/ws/translate` — routes audio through STT→LLM→TTS |
| **Backend**   | `services/speechmatics_client.py` | Speechmatics RT WebSocket — streams PCM, receives transcripts        |
| **Backend**   | `services/minimax_client.py`      | MiniMax Chat (translation) + T2A WebSocket (TTS)                     |

## Data Formats at Each Hop

```mermaid
flowchart TD
    A("Tab Audio<br/>48kHz Float32 stereo") -->|downsample + mono| B("Offscreen PCM<br/>16kHz Int16 mono")
    B -->|sendMessage as number array| C("Background<br/>Uint8Array")
    C -->|WebSocket binary| D("Backend<br/>raw bytes")
    D -->|WebSocket binary| E("Speechmatics<br/>pcm_s16le 16kHz")
    E -->|JSON transcript| F("Transcript text")
    F -->|HTTP stream| G("MiniMax LLM<br/>translated text")
    G -->|WSS T2A| H("MiniMax TTS<br/>hex-encoded MP3 chunks")
    H -->|assembled bytes| I("Backend<br/>MP3 bytes")
    I -->|WebSocket binary| J("Background<br/>Blob to number array")
    J -->|sendMessage| K("Offscreen<br/>Uint8Array to Blob")
    K -->|AudioElement.play| L("Output Device<br/>BlackHole or Speaker")
```
