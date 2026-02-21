/**
 * Captures the user's microphone as 16-bit PCM at 16kHz using AudioWorklet.
 * Falls back to ScriptProcessorNode if AudioWorklet is unavailable.
 */

const SAMPLE_RATE = 16000;

export interface AudioCaptureHandle {
  start(): Promise<void>;
  stop(): void;
  onChunk: ((pcm: ArrayBuffer) => void) | null;
}

export function createAudioCapture(): AudioCaptureHandle {
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let fallbackProcessor: ScriptProcessorNode | null = null;

  const handle: AudioCaptureHandle = {
    onChunk: null,

    async start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      source = audioCtx.createMediaStreamSource(stream);

      try {
        const workletUrl = browser.runtime.getURL("/pcm-worklet.js");
        await audioCtx.audioWorklet.addModule(workletUrl);
        workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");

        workletNode.port.onmessage = (e) => {
          if (e.data.type === "pcm") {
            handle.onChunk?.(e.data.buffer);
          }
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
        console.log("[audio] capture started (AudioWorklet)");
      } catch (err) {
        console.warn("[audio] AudioWorklet unavailable, using ScriptProcessor fallback:", err);
        const bufferSize = Math.round((SAMPLE_RATE * 0.2));
        fallbackProcessor = audioCtx.createScriptProcessor(
          nextPow2(bufferSize), 1, 1,
        );
        fallbackProcessor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = float32ToInt16(float32);
          handle.onChunk?.(int16.buffer);
        };
        source.connect(fallbackProcessor);
        fallbackProcessor.connect(audioCtx.destination);
        console.log("[audio] capture started (ScriptProcessor fallback)");
      }
    },

    stop() {
      workletNode?.disconnect();
      fallbackProcessor?.disconnect();
      source?.disconnect();
      audioCtx?.close();
      stream?.getTracks().forEach((t) => t.stop());
      workletNode = null;
      fallbackProcessor = null;
      source = null;
      audioCtx = null;
      stream = null;
      console.log("[audio] capture stopped");
    },
  };

  return handle;
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function nextPow2(n: number): number {
  let p = 256;
  while (p < n) p *= 2;
  return p;
}
