import type { ServerWebSocket } from "bun";
import type { WsData } from "../ws/handler";
import { sendJson, sendDubbedAudio } from "../ws/protocol";
import { createSpeechPipeline, type SpeechPipeline } from "../pipeline/speechmatics";

interface ParticipantEntry {
  id: string;
  name: string;
  spokenLanguage: string;
  listenLanguage: string;
  voiceProfileId?: string;
  ws: ServerWebSocket<WsData>;
  pipeline?: SpeechPipeline;
}

interface SessionEntry {
  id: string;
  code: string;
  participants: Map<string, ParticipantEntry>;
}

let nextId = 1;
function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(nextId++).toString(36)}`;
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();
  private codeToSession = new Map<string, string>();
  createSession(code: string): string {
    const id = genId("sess");
    this.sessions.set(id, {
      id,
      code,
      participants: new Map(),
    });
    this.codeToSession.set(code, id);
    console.log(`[session] created ${id} with code ${code}`);
    return id;
  }

  addParticipant(
    sessionCode: string,
    info: {
      name: string;
      spokenLanguage: string;
      listenLanguage: string;
      voiceProfileId?: string;
      ws: ServerWebSocket<WsData>;
    },
  ): {
    sessionId: string;
    participantId: string;
    participants: Array<{ id: string; name: string; spokenLanguage: string }>;
  } | null {
    let sessionId = this.codeToSession.get(sessionCode);

    if (!sessionId) {
      sessionId = this.createSession(sessionCode);
    }

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const participantId = genId("part");
    const entry: ParticipantEntry = {
      id: participantId,
      ...info,
    };

    entry.pipeline = createSpeechPipeline({
      participantId,
      spokenLanguage: info.spokenLanguage,
      sessionManager: this,
      sessionId,
    });

    session.participants.set(participantId, entry);
    console.log(
      `[session] ${info.name} (${participantId}) joined ${sessionCode}`,
    );

    const participants = Array.from(session.participants.values()).map((p) => ({
      id: p.id,
      name: p.name,
      spokenLanguage: p.spokenLanguage,
    }));

    return { sessionId, participantId, participants };
  }

  removeParticipant(sessionId: string, participantId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const participant = session.participants.get(participantId);
    if (participant?.pipeline) {
      participant.pipeline.close();
    }

    session.participants.delete(participantId);

    for (const [, p] of session.participants) {
      sendJson(p.ws, { type: "participantLeft", participantId });
    }

    if (session.participants.size === 0) {
      this.sessions.delete(sessionId);
      this.codeToSession.delete(session.code);
      console.log(`[session] ${sessionId} cleaned up (empty)`);
    }
  }

  updateParticipant(
    sessionId: string,
    participantId: string,
    updates: { listenLanguage?: string },
  ): void {
    const session = this.sessions.get(sessionId);
    const participant = session?.participants.get(participantId);
    if (!participant) return;

    if (updates.listenLanguage) {
      participant.listenLanguage = updates.listenLanguage;
    }
  }

  broadcastParticipantJoined(
    sessionId: string,
    info: { id: string; name: string; spokenLanguage: string },
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [pid, p] of session.participants) {
      if (pid !== info.id) {
        sendJson(p.ws, { type: "participantJoined", participant: info });
      }
    }
  }

  routeAudio(
    sessionId: string,
    speakerId: string,
    pcm: ArrayBuffer,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const speaker = session.participants.get(speakerId);
    if (!speaker) {
      console.warn(`[audio] unknown speaker ${speakerId}`);
      return;
    }

    if (!speaker.pipeline) {
      console.log(`[audio] lazy-creating pipeline for ${speakerId}`);
      speaker.pipeline = createSpeechPipeline({
        participantId: speakerId,
        spokenLanguage: speaker.spokenLanguage,
        sessionManager: this,
        sessionId,
      });
    }

    speaker.pipeline.feedAudio(pcm);
  }

  /**
   * Called by the pipeline when translated+dubbed audio is ready
   * for a specific listener.
   */
  deliverDubbedAudio(
    sessionId: string,
    speakerId: string,
    listenLanguage: string,
    pcm: ArrayBuffer,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [, p] of session.participants) {
      if (p.listenLanguage === listenLanguage) {
        sendDubbedAudio(p.ws, speakerId, pcm);
      }
    }
  }

  /**
   * Called by the pipeline when a transcript is available.
   */
  deliverTranscript(
    sessionId: string,
    speakerId: string,
    speakerName: string,
    original: string,
    translated: string,
    targetLang: string,
    isFinal: boolean,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [, p] of session.participants) {
      if (p.listenLanguage === targetLang) {
        sendJson(p.ws, {
          type: "transcript",
          speakerId,
          speakerName,
          original,
          translated,
          isFinal,
        });
      }
    }
  }

  getListenerLanguages(sessionId: string, excludeParticipantId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const langs = new Set<string>();
    for (const [pid, p] of session.participants) {
      if (pid !== excludeParticipantId) {
        langs.add(p.listenLanguage);
      }
    }
    return Array.from(langs);
  }

  getAllListenerLanguages(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    const langs = new Set<string>();
    for (const [, p] of session.participants) {
      langs.add(p.listenLanguage);
    }
    return Array.from(langs);
  }

  broadcastTranscript(
    sessionId: string,
    speakerId: string,
    speakerName: string,
    original: string,
    translated: string,
    targetLang: string,
    isFinal: boolean,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const [, p] of session.participants) {
      if (p.listenLanguage === targetLang) {
        sendJson(p.ws, {
          type: "transcript",
          speakerId,
          speakerName,
          original,
          translated,
          isFinal,
        });
      }
    }
  }

  getParticipantName(sessionId: string, participantId: string): string {
    const session = this.sessions.get(sessionId);
    return session?.participants.get(participantId)?.name ?? "Unknown";
  }

  getParticipantVoiceId(sessionId: string, participantId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.participants.get(participantId)?.voiceProfileId;
  }
}
