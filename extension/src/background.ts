// ── Interpreter Service Worker ──
// Orchestrates: popup ↔ offscreen ↔ backend WebSocket

const BACKEND_WS_URL = "ws://localhost:8000/ws/translate";

interface TranslationState {
  isCapturing: boolean;
  captureStartedAt: number | null;
  tabId: number | null;
  backendSocket: WebSocket | null;
  sourceLang: string;
  targetLang: string;
  ttsProvider: "minimax" | "speechmatics";
  outputDeviceId: string | null;
}

const state: TranslationState = {
  isCapturing: false,
  captureStartedAt: null,
  tabId: null,
  backendSocket: null,
  sourceLang: "en",
  targetLang: "es",
  ttsProvider: "speechmatics",
  outputDeviceId: null,
};

// ── Message Types ──
type Message =
  | {
      type: "start-capture";
      sourceLang: string;
      targetLang: string;
      ttsProvider?: "minimax" | "speechmatics";
      tabId?: number;
    }
  | { type: "stop-capture" }
  | { type: "audio-data"; data: number[] }
  | { type: "translated-audio"; data: number[] }
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "translated-text-partial"; text: string }
  | { type: "translated-text"; text: string }
  | { type: "status"; status: string }
  | { type: "error"; message: string }
  | { type: "set-output-device"; deviceId: string }
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
        tts_provider: state.ttsProvider,
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
        } else if (msg.type === "translated_text_partial") {
          broadcastToPopup({
            type: "translated-text-partial",
            text: msg.text,
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

function isCapturableTabUrl(url?: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (
    lower.startsWith("chrome://") ||
    lower.startsWith("chrome-extension://") ||
    lower.startsWith("edge://") ||
    lower.startsWith("about:")
  ) {
    return false;
  }
  return true;
}

async function resolveCaptureTabId(
  requestedTabId?: number,
  senderTabId?: number
): Promise<number | null> {
  // Highest priority: explicit tab ID from popup.
  if (requestedTabId) {
    try {
      const tab = await chrome.tabs.get(requestedTabId);
      if (tab.id && isCapturableTabUrl(tab.url)) return tab.id;
    } catch {
      // fall through to other strategies
    }
  }

  // Second priority: sender tab (content script / widget).
  if (senderTabId) {
    try {
      const tab = await chrome.tabs.get(senderTabId);
      if (tab.id && isCapturableTabUrl(tab.url)) return tab.id;
    } catch {
      // fall through to other strategies
    }
  }

  // Prefer the most recently focused Google Meet tab if present.
  const meetTabs = await chrome.tabs.query({ url: ["https://meet.google.com/*"] });
  if (meetTabs.length > 0) {
    meetTabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const meet = meetTabs.find((tab) => tab.id && isCapturableTabUrl(tab.url));
    if (meet?.id) return meet.id;
  }

  // Fallback: active tab in last focused normal browser window.
  const [focusedActive] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (focusedActive?.id && isCapturableTabUrl(focusedActive.url)) {
    return focusedActive.id;
  }

  // Final fallback: any active capturable tab.
  const activeTabs = await chrome.tabs.query({ active: true });
  const candidate = activeTabs.find((tab) => tab.id && isCapturableTabUrl(tab.url));
  return candidate?.id ?? null;
}

// ── Start / Stop Capture ──
async function startCapture(
  sourceLang: string,
  targetLang: string,
  ttsProvider?: "minimax" | "speechmatics",
  requestedTabId?: number,
  senderTabId?: number
): Promise<void> {
  state.sourceLang = sourceLang;
  state.targetLang = targetLang;
  if (ttsProvider === "speechmatics" || ttsProvider === "minimax") {
    state.ttsProvider = ttsProvider;
  }

  const tabId = await resolveCaptureTabId(requestedTabId, senderTabId);
  if (!tabId) {
    broadcastToPopup({ type: "error", message: "No active tab found" });
    return;
  }

  state.tabId = tabId;
  console.log("[BG] Using tab for capture:", tabId);

  // Connect to backend first
  connectToBackend();

  // Create offscreen document
  await ensureOffscreenDocument();

  // Get stream ID for tab capture
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId(
      { targetTabId: tabId },
      (id?: string) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!id) {
          reject(new Error("Failed to get tab capture stream ID"));
          return;
        }
        resolve(id);
      }
    );
  });

  // Tell offscreen to start capturing
  chrome.runtime.sendMessage({
    type: "start-capture",
    target: "offscreen",
    streamId,
    outputDeviceId: state.outputDeviceId,
  });

  state.isCapturing = true;
  state.captureStartedAt = Date.now();
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
  state.captureStartedAt = null;
  broadcastToPopup({ type: "status", status: "idle" });
  state.tabId = null;
}

// ── Broadcast to Popup + Content Script ──
function broadcastToPopup(msg: object): void {
  const fullMsg = { ...msg, target: "popup" };
  chrome.runtime.sendMessage(fullMsg).catch(() => {});
  if (state.tabId) {
    chrome.tabs.sendMessage(state.tabId, fullMsg).catch(() => {});
  }
}

// ── Message Listener ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target && message.target !== "background") return;

  switch (message.type) {
    case "start-capture": {
      const senderTabId = sender.tab?.id;
      startCapture(
        message.sourceLang,
        message.targetLang,
        message.ttsProvider,
        message.tabId,
        senderTabId
      )
        .then(() => sendResponse({ success: true }))
        .catch((e) => {
          broadcastToPopup({ type: "error", message: e.message });
          sendResponse({ success: false, error: e.message });
        });
      return true;
    }

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

    case "error":
      broadcastToPopup({
        type: "error",
        message: message.message || "An unknown extension error occurred",
      });
      break;

    case "set-output-device":
      state.outputDeviceId = message.deviceId || null;
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
        captureStartedAt: state.captureStartedAt,
        sourceLang: state.sourceLang,
        targetLang: state.targetLang,
        ttsProvider: state.ttsProvider,
        outputDeviceId: state.outputDeviceId,
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
