import { WebSocket } from "ws";

type InitMessage = {
  type: "init";
  sourceLanguage?: string;
  targetLanguage: string;
  speakTranslation?: boolean;
  voiceId?: string | null;
};

type EndMessage = {
  type: "end";
};

type SessionConfig = {
  sourceLanguage: string;
  targetLanguage: string;
  speakTranslation: boolean;
  voiceId?: string | null;
};

type Session = {
  config: SessionConfig;
  sttSocket: WebSocket;
};

type ClientData = {
  session?: Session;
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

if (!smallestApiKey) {
  console.warn("SMALLEST_API_KEY is missing. The relay will accept websocket clients but STT and TTS will fail.");
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
  ws.send(JSON.stringify(payload));
}

function unixMs() {
  return Date.now();
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

async function synthesizeSpeech(text: string, voiceId?: string | null) {
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
      language: ttsLanguage,
      output_format: "wav",
    }),
  });

  if (!response.ok) {
    throw new Error(`Smallest TTS failed with ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: buffer.toString("base64"),
    mimeType: response.headers.get("content-type") ?? "audio/wav",
  };
}

async function attachSession(ws: ServerWebSocket<ClientData>, config: SessionConfig) {
  if (!smallestApiKey) {
    throw new Error("SMALLEST_API_KEY is not configured on the relay.");
  }

  const url = new URL(smallestSttUrl);
  url.searchParams.set("sample_rate", "16000");
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

      const startedAt = unixMs();
      const translation = await translateText(
        parsed.transcript,
        session.config.sourceLanguage,
        session.config.targetLanguage,
      );

      safeSend(ws, {
        type: "transcript",
        transcript: parsed.transcript,
        translation,
        finalSegment: Boolean(parsed.is_final),
        detectedLanguage: parsed.language ?? null,
        latencyMs: unixMs() - startedAt,
        receivedAt: unixMs(),
      });

      if (parsed.is_final && session.config.speakTranslation) {
        const tts = await synthesizeSpeech(translation, session.config.voiceId);
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
    safeSend(ws, {
      type: "error",
      message: `Smallest STT websocket error: ${message}`,
    });
  });

  sttSocket.on("close", () => {
    safeSend(ws, {
      type: "status",
      stage: "relay_closed",
      message: "Smallest STT websocket closed.",
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
      safeSend(ws, {
        type: "status",
        stage: "connected",
        message: "Relay connected. Send an init payload to begin.",
      });
    },
    async message(ws, message) {
      if (message instanceof Uint8Array) {
        const session = ws.data.session;
        if (!session) {
          safeSend(ws, {
            type: "error",
            message: "No relay session exists yet. Send the init payload first.",
          });
          return;
        }

        if (session.sttSocket.readyState === WebSocket.OPEN) {
          session.sttSocket.send(message);
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

      try {
        await attachSession(ws, {
          sourceLanguage: parsed.sourceLanguage ?? "auto",
          targetLanguage: parsed.targetLanguage,
          speakTranslation: Boolean(parsed.speakTranslation),
          voiceId: parsed.voiceId ?? null,
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
      closeSession(ws);
    },
  },
});

console.log(`Interpreter OS relay listening on http://0.0.0.0:${server.port}`);
