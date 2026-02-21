import { getLanguageName } from "@interpreter/shared";
import type { SessionManager } from "../session/manager";
import { synthesizeSpeech } from "./tts";
import { persistTranscript } from "../convex/client";

interface TranslateOpts {
  text: string;
  sourceLang: string;
  targetLang: string;
  speakerId: string;
  speakerName: string;
  sessionId: string;
  sessionManager: SessionManager;
  voiceId?: string;
}

const MINIMAX_CHAT_URL = "https://api.minimax.chat/v1/text/chatcompletion_v2";

/**
 * Translates text via MiniMax chat completion (streaming),
 * then feeds the complete translation to TTS.
 */
export async function translateAndSpeak(opts: TranslateOpts): Promise<void> {
  const {
    text, sourceLang, targetLang, speakerId,
    speakerName, sessionId, sessionManager, voiceId,
  } = opts;

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn("[translate] MINIMAX_API_KEY not set, skipping");
    sessionManager.deliverTranscript(
      sessionId, speakerId, speakerName, text,
      `[translation unavailable] ${text}`, targetLang, true,
    );
    return;
  }

  const srcName = getLanguageName(sourceLang);
  const tgtName = getLanguageName(targetLang);

  try {
    const res = await fetch(MINIMAX_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          {
            role: "system",
            content: `You are a real-time speech translator. Translate the following ${srcName} text to ${tgtName}. Output ONLY the translation — no quotes, no explanations, no extra text.`,
          },
          { role: "user", content: text },
        ],
        stream: true,
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!res.ok) {
      console.error("[translate] API error:", res.status, await res.text());
      return;
    }

    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let translated = "";

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
          const delta =
            chunk?.choices?.[0]?.delta?.content ?? "";
          translated += delta;
        } catch {
          // skip non-JSON lines
        }
      }
    }

    translated = translated.trim();
    if (!translated) return;

    sessionManager.deliverTranscript(
      sessionId, speakerId, speakerName,
      text, translated, targetLang, true,
    );

    persistTranscript({
      sessionId,
      participantId: speakerId,
      speakerName,
      originalText: text,
      originalLanguage: sourceLang,
      translations: { [targetLang]: translated },
    });

    await synthesizeSpeech({
      text: translated,
      targetLang,
      speakerId,
      sessionId,
      sessionManager,
      voiceId,
    });
  } catch (err) {
    console.error("[translate] error:", err);
  }
}
