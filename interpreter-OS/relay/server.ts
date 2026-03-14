import { WebSocket } from "ws";

type InitMessage = {
  type: "init";
  sourceLanguage?: string;
  targetLanguage: string;
  speakTranslation?: boolean;
  voiceId?: string | null;
  ttsProvider?: string | null;
  sttProvider?: string | null;
};

type EndMessage = {
  type: "end";
};

type SessionConfig = {
  sourceLanguage: string;
  targetLanguage: string;
  speakTranslation: boolean;
  voiceId?: string | null;
  ttsProvider: string;
  sttProvider: string;
};

type Session = {
  config: SessionConfig;
  sttSocket: WebSocket;
};

type ClientData = {
  session?: Session;
  sawBinary?: boolean;
  pendingAudio?: Uint8Array;
};

const port = Number(Bun.env.PORT ?? 8787);
const smallestApiKey = Bun.env.SMALLEST_API_KEY;
const smallestSttUrl =
  Bun.env.SMALLEST_STT_URL ?? "wss://api.smallest.ai/waves/v1/pulse/get_text";
const smallestTtsUrl =
  Bun.env.SMALLEST_TTS_URL ?? "https://api.smallest.ai/waves/v1/lightning-v2/get_speech";
const fallbackVoiceId = Bun.env.SMALLEST_TTS_VOICE_ID ?? "";
const ttsLanguage = Bun.env.SMALLEST_TTS_LANGUAGE ?? "auto";
const googleFallbackEnabled = (Bun.env.ENABLE_GOOGLE_TRANSLATE_FALLBACK ?? "1") !== "0";
const sttSampleRate = Number(Bun.env.SMALLEST_STT_SAMPLE_RATE ?? 48000);
const sttChunkBytes = Number(Bun.env.SMALLEST_STT_CHUNK_BYTES ?? 4096);

// ElevenLabs
const elevenLabsApiKey = Bun.env.ELEVENLABS_API_KEY ?? "";
const elevenLabsVoiceId = Bun.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
const elevenLabsModelId = Bun.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";

if (!smallestApiKey) {
  console.warn("SMALLEST_API_KEY is missing. The relay will accept websocket clients but STT and TTS will fail.");
}

// Languages supported by Smallest AI Lightning TTS
const SMALLEST_TTS_LANGS = new Set([
  "en", "hi", "mr", "kn", "ta", "bn", "gu",
  "de", "fr", "es", "it", "pl", "nl", "ru",
  "ar", "he", "sv", "ml", "te",
]);

/** Pick the right TTS with auto-fallback */
async function chooseTts(
  text: string,
  targetLang: string,
  preferred: string,
  voiceId?: string | null,
): Promise<{ audioBase64: string; mimeType: string } | null> {
  if (preferred === "elevenlabs") {
    return synthesizeElevenLabs(text, voiceId);
  }
  // Smallest AI — check language support, fallback to EL if needed
  const langCode = targetLang.split("-")[0].toLowerCase();
  if (!SMALLEST_TTS_LANGS.has(langCode)) {
    if (elevenLabsApiKey) {
      console.log(`[relay] Smallest TTS doesn't support "${targetLang}", falling back to ElevenLabs`);
      return synthesizeElevenLabs(text, voiceId);
    }
    console.warn(`[relay] Smallest TTS doesn't support "${targetLang}" and no ElevenLabs key configured`);
    return null;
  }
  return synthesizeSpeech(text, langCode, voiceId);
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function safeSend(ws: ServerWebSocket<ClientData>, payload: unknown) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Client already disconnected — swallow to prevent relay crash
  }
}

function unixMs() {
  return Date.now();
}

async function maybeTranslate(
  text: string,
  shouldTranslate: boolean,
  sourceLanguage: string,
  targetLanguage: string,
) {
  if (!shouldTranslate) {
    return text;
  }

  return translateText(text, sourceLanguage, targetLanguage);
}

async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  if (!text.trim() || targetLanguage === sourceLanguage) {
    return text;
  }

  if (!googleFallbackEnabled) {
    return text;
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", sourceLanguage === "auto" ? "auto" : sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google translate fallback failed with ${response.status}`);
  }

  const payload = (await response.json()) as unknown[];
  const sentences = Array.isArray(payload[0]) ? (payload[0] as unknown[]) : [];
  return sentences
    .map((sentence) => (Array.isArray(sentence) ? sentence[0] : ""))
    .filter((part): part is string => typeof part === "string")
    .join("");
}

async function synthesizeSpeech(text: string, language: string, voiceId?: string | null) {
  const chosenVoice = voiceId || fallbackVoiceId;
  if (!smallestApiKey || !chosenVoice || !text.trim()) {
    return null;
  }

  const response = await fetch(smallestTtsUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${smallestApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: chosenVoice,
      sample_rate: 24000,
      speed: 1,
      consistency: 0.5,
      similarity: 0,
      enhancement: 1,
      language,
      output_format: "wav",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[relay] TTS failed ${response.status}: ${body}`);
    // Non-fatal: return null so transcripts still work without audio
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: buffer.toString("base64"),
    mimeType: response.headers.get("content-type") ?? "audio/wav",
  };
}

async function synthesizeElevenLabs(text: string, voiceId?: string | null) {
  if (!elevenLabsApiKey || !text.trim()) {
    return null;
  }

  const voice = voiceId || elevenLabsVoiceId;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsApiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: elevenLabsModelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[relay] ElevenLabs TTS failed ${response.status}: ${body}`);
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: buffer.toString("base64"),
    mimeType: "audio/mpeg",
  };
}

async function attachSession(ws: ServerWebSocket<ClientData>, config: SessionConfig) {
  if (config.sttProvider === "elevenlabs") {
    return attachElevenLabsSTT(ws, config);
  }
  return attachSmallestSTT(ws, config);
}

async function attachSmallestSTT(ws: ServerWebSocket<ClientData>, config: SessionConfig) {
  if (!smallestApiKey) {
    throw new Error("SMALLEST_API_KEY is not configured on the relay.");
  }

  const url = new URL(smallestSttUrl);
  url.searchParams.set("sample_rate", String(sttSampleRate));
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("language", config.sourceLanguage === "auto" ? "multi" : config.sourceLanguage);

  const sttSocket = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${smallestApiKey}`,
    },
  });

  const session: Session = {
    config,
    sttSocket,
  };

  sttSocket.on("open", () => {
    console.log("[relay] Smallest STT connected");
    ws.data.session = session;
    safeSend(ws, {
      type: "status",
      stage: "relay_ready",
      message: "Smallest STT websocket connected.",
    });
  });

  sttSocket.on("message", async (payload) => {
    const text = typeof payload === "string" ? payload : payload.toString("utf8");

    try {
      const parsed = JSON.parse(text) as {
        transcript?: string;
        is_final?: boolean;
        language?: string;
      };

      if (!parsed.transcript?.trim()) {
        return;
      }

      console.log("[relay] STT transcript", {
        final: Boolean(parsed.is_final),
        language: parsed.language ?? null,
        transcript: parsed.transcript.slice(0, 80),
      });

      const isFinal = Boolean(parsed.is_final);
      const startedAt = unixMs();
      let translation = parsed.transcript;
      try {
        translation = await maybeTranslate(
          parsed.transcript,
          isFinal,
          session.config.sourceLanguage,
          session.config.targetLanguage,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[relay] Translation fallback failed, using transcript as-is", message);
      }

      safeSend(ws, {
        type: "transcript",
        transcript: parsed.transcript,
        translation,
        finalSegment: isFinal,
        detectedLanguage: parsed.language ?? null,
        latencyMs: unixMs() - startedAt,
        receivedAt: unixMs(),
      });

      if (isFinal && session.config.speakTranslation) {
        const tts = await chooseTts(
          translation,
          session.config.targetLanguage,
          session.config.ttsProvider,
          session.config.voiceId,
        );
        if (tts) {
          safeSend(ws, {
            type: "tts",
            ...tts,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      safeSend(ws, {
        type: "error",
        message: `Failed to process STT payload: ${message}`,
      });
    }
  });

  sttSocket.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[relay] Smallest STT websocket error", message);
    safeSend(ws, {
      type: "error",
      message: `Smallest STT websocket error: ${message}`,
    });
  });

  sttSocket.on("close", () => {
    console.log("[relay] Smallest STT closed");
    safeSend(ws, {
      type: "status",
      stage: "relay_closed",
      message: "Smallest STT websocket closed.",
    });
  });
}

async function attachElevenLabsSTT(ws: ServerWebSocket<ClientData>, config: SessionConfig) {
  if (!elevenLabsApiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured on the relay.");
  }

  const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  url.searchParams.set("model_id", "scribe_v2_realtime");

  const sttSocket = new WebSocket(url.toString(), {
    headers: {
      "xi-api-key": elevenLabsApiKey,
    },
  });

  const session: Session = {
    config,
    sttSocket,
  };

  sttSocket.on("open", () => {
    console.log("[relay] ElevenLabs Scribe STT connected");
    ws.data.session = session;
    // No configure message needed — config is in URL params
    // Audio chunks are self-describing with sample_rate
    safeSend(ws, {
      type: "status",
      stage: "relay_ready",
      message: "ElevenLabs Scribe STT connected.",
    });
  });

  sttSocket.on("message", async (payload) => {
    const text = typeof payload === "string" ? payload : payload.toString("utf8");

    try {
      const parsed = JSON.parse(text) as {
        message_type?: string;
        text?: string;
        language_code?: string;
        session_id?: string;
        code?: number;
        message?: string;
      };

      const msgType = parsed.message_type;

      // Log non-partial events for debugging
      if (msgType !== "partial_transcript") {
        console.log("[relay] ElevenLabs STT event:", msgType, JSON.stringify(parsed).slice(0, 200));
      }

      if (msgType === "session_started") return;
      if (msgType === "input_error") {
        console.error("[relay] ElevenLabs input_error:", parsed.code, parsed.message);
        safeSend(ws, { type: "error", message: `ElevenLabs STT error: ${parsed.message}` });
        return;
      }

      // Handle both partial_transcript and committed_transcript
      const isPartial = msgType === "partial_transcript";
      const isFinal = msgType === "committed_transcript";

      if (!isPartial && !isFinal) return;
      if (!parsed.text?.trim()) return;

      console.log("[relay] ElevenLabs STT", {
        final: isFinal,
        language: parsed.language_code ?? null,
        transcript: parsed.text.slice(0, 80),
      });

      const startedAt = unixMs();
      let translation = parsed.text;
      try {
        translation = await maybeTranslate(
          parsed.text,
          isFinal,
          session.config.sourceLanguage,
          session.config.targetLanguage,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[relay] Translation failed", message);
      }

      safeSend(ws, {
        type: "transcript",
        transcript: parsed.text,
        translation,
        finalSegment: isFinal,
        detectedLanguage: parsed.language_code ?? null,
        latencyMs: unixMs() - startedAt,
        receivedAt: unixMs(),
      });

      if (isFinal && session.config.speakTranslation) {
        const tts = await chooseTts(
          translation,
          session.config.targetLanguage,
          session.config.ttsProvider,
          session.config.voiceId,
        );
        if (tts) {
          safeSend(ws, {
            type: "tts",
            ...tts,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      safeSend(ws, {
        type: "error",
        message: `Failed to process STT payload: ${message}`,
      });
    }
  });

  sttSocket.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[relay] ElevenLabs STT websocket error", message);
    safeSend(ws, {
      type: "error",
      message: `ElevenLabs STT error: ${message}`,
    });
  });


  sttSocket.on("close", () => {
    console.log("[relay] ElevenLabs STT closed");
    safeSend(ws, {
      type: "status",
      stage: "relay_closed",
      message: "ElevenLabs STT closed.",
    });
  });
}

function closeSession(ws: ServerWebSocket<ClientData>) {
  const session = ws.data.session;
  if (!session) {
    return;
  }

  try {
    session.sttSocket.send(JSON.stringify({ type: "finalize" }));
    session.sttSocket.close();
  } catch {
    // Ignore shutdown errors.
  }

  ws.data.session = undefined;
}

const server = Bun.serve<ClientData>({
  port,
  fetch(request, serverInstance) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        provider: "smallest-ai",
        jadeReady: true,
      });
    }

    if (url.pathname === "/ws/session") {
      const upgraded = serverInstance.upgrade(request, {
        data: {},
      });
      return upgraded ? undefined : jsonResponse({ error: "WebSocket upgrade failed." }, 400);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
  websocket: {
    async open(ws) {
      console.log("[relay] Client connected");
      safeSend(ws, {
        type: "status",
        stage: "connected",
        message: "Relay connected. Send an init payload to begin.",
      });
    },
    async message(ws, message) {
      if (message instanceof Uint8Array) {
        const session = ws.data.session;
        if (!ws.data.sawBinary) {
          ws.data.sawBinary = true;
          console.log("[relay] First audio chunk received", message.byteLength);
        }
        if (!session) {
          // STT session not ready yet — drop early audio chunks silently.
          // The session connects within milliseconds of init; a few lost frames are fine.
          return;
        }

        if (session.sttSocket.readyState === WebSocket.OPEN) {
          if (session.config.sttProvider === "elevenlabs") {
            // ElevenLabs expects JSON with message_type, audio_base_64, commit, sample_rate
            const b64 = Buffer.from(message).toString("base64");
            session.sttSocket.send(
              JSON.stringify({
                message_type: "input_audio_chunk",
                audio_base_64: b64,
                commit: false,
                sample_rate: 48000,
              }),
            );
          } else {
            // Smallest AI expects raw binary chunks
            const pending = ws.data.pendingAudio ?? new Uint8Array(0);
            const combined = new Uint8Array(pending.length + message.byteLength);
            combined.set(pending, 0);
            combined.set(message, pending.length);

            let offset = 0;
            while (offset + sttChunkBytes <= combined.length) {
              session.sttSocket.send(combined.slice(offset, offset + sttChunkBytes));
              offset += sttChunkBytes;
            }

            ws.data.pendingAudio = combined.slice(offset);
          }
        }
        return;
      }

      const parsed = JSON.parse(message.toString()) as InitMessage | EndMessage;

      if (parsed.type === "end") {
        closeSession(ws);
        safeSend(ws, {
          type: "status",
          stage: "stopped",
          message: "Relay session ended.",
        });
        return;
      }

      if (parsed.type !== "init") {
        safeSend(ws, {
          type: "error",
          message: "Unsupported control message.",
        });
        return;
      }

      closeSession(ws);
      console.log("[relay] Init session", parsed);

      try {
        await attachSession(ws, {
          sourceLanguage: parsed.sourceLanguage ?? "auto",
          targetLanguage: parsed.targetLanguage,
          speakTranslation: Boolean(parsed.speakTranslation),
          voiceId: parsed.voiceId ?? null,
          ttsProvider: parsed.ttsProvider ?? "smallest",
          sttProvider: parsed.sttProvider ?? "smallest",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        safeSend(ws, {
          type: "error",
          message,
        });
      }
    },
    close(ws) {
      ws.data.pendingAudio = undefined;
      closeSession(ws);
    },
  },
});

console.log(`Interpreter OS relay listening on http://0.0.0.0:${server.port}`);
