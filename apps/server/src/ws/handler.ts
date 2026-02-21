import type { ServerWebSocket, WebSocketHandler } from "bun";
import {
  AUDIO_PREFIX,
  decodeAudioFrame,
  type ClientJsonMessage,
} from "@interpreter/shared";
import type { SessionManager } from "../session/manager";

export interface WsData {
  connectedAt: number;
  participantId?: string;
  sessionId?: string;
}

export function handleWebSocket(
  sessions: SessionManager,
): WebSocketHandler<WsData> {
  return {
    perMessageDeflate: false,

    open(ws) {
      console.log("[ws] connection opened");
    },

    message(ws, message) {
      if (typeof message === "string") {
        handleJsonMessage(ws, sessions, message);
        return;
      }

      handleBinaryMessage(ws, sessions, message);
    },

    close(ws, code, reason) {
      const { participantId, sessionId } = ws.data;
      if (participantId && sessionId) {
        sessions.removeParticipant(sessionId, participantId);
        console.log(`[ws] participant ${participantId} left session ${sessionId}`);
      }
    },

    drain(ws) {
      // backpressure relief -- socket is ready for more data
    },
  };
}

function handleJsonMessage(
  ws: ServerWebSocket<WsData>,
  sessions: SessionManager,
  raw: string,
) {
  let msg: ClientJsonMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    return;
  }

  switch (msg.type) {
    case "join": {
      const result = sessions.addParticipant(msg.sessionCode, {
        name: msg.participantName,
        spokenLanguage: msg.spokenLanguage,
        listenLanguage: msg.listenLanguage,
        voiceProfileId: msg.voiceProfileId,
        ws,
      });

      if (!result) {
        ws.send(
          JSON.stringify({ type: "error", message: "Session not found" }),
        );
        return;
      }

      ws.data.participantId = result.participantId;
      ws.data.sessionId = result.sessionId;

      ws.send(
        JSON.stringify({
          type: "joined",
          sessionId: result.sessionId,
          participantId: result.participantId,
          participants: result.participants,
        }),
      );

      sessions.broadcastParticipantJoined(result.sessionId, {
        id: result.participantId,
        name: msg.participantName,
        spokenLanguage: msg.spokenLanguage,
      });
      break;
    }

    case "leave": {
      const { participantId, sessionId } = ws.data;
      if (participantId && sessionId) {
        sessions.removeParticipant(sessionId, participantId);
        ws.data.participantId = undefined;
        ws.data.sessionId = undefined;
      }
      break;
    }

    case "updateSettings": {
      const { participantId, sessionId } = ws.data;
      if (participantId && sessionId) {
        sessions.updateParticipant(sessionId, participantId, {
          listenLanguage: msg.listenLanguage,
        });
      }
      break;
    }
  }
}

function handleBinaryMessage(
  ws: ServerWebSocket<WsData>,
  sessions: SessionManager,
  data: ArrayBuffer | Buffer,
) {
  const buf = data instanceof ArrayBuffer
    ? data
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const { prefix, speakerId, pcm } = decodeAudioFrame(buf);

  if (prefix !== AUDIO_PREFIX.MIC) return;

  const { sessionId } = ws.data;
  if (!sessionId) return;

  sessions.routeAudio(sessionId, speakerId, pcm);
}
