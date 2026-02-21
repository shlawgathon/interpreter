// ── Offscreen Document ──
// Captures tab audio via tabCapture, extracts PCM chunks,
// plays translated audio back through a selectable output device (e.g. BlackHole).

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: AudioWorkletNode | null = null;
let processorMonitorGain: GainNode | null = null;
let playbackContext: AudioContext | null = null;
let playbackElement: HTMLAudioElement | null = null;
let playbackGeneration = 0;
let currentPlaybackUrl: string | null = null;
let fallbackSource: AudioBufferSourceNode | null = null;

// The device ID for translated audio output (e.g. BlackHole)
let outputDeviceId: string | null = null;

type SinkAwareAudioElement = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

type SinkAwareAudioContext = AudioContext & {
  setSinkId?: (deviceId: string) => Promise<void>;
};
let hasReportedUnsupportedSinkRouting = false;

// Target: 16kHz mono Int16 PCM for Speechmatics
const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;
const WORKLET_PROCESSOR_NAME = "pcm-capture-worklet";
const CAPTURE_WORKLET_URL = chrome.runtime.getURL("capture-worklet.js");

// ── Audio Processing ──
function downsampleBuffer(
  buffer: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return buffer;

  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, buffer.length - 1);
    const frac = srcIndex - srcIndexFloor;
    result[i] = buffer[srcIndexFloor] * (1 - frac) + buffer[srcIndexCeil] * frac;
  }

  return result;
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

async function loadCaptureWorklet(context: AudioContext): Promise<void> {
  await context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
}

function processCapturedChunk(inputData: Float32Array, sampleRate: number): void {
  // Check if there's actually audio (skip silence)
  let sum = 0;
  for (let i = 0; i < inputData.length; i++) {
    sum += Math.abs(inputData[i]);
  }
  if (sum / inputData.length < 0.001) return; // Skip near-silence

  // Downsample to 16kHz
  const downsampled = downsampleBuffer(
    inputData,
    sampleRate,
    TARGET_SAMPLE_RATE
  );

  // Convert to Int16 PCM
  const pcm = floatTo16BitPCM(downsampled);

  // Send to service worker
  chrome.runtime.sendMessage({
    type: "audio-data",
    target: "background",
    data: Array.from(new Uint8Array(pcm.buffer)),
  });
}

function getPlaybackElement(): HTMLAudioElement {
  if (!playbackElement) {
    playbackElement = new Audio();
    playbackElement.preload = "auto";
  }
  return playbackElement;
}

function clearPlaybackObjectUrl(): void {
  if (currentPlaybackUrl) {
    URL.revokeObjectURL(currentPlaybackUrl);
    currentPlaybackUrl = null;
  }
}

function stopPlaybackElement(): void {
  if (!playbackElement) return;
  playbackElement.pause();
  playbackElement.removeAttribute("src");
  playbackElement.load();
  clearPlaybackObjectUrl();
}

async function applyPlaybackSink(
  element: HTMLAudioElement,
  deviceId: string
): Promise<void> {
  const sinkAware = element as SinkAwareAudioElement;
  if (typeof sinkAware.setSinkId !== "function") {
    console.warn(
      "[Offscreen] HTMLMediaElement.setSinkId is unavailable in this Chrome build"
    );
    if (!hasReportedUnsupportedSinkRouting) {
      hasReportedUnsupportedSinkRouting = true;
      chrome.runtime.sendMessage({
        type: "error",
        target: "background",
        message:
          "Per-device output routing is unsupported in this Chrome build. Using system default output.",
      });
    }
    return;
  }

  try {
    await sinkAware.setSinkId(deviceId);
    console.log("[Offscreen] setSinkId succeeded for:", deviceId);
  } catch (err) {
    console.error("[Offscreen] Failed to set sink ID:", err);
    chrome.runtime.sendMessage({
      type: "error",
      target: "background",
      message:
        "Failed to route translated audio to selected output device. Re-select BlackHole and check Chrome media permissions.",
    });
  }
}

// ── Set Output Device ──
function setOutputDevice(deviceId: string): void {
  outputDeviceId = deviceId || null;
  // If playback element exists, update its sink
  if (playbackElement) {
    if (deviceId) {
      void applyPlaybackSink(playbackElement, deviceId);
    } else {
      const sinkAware = playbackElement as SinkAwareAudioElement;
      if (typeof sinkAware.setSinkId === "function") {
        sinkAware.setSinkId("").catch((err: Error) => {
          console.error("[Offscreen] Failed to reset sink ID:", err);
        });
      }
    }
  }
  console.log("[Offscreen] Output device set to:", deviceId || "default");
}

// ── Start Capturing ──
async function startCapture(
  streamId: string,
  initialOutputDeviceId?: string
): Promise<void> {
  try {
    if (typeof initialOutputDeviceId === "string") {
      setOutputDevice(initialOutputDeviceId);
    }

    // Get media stream from tab
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as any,
    });

    audioContext = new AudioContext({ sampleRate: 48000 });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    // Do not passthrough original tab audio.
    // We only capture it for STT so users don't hear untranslated + translated audio together.

    if (!audioContext.audioWorklet) {
      throw new Error("AudioWorklet is not available in this browser");
    }
    await loadCaptureWorklet(audioContext);

    // Extract PCM chunks via AudioWorkletNode
    processorNode = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { chunkSize: BUFFER_SIZE },
    });
    sourceNode.connect(processorNode);
    processorMonitorGain = audioContext.createGain();
    processorMonitorGain.gain.value = 0;
    processorNode.connect(processorMonitorGain);
    processorMonitorGain.connect(audioContext.destination);

    processorNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const inputData = event.data;
      if (!(inputData instanceof Float32Array) || !audioContext) return;
      processCapturedChunk(inputData, audioContext.sampleRate);
    };

    console.log("[Offscreen] Capture started");
  } catch (err) {
    console.error("[Offscreen] Capture error:", err);
    chrome.runtime.sendMessage({
      type: "error",
      target: "background",
      message: `Capture failed: ${err}`,
    });
  }
}

// ── Stop Capturing ──
function stopCapture(): void {
  if (processorNode) {
    processorNode.port.onmessage = null;
  }
  processorNode?.disconnect();
  processorMonitorGain?.disconnect();
  sourceNode?.disconnect();
  audioContext?.close();
  mediaStream?.getTracks().forEach((t) => t.stop());

  processorNode = null;
  processorMonitorGain = null;
  sourceNode = null;
  audioContext = null;
  mediaStream = null;

  console.log("[Offscreen] Capture stopped");
}

async function playUsingAudioElement(
  bytes: Uint8Array,
  generation: number
): Promise<void> {
  const element = getPlaybackElement();
  if (outputDeviceId) {
    await applyPlaybackSink(element, outputDeviceId);
  }
  if (generation !== playbackGeneration) return;

  stopPlaybackElement();

  const rawBuffer = bytes.buffer;
  const audioBuffer = rawBuffer instanceof ArrayBuffer
    ? rawBuffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).buffer;
  const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  currentPlaybackUrl = url;
  element.src = url;
  element.currentTime = 0;
  element.onended = () => {
    if (currentPlaybackUrl === url) {
      stopPlaybackElement();
    }
  };
  element.onerror = () => {
    if (currentPlaybackUrl === url) {
      stopPlaybackElement();
    }
  };

  await element.play();
  if (generation !== playbackGeneration) {
    stopPlaybackElement();
    return;
  }
  console.log("[Offscreen] Audio element play() started");
}

async function playUsingAudioContextFallback(
  bytes: Uint8Array,
  generation: number
): Promise<void> {
  try {
    // Fallback path for non-MP3 payloads.
    if (!playbackContext || playbackContext.state === "closed") {
      playbackContext = new AudioContext();
    }

    if (playbackContext.state === "suspended") {
      await playbackContext.resume();
    }

    const float32 = new Float32Array(bytes.length / 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < float32.length; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768;
    }
    if (generation !== playbackGeneration) return;

    if (fallbackSource) {
      try {
        fallbackSource.stop();
      } catch {
        // Ignore if already stopped.
      }
      fallbackSource.disconnect();
      fallbackSource = null;
    }

    const buffer = playbackContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);
    fallbackSource = source;
    source.onended = () => {
      if (fallbackSource === source) {
        fallbackSource = null;
      }
    };
    source.start();
  } catch (err) {
    console.error("[Offscreen] Playback fallback error:", err);
  }
}

// ── Play Translated Audio (routes to selected output device) ──
function playTranslatedAudio(audioData: number[]): void {
  console.log(
    "[Offscreen] Playing translated audio (%d bytes)",
    audioData.length
  );
  const bytes = new Uint8Array(audioData);
  const generation = ++playbackGeneration;
  void playUsingAudioElement(bytes, generation).catch(async (err) => {
    console.warn(
      "[Offscreen] Audio element playback failed; trying PCM fallback:",
      err
    );
    await playUsingAudioContextFallback(bytes, generation);
  });
}

// ── Message Listener ──
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "offscreen") return;

  switch (message.type) {
    case "start-capture":
      startCapture(message.streamId, message.outputDeviceId);
      break;
    case "stop-capture":
      stopCapture();
      break;
    case "translated-audio":
      void playTranslatedAudio(message.data);
      break;
    case "set-output-device":
      setOutputDevice(message.deviceId);
      break;
  }
});
