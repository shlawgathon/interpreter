import type { SessionManager } from "../session/manager";

interface TTSOpts {
  text: string;
  targetLang: string;
  speakerId: string;
  sessionId: string;
  sessionManager: SessionManager;
  voiceId?: string;
}

const MINIMAX_TTS_HTTP = "https://api.minimax.io/v1/t2a_v2";

const DEFAULT_VOICES: Record<string, string> = {
  en: "Wise_Woman",
  es: "Wise_Woman",
  hi: "Wise_Woman",
  zh: "Wise_Woman",
  fr: "Wise_Woman",
  de: "Wise_Woman",
  ja: "Wise_Woman",
  ko: "Wise_Woman",
  pt: "Wise_Woman",
  ar: "Wise_Woman",
  ru: "Wise_Woman",
  it: "Wise_Woman",
};

/**
 * Synthesizes translated text into speech using MiniMax T2A v2 (speech-2.6-hd).
 * Uses HTTP streaming; audio arrives as hex-encoded chunks in JSON lines.
 */
export async function synthesizeSpeech(opts: TTSOpts): Promise<void> {
  const { text, targetLang, speakerId, sessionId, sessionManager, voiceId } = opts;

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn("[tts] MINIMAX_API_KEY not set, skipping");
    return;
  }

  if (!text.trim()) return;

  const voice = voiceId ?? DEFAULT_VOICES[targetLang] ?? "Wise_Woman";

  try {
    const res = await fetch(MINIMAX_TTS_HTTP, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "speech-2.6-hd",
        text,
        voice_setting: {
          voice_id: voice,
          speed: 1.0,
          vol: 1.0,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 24000,
          format: "pcm",
          channel: 1,
        },
        stream: true,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[tts] API error ${res.status}:`, errBody);
      return;
    }

    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;

        const jsonStr = trimmed.startsWith("data: ")
          ? trimmed.slice(6)
          : trimmed;

        try {
          const chunk = JSON.parse(jsonStr);
          const hexAudio = chunk?.data?.audio ?? chunk?.audio;

          if (hexAudio && typeof hexAudio === "string") {
            const bytes = hexToBytes(hexAudio);
            if (bytes.byteLength > 0) {
              sessionManager.deliverDubbedAudio(
                sessionId,
                speakerId,
                targetLang,
                bytes,
              );
            }
          }
        } catch {
          // not a JSON line, skip
        }
      }
    }
  } catch (err) {
    console.error("[tts] error:", err);
  }
}

function hexToBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}
