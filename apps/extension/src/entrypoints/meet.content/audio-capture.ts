/**
 * Receives remote WebRTC audio from the injected webrtc-intercept.js
 * via window.postMessage. No mic access, no permissions needed.
 */

export interface AudioCaptureHandle {
  start(): Promise<void>;
  stop(): void;
  onChunk: ((pcm: ArrayBuffer) => void) | null;
}

export function createAudioCapture(): AudioCaptureHandle {
  let listening = false;

  function messageHandler(e: MessageEvent) {
    if (
      e.data?.type === "__interpreter_audio_chunk" &&
      e.data.buffer &&
      listening
    ) {
      const int16 = new Int16Array(e.data.buffer);
      handle.onChunk?.(int16.buffer);
    }
  }

  const handle: AudioCaptureHandle = {
    onChunk: null,

    async start() {
      window.addEventListener("message", messageHandler);
      listening = true;
      window.postMessage({ type: "__interpreter_start_capture" }, "*");
      console.log("[audio] listening for WebRTC remote audio");
    },

    stop() {
      listening = false;
      window.removeEventListener("message", messageHandler);
      window.postMessage({ type: "__interpreter_stop_capture" }, "*");
      console.log("[audio] capture stopped");
    },
  };

  return handle;
}
