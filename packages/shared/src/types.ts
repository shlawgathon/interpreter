export interface Session {
  id: string;
  name: string;
  code: string;
  hostId: string;
  status: "active" | "ended";
  createdAt: number;
}

export interface Participant {
  id: string;
  sessionId: string;
  userId: string;
  name: string;
  spokenLanguage: string;
  listenLanguage: string;
  voiceProfileId?: string;
  voiceCloneConsent: boolean;
  joinedAt: number;
}

export interface TranscriptEntry {
  id: string;
  sessionId: string;
  participantId: string;
  speakerName: string;
  originalText: string;
  originalLanguage: string;
  translations?: Record<string, string>;
  timestamp: number;
}

export interface VoiceProfile {
  id: string;
  userId: string;
  voiceId: string;
  status: "pending" | "ready" | "expired";
  consentedAt: number;
  expiresAt: number;
}
