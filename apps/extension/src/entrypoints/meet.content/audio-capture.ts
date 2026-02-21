/**
 * Captures the Google Meet tab's audio via chrome.tabCapture + offscreen document.
 * Audio chunks arrive as messages from the background script.
 */

export interface AudioCaptureHandle {
  start(): Promise<void>;
  stop(): void;
  onChunk: ((pcm: ArrayBuffer) => void) | null;
}

export function createAudioCapture(): AudioCaptureHandle {
  let listening = false;

  function messageHandler(msg: any) {
    if (msg.type === "audioChunk" && msg.buffer && listening) {
      const int16 = new Int16Array(msg.buffer);
      handle.onChunk?.(int16.buffer);
    }
  }

  const handle: AudioCaptureHandle = {
    onChunk: null,

    async start() {
      chrome.runtime.onMessage.addListener(messageHandler);
      listening = true;

      const response = await browser.runtime.sendMessage({
        type: "requestTabCapture",
      });

      if (response?.error) {
        listening = false;
        chrome.runtime.onMessage.removeListener(messageHandler);
        throw new Error(`Tab capture failed: ${response.error}`);
      }

      console.log("[audio] tab capture started via offscreen");
    },

    stop() {
      listening = false;
      chrome.runtime.onMessage.removeListener(messageHandler);
      browser.runtime.sendMessage({ type: "stopTabCapture" });
      console.log("[audio] capture stopped");
    },
  };

  return handle;
}
