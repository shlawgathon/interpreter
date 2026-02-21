/**
 * WebSocket message protocol between Chrome extension and streaming server.
 *
 * Binary frames use a 1-byte type prefix:
 *   0x01 = mic audio (client → server)
 *   0x02 = dubbed audio (server → client)
 *
 * JSON frames are plain text with a `type` discriminator.
 */

// ── Client → Server (JSON) ──────────────────────────────────────────

export interface JoinMessage {
  type: "join";
  sessionCode: string;
  participantName: string;
  spokenLanguage: string;
  listenLanguage: string;
  voiceProfileId?: string;
}

export interface LeaveMessage {
  type: "leave";
}

export interface UpdateSettingsMessage {
  type: "updateSettings";
  listenLanguage?: string;
  muteOriginal?: boolean;
}

export type ClientJsonMessage =
  | JoinMessage
  | LeaveMessage
  | UpdateSettingsMessage;

// ── Server → Client (JSON) ──────────────────────────────────────────

export interface JoinedMessage {
  type: "joined";
  sessionId: string;
  participantId: string;
  participants: Array<{
    id: string;
    name: string;
    spokenLanguage: string;
  }>;
}

export interface ParticipantJoinedMessage {
  type: "participantJoined";
  participant: {
    id: string;
    name: string;
    spokenLanguage: string;
  };
}

export interface ParticipantLeftMessage {
  type: "participantLeft";
  participantId: string;
}

export interface TranscriptMessage {
  type: "transcript";
  speakerId: string;
  speakerName: string;
  original: string;
  translated: string;
  isFinal: boolean;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerJsonMessage =
  | JoinedMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | TranscriptMessage
  | ErrorMessage;

// ── Binary frame prefixes ────────────────────────────────────────────

export const AUDIO_PREFIX = {
  MIC: 0x01,
  DUB: 0x02,
} as const;

// ── Helpers ──────────────────────────────────────────────────────────

export function encodeAudioFrame(
  prefix: number,
  speakerId: string,
  pcm: ArrayBuffer,
): ArrayBuffer {
  const idBytes = new TextEncoder().encode(speakerId);
  const buf = new ArrayBuffer(1 + 1 + idBytes.length + pcm.byteLength);
  const view = new DataView(buf);
  view.setUint8(0, prefix);
  view.setUint8(1, idBytes.length);
  new Uint8Array(buf, 2, idBytes.length).set(idBytes);
  new Uint8Array(buf, 2 + idBytes.length).set(new Uint8Array(pcm));
  return buf;
}

export function decodeAudioFrame(buf: ArrayBuffer): {
  prefix: number;
  speakerId: string;
  pcm: ArrayBuffer;
} {
  const view = new DataView(buf);
  const prefix = view.getUint8(0);
  const idLen = view.getUint8(1);
  const speakerId = new TextDecoder().decode(
    new Uint8Array(buf, 2, idLen),
  );
  const pcm = buf.slice(2 + idLen);
  return { prefix, speakerId, pcm };
}
