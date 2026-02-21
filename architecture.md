# Interpreter — Architecture

Current end-to-end data flow from tab audio capture to translated playback.

## High-Level Flow

```mermaid
flowchart LR
    A["Tab Audio (Google Meet/YouTube/etc.)"] --> B["Chrome Extension Offscreen Capture"]
    B --> C["Extension Service Worker"]
    C --> D["FastAPI WebSocket Backend"]
    D --> E["Speechmatics RT (STT + Translation)"]
    D --> F["TTS Provider"]
    F --> G["Translated Audio Bytes"]
    G --> C
    C --> H["Offscreen Playback + setSinkId"]
    H --> I["BlackHole 2ch or Speakers"]
```

## Detailed Sequence

```mermaid
sequenceDiagram
    participant Tab as Tab Audio Source
    participant OFS as extension/src/offscreen/offscreen.ts
    participant BG as extension/src/background.ts
    participant API as backend/main.py
    participant SM as backend/services/speechmatics_client.py
    participant MM as backend/services/minimax_client.py
    participant SMTTS as backend/services/speechmatics_tts_client.py

    Note over BG,OFS: Start Translation
    BG->>OFS: start-capture {streamId, outputDeviceId}
    OFS->>OFS: setOutputDevice(outputDeviceId)
    OFS->>OFS: capture tab audio via AudioWorklet (48k -> 16k PCM)

    loop Audio chunks
        OFS->>BG: audio-data (Int16 PCM bytes)
        BG->>API: websocket binary send
        API->>SM: send_audio(bytes)
    end

    Note over SM,API: Speechmatics realtime recognition + translation
    SM-->>API: AddPartialTranscript / AddTranscript
    API-->>BG: transcript messages
    SM-->>API: AddPartialTranslation / AddTranslation
    API-->>BG: translated_text_partial / translated_text

    Note over API: Final translated text enters low-latency queue
    alt TTS_PROVIDER=minimax
        API->>MM: text_to_speech(translated_text, target_lang)
        MM-->>API: audio bytes (MP3)
    else TTS_PROVIDER=speechmatics
        API->>SMTTS: text_to_speech(translated_text, target_lang)
        SMTTS-->>API: audio bytes (WAV/PCM preview endpoint)
        Note right of API: If unsupported language/no audio, fallback to MiniMax TTS
    end

    API-->>BG: websocket binary audio
    BG->>OFS: translated-audio (byte array)
    OFS->>OFS: detect MIME (WAV vs MP3), AudioElement.play()
    OFS->>OFS: setSinkId(selected output device)
```

## Runtime Controls (`backend/.env`)

- `USE_SPEECHMATICS_TRANSLATION=1`
  - `1`: use Speechmatics RT translation events.
  - `0`: fallback to MiniMax text translation pipeline.

- `TTS_PROVIDER=minimax|speechmatics`
  - `minimax` default, multilingual.
  - `speechmatics` preview test option (English-focused).

- `SPEECHMATICS_MAX_DELAY`
  - lower value reduces transcript finalization delay.

- `TRANSLATION_TRIGGER_CHAR_THRESHOLD`, `TRANSLATION_PARTIAL_MIN_DELTA_CHARS`, `TRANSLATION_PARTIAL_MIN_INTERVAL_MS`
  - used primarily when running MiniMax text translation mode.

## Key Files

- Extension capture/playback:
  - `/Users/xiao/interpreter/extension/src/offscreen/offscreen.ts`
  - `/Users/xiao/interpreter/extension/src/background.ts`
- Backend orchestrator:
  - `/Users/xiao/interpreter/backend/main.py`
- Provider clients:
  - `/Users/xiao/interpreter/backend/services/speechmatics_client.py`
  - `/Users/xiao/interpreter/backend/services/minimax_client.py`
  - `/Users/xiao/interpreter/backend/services/speechmatics_tts_client.py`

