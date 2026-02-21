import type { ServerWebSocket } from "bun";
import {
  AUDIO_PREFIX,
  encodeAudioFrame,
  type ServerJsonMessage,
} from "@interpreter/shared";
import type { WsData } from "./handler";

const BACKPRESSURE_LIMIT = 1024 * 64; // 64KB — drop audio if buffered beyond this

export function sendJson(
  ws: ServerWebSocket<WsData>,
  msg: ServerJsonMessage,
): void {
  ws.send(JSON.stringify(msg));
}

/**
 * Send dubbed audio to a client. Drops the frame if the
 * WebSocket's send buffer exceeds the backpressure limit
 * (prefer freshness over completeness for real-time audio).
 */
export function sendDubbedAudio(
  ws: ServerWebSocket<WsData>,
  speakerId: string,
  pcm: ArrayBuffer,
): void {
  if (ws.getBufferedAmount() > BACKPRESSURE_LIMIT) {
    return; // drop frame to prevent latency buildup
  }
  const frame = encodeAudioFrame(AUDIO_PREFIX.DUB, speakerId, pcm);
  ws.send(frame);
}
