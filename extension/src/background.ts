// ── Interpreter Service Worker ──
// Orchestrates: popup ↔ offscreen ↔ backend WebSocket

const BACKEND_WS_URL = "ws://localhost:8000/ws/translate";

interface TranslationState {
  isCapturing: boolean;
  tabId: number | null;
  backendSocket: WebSocket | null;
  sourceLang: string;
  targetLang: string;
}

const state: TranslationState = {
  isCapturing: false,
  tabId: null,
  backendSocket: null,
  sourceLang: "en",
  targetLang: "es",
};

// ── Message Types ──
type Message =
  | { type: "start-capture"; sourceLang: string; targetLang: string }
  | { type: "stop-capture" }
  | { type: "audio-data"; data: number[] }
  | { type: "translated-audio"; data: number[] }
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "translated-text"; text: string }
  | { type: "status"; status: string }
  | { type: "error"; message: string }
  | { type: "get-state" };

// ── Offscreen Document Management ──
async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({});
  const offscreen = contexts.find(
    (c) => c.contextType === "OFFSCREEN_DOCUMENT"
  );
  if (!offscreen) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capturing tab audio for live translation",
    });
  }
}

async function removeOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({});
  const offscreen = contexts.find(
    (c) => c.contextType === "OFFSCREEN_DOCUMENT"
  );
  if (offscreen) {
    await chrome.offscreen.closeDocument();
  }
}

// ── Backend WebSocket Connection ──
function connectToBackend(): void {
  if (state.backendSocket?.readyState === WebSocket.OPEN) return;

  const ws = new WebSocket(BACKEND_WS_URL);
  state.backendSocket = ws;

  ws.onopen = () => {
    console.log("[BG] Connected to backend");
    // Send config
    ws.send(
      JSON.stringify({
        type: "config",
        source_lang: state.sourceLang,
        target_lang: state.targetLang,
      })
    );
    broadcastToPopup({ type: "status", status: "connected" });
  };

  ws.onmessage = (event) => {
    if (event.data instanceof Blob) {
      // Binary = translated audio from backend
      event.data.arrayBuffer().then((buffer) => {
        const audioData = Array.from(new Uint8Array(buffer));
        // Forward translated audio to offscreen for playback
        chrome.runtime.sendMessage({
          type: "translated-audio",
          target: "offscreen",
          data: audioData,
        });
      });
    } else {
      // JSON = transcript or status
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "transcript") {
          broadcastToPopup({
            type: "transcript",
            text: msg.text,
            isFinal: msg.is_final,
          });
        } else if (msg.type === "translated_text") {
          broadcastToPopup({
            type: "translated-text",
            text: msg.text,
          });
        } else if (msg.type === "error") {
          broadcastToPopup({ type: "error", message: msg.message });
        }
      } catch {
        console.warn("[BG] Unknown message from backend:", event.data);
      }
    }
  };

  ws.onerror = (e) => {
    console.error("[BG] Backend WebSocket error:", e);
    broadcastToPopup({
      type: "error",
      message: "Backend connection failed. Is the server running?",
    });
  };

  ws.onclose = () => {
    console.log("[BG] Backend WebSocket closed");
    state.backendSocket = null;
    if (state.isCapturing) {
      broadcastToPopup({
        type: "status",
        status: "disconnected",
      });
    }
  };
}

function disconnectBackend(): void {
  if (state.backendSocket) {
    state.backendSocket.close();
    state.backendSocket = null;
  }
}

// ── Start / Stop Capture ──
async function startCapture(
  sourceLang: string,
  targetLang: string
): Promise<void> {
  state.sourceLang = sourceLang;
  state.targetLang = targetLang;

  // Get active tab
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    broadcastToPopup({ type: "error", message: "No active tab found" });
    return;
  }

  state.tabId = tab.id;

  // Connect to backend first
  connectToBackend();

  // Create offscreen document
  await ensureOffscreenDocument();

  // Get stream ID for tab capture
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });

  // Tell offscreen to start capturing
  chrome.runtime.sendMessage({
    type: "start-capture",
    target: "offscreen",
    streamId,
  });

  state.isCapturing = true;
  broadcastToPopup({ type: "status", status: "capturing" });
}

async function stopCapture(): Promise<void> {
  // Tell offscreen to stop
  chrome.runtime.sendMessage({
    type: "stop-capture",
    target: "offscreen",
  });

  disconnectBackend();
  await removeOffscreenDocument();

  state.isCapturing = false;
  state.tabId = null;
  broadcastToPopup({ type: "status", status: "idle" });
}

// ── Broadcast to Popup ──
function broadcastToPopup(msg: object): void {
  chrome.runtime.sendMessage({ ...msg, target: "popup" }).catch(() => {
    // Popup might be closed, ignore
  });
}

// ── Message Listener ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target && message.target !== "background") return;

  switch (message.type) {
    case "start-capture":
      startCapture(message.sourceLang, message.targetLang)
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true; // async response

    case "stop-capture":
      stopCapture()
        .then(() => sendResponse({ success: true }))
        .catch((e) => sendResponse({ success: false, error: e.message }));
      return true;

    case "audio-data":
      // PCM audio from offscreen → forward to backend as binary
      if (state.backendSocket?.readyState === WebSocket.OPEN) {
        const bytes = new Uint8Array(message.data);
        state.backendSocket.send(bytes.buffer);
      }
      break;

    case "set-output-device":
      // Forward to offscreen to set output device
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({
          type: "set-output-device",
          target: "offscreen",
          deviceId: message.deviceId,
        });
      });
      break;

    case "get-state":
      sendResponse({
        isCapturing: state.isCapturing,
        sourceLang: state.sourceLang,
        targetLang: state.targetLang,
      });
      return false;
  }
});

// ── Tab Close Handler ──
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId && state.isCapturing) {
    stopCapture();
  }
});
