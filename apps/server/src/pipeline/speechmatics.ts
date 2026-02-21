import { RealtimeClient } from "@speechmatics/real-time-client";
import { createSpeechmaticsJWT } from "@speechmatics/auth";
import type { SessionManager } from "../session/manager";
import { translateAndSpeak } from "./translate";

export interface SpeechPipeline {
  feedAudio(pcm: ArrayBuffer): void;
  close(): void;
}

interface PipelineOptions {
  participantId: string;
  spokenLanguage: string;
  sessionManager: SessionManager;
  sessionId: string;
}

/**
 * Creates a per-speaker STT pipeline using the Speechmatics JS SDK.
 * Final transcripts are forwarded to translation → TTS.
 */
export function createSpeechPipeline(opts: PipelineOptions): SpeechPipeline {
  const { participantId, spokenLanguage, sessionManager, sessionId } = opts;
  const apiKey = process.env.SPEECHMATICS_API_KEY;

  const client = new RealtimeClient();
  let ready = false;
  const pendingAudio: ArrayBuffer[] = [];

  let sentenceBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY_MS = 1500;

  function flushSentence() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const text = sentenceBuffer.trim();
    sentenceBuffer = "";
    if (!text || text.replace(/[.,!?;:\s]/g, "").length === 0) return;

    console.log(`[stt] sentence: "${text}"`);
    const speakerName = sessionManager.getParticipantName(sessionId, participantId);
    const targetLangs = sessionManager.getAllListenerLanguages(sessionId);

    for (const targetLang of targetLangs) {
      if (targetLang === spokenLanguage) continue;
      const voiceId = sessionManager.getParticipantVoiceId(sessionId, participantId);
      translateAndSpeak({
        text,
        sourceLang: spokenLanguage,
        targetLang,
        speakerId: participantId,
        speakerName,
        sessionId,
        sessionManager,
        voiceId,
      });
    }
  }

  client.addEventListener("receiveMessage", ({ data }: any) => {
    if (data.message === "RecognitionStarted") {
      ready = true;
      for (const chunk of pendingAudio) {
        client.sendAudio(chunk);
      }
      pendingAudio.length = 0;
      console.log(`[stt] recognition started for ${participantId}`);
    }

    const isFinal = data.message === "AddTranscript";
    const isPartial = data.message === "AddPartialTranscript";

    if (!isFinal && !isPartial) return;

    const text = (data.results ?? [])
      .map((r: any) => r.alternatives?.[0]?.content ?? "")
      .join(" ")
      .trim();

    if (!text) return;

    if (isFinal) {
      sentenceBuffer += (sentenceBuffer ? " " : "") + text;

      const endsWithPunctuation = /[.!?]$/.test(text);
      if (endsWithPunctuation) {
        flushSentence();
      } else {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flushSentence, FLUSH_DELAY_MS);
      }
    }
  });

  client.addEventListener("receiveMessage", ({ data }: any) => {
    if (data.message === "Error") {
      console.error("[stt] server error:", data.reason);
    }
  });

  async function connect() {
    if (!apiKey) {
      console.warn("[stt] SPEECHMATICS_API_KEY not set, pipeline disabled");
      return;
    }

    console.log(`[stt] connecting for ${participantId} (lang=${spokenLanguage})...`);

    try {
      const jwt = await createSpeechmaticsJWT({
        type: "rt",
        apiKey,
        ttl: 3600,
      });
      console.log("[stt] JWT created, starting session...");

      await client.start(jwt, {
        transcription_config: {
          language: spokenLanguage,
          operating_point: "enhanced",
          max_delay: 2.0,
          enable_partials: true,
        },
        audio_format: {
          type: "raw",
          encoding: "pcm_s16le",
          sample_rate: 16000,
        },
      });
      console.log("[stt] client.start() resolved");
    } catch (err) {
      console.error("[stt] Failed to connect:", err);
    }
  }

  connect();

  return {
    feedAudio(pcm: ArrayBuffer) {
      if (ready) {
        client.sendAudio(pcm);
      } else {
        pendingAudio.push(pcm);
        if (pendingAudio.length > 50) pendingAudio.shift();
      }
    },

    close() {
      try {
        client.stopRecognition();
      } catch {
        // already closed
      }
    },
  };
}
