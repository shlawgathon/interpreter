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

    const speakerName = sessionManager.getParticipantName(sessionId, participantId);
    const targetLangs = sessionManager.getListenerLanguages(sessionId, participantId);

    for (const targetLang of targetLangs) {
      if (targetLang === spokenLanguage) {
        sessionManager.deliverTranscript(
          sessionId, participantId, speakerName,
          text, text, targetLang, isFinal,
        );
        continue;
      }

      if (isPartial) {
        sessionManager.deliverTranscript(
          sessionId, participantId, speakerName,
          text, `[translating...] ${text}`, targetLang, false,
        );
      }

      if (isFinal) {
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

    try {
      const jwt = await createSpeechmaticsJWT({
        type: "rt",
        apiKey,
        ttl: 3600,
      });

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
