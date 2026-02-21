// ── Offscreen Document ──
// Captures tab audio via tabCapture, extracts PCM chunks,
// plays translated audio back through a selectable output device (e.g. BlackHole).

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let playbackContext: AudioContext | null = null;

// The device ID for translated audio output (e.g. BlackHole)
let outputDeviceId: string | null = null;

// ── Auto-enumerate devices on load and store in chrome.storage.local ──
async function enumerateAndStoreDevices(): Promise<void> {
  try {
    // Request mic permission so Chrome reveals full device labels
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      console.warn("[Offscreen] getUserMedia denied — device labels may be empty");
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices
      .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default")
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Output ${d.deviceId.slice(0, 8)}`,
      }));
    console.log("[Offscreen] Found output devices:", outputs);
    await chrome.storage.local.set({ outputDevices: outputs });
  } catch (err) {
    console.error("[Offscreen] Device enumeration failed:", err);
  }
}

// Run on load
enumerateAndStoreDevices();

// Target: 16kHz mono Int16 PCM for Speechmatics
const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

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

// ── Enumerate Output Devices ──
async function getOutputDevices(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audiooutput");
}

// ── Set Output Device ──
function setOutputDevice(deviceId: string): void {
  outputDeviceId = deviceId;
  // If playback context exists, update its sink
  if (playbackContext) {
    (playbackContext as any).setSinkId(deviceId).catch((err: Error) => {
      console.error("[Offscreen] Failed to set sink ID:", err);
    });
  }
  console.log("[Offscreen] Output device set to:", deviceId);
}

// ── Start Capturing ──
async function startCapture(streamId: string): Promise<void> {
  try {
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

    // Keep original audio playing (no muting!) by routing to destination
    sourceNode.connect(audioContext.destination);

    // Extract PCM chunks via ScriptProcessor
    processorNode = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    processorNode.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);

      // Check if there's actually audio (skip silence)
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += Math.abs(inputData[i]);
      }
      if (sum / inputData.length < 0.001) return; // Skip near-silence

      // Downsample to 16kHz
      const downsampled = downsampleBuffer(
        inputData,
        audioContext!.sampleRate,
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
  processorNode?.disconnect();
  sourceNode?.disconnect();
  audioContext?.close();
  mediaStream?.getTracks().forEach((t) => t.stop());

  processorNode = null;
  sourceNode = null;
  audioContext = null;
  mediaStream = null;

  console.log("[Offscreen] Capture stopped");
}

// ── Play Translated Audio (routes to selected output device) ──
async function playTranslatedAudio(audioData: number[]): Promise<void> {
  try {
    // Create or reconfigure playback context with the selected output device
    if (!playbackContext || playbackContext.state === "closed") {
      const options: AudioContextOptions = {};
      if (outputDeviceId) {
        (options as any).sinkId = outputDeviceId;
      }
      playbackContext = new AudioContext(options);
    }

    // Resume if suspended (Chrome autoplay policy)
    if (playbackContext.state === "suspended") {
      await playbackContext.resume();
    }

    const bytes = new Uint8Array(audioData);

    // Try decoding as MP3/audio format from MiniMax
    try {
      const audioBuffer = await playbackContext.decodeAudioData(
        bytes.buffer.slice(0)
      );
      const source = playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(playbackContext.destination);
      source.start();
    } catch {
      // If decoding fails, try as raw PCM
      console.warn("[Offscreen] Could not decode audio, trying raw PCM");
      const float32 = new Float32Array(bytes.length / 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < float32.length; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768;
      }
      const buffer = playbackContext.createBuffer(
        1,
        float32.length,
        24000
      );
      buffer.getChannelData(0).set(float32);
      const source = playbackContext.createBufferSource();
      source.buffer = buffer;
      source.connect(playbackContext.destination);
      source.start();
    }
  } catch (err) {
    console.error("[Offscreen] Playback error:", err);
  }
}

// ── Message Listener ──
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;

  switch (message.type) {
    case "start-capture":
      startCapture(message.streamId);
      break;
    case "stop-capture":
      stopCapture();
      break;
    case "translated-audio":
      playTranslatedAudio(message.data);
      break;
    case "set-output-device":
      setOutputDevice(message.deviceId);
      break;
    case "refresh-devices":
      enumerateAndStoreDevices();
      break;
  }
});
