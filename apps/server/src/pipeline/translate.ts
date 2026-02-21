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

const MINIMAX_CHAT_URL = "https://api.minimax.io/v1/text/chatcompletion_v2";

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function translateAndSpeak(opts: TranslateOpts): Promise<void> {
  const {
    text, sourceLang, targetLang, speakerId,
    speakerName, sessionId, sessionManager, voiceId,
  } = opts;

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn("[translate] MINIMAX_API_KEY not set, skipping");
    return;
  }

  if (text.replace(/[.,!?;:\s]/g, "").length === 0) return;

  const srcName = getLanguageName(sourceLang);
  const tgtName = getLanguageName(targetLang);

  console.log(`[translate] "${text}" (${sourceLang} → ${targetLang})`);

  try {
    const res = await fetch(MINIMAX_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-M2.5-highspeed",
        messages: [
          {
            role: "system",
            content: `You are a live interpreter. The speaker is talking in ${srcName}. Translate their words into ${tgtName} in first person, exactly as they said it — as if you ARE them speaking ${tgtName}. Output ONLY the direct translation. No narration, no notes, no quotes, no third-person rewording.`,
          },
          { role: "user", content: text },
        ],
        stream: false,
        temperature: 0.1,
        max_tokens: 300,
      }),
    });

    if (!res.ok) {
      console.error("[translate] API error:", res.status, await res.text());
      return;
    }

    const json = await res.json();
    let translated: string =
      json?.choices?.[0]?.message?.content ?? "";

    translated = stripThinkTags(translated).trim();

    if (!translated) {
      console.warn("[translate] got empty translation");
      return;
    }

    console.log(`[translate] ✓ "${text}" → "${translated}"`);

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
