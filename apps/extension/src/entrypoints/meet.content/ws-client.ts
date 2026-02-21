import {
  AUDIO_PREFIX,
  encodeAudioFrame,
  decodeAudioFrame,
  type ClientJsonMessage,
  type ServerJsonMessage,
} from "@interpreter/shared";

export interface WsClientHandle {
  connect(url: string): void;
  sendJson(msg: ClientJsonMessage): void;
  sendAudio(speakerId: string, pcm: ArrayBuffer): void;
  disconnect(): void;
  onJsonMessage: ((msg: ServerJsonMessage) => void) | null;
  onAudioMessage: ((speakerId: string, pcm: ArrayBuffer) => void) | null;
  onStatusChange: ((status: "connecting" | "connected" | "disconnected") => void) | null;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 16000;

export function createWsClient(): WsClientHandle {
  let ws: WebSocket | null = null;
  let url = "";
  let reconnectDelay = RECONNECT_BASE_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionalClose = false;

  const handle: WsClientHandle = {
    onJsonMessage: null,
    onAudioMessage: null,
    onStatusChange: null,

    connect(serverUrl: string) {
      url = serverUrl;
      intentionalClose = false;
      openConnection();
    },

    sendJson(msg: ClientJsonMessage) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },

    sendAudio(speakerId: string, pcm: ArrayBuffer) {
      if (ws?.readyState === WebSocket.OPEN) {
        const frame = encodeAudioFrame(AUDIO_PREFIX.MIC, speakerId, pcm);
        ws.send(frame);
      }
    },

    disconnect() {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    },
  };

  function openConnection() {
    handle.onStatusChange?.("connecting");

    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS;
      handle.onStatusChange?.("connected");
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as ServerJsonMessage;
          handle.onJsonMessage?.(msg);
        } catch {
          /* ignore malformed JSON */
        }
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        const { prefix, speakerId, pcm } = decodeAudioFrame(event.data);
        if (prefix === AUDIO_PREFIX.DUB) {
          handle.onAudioMessage?.(speakerId, pcm);
        }
      }
    };

    ws.onclose = () => {
      handle.onStatusChange?.("disconnected");
      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function scheduleReconnect() {
    reconnectTimer = setTimeout(() => {
      console.log(`[ws] reconnecting in ${reconnectDelay}ms...`);
      openConnection();
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }, reconnectDelay);
  }

  return handle;
}
