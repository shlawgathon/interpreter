/**
 * Injected into Google Meet's main world to intercept remote WebRTC audio tracks.
 * Posts PCM audio chunks to the content script via window.postMessage.
 */
(function () {
  if (window.__interpreterWebRTCPatched) return;
  window.__interpreterWebRTCPatched = true;

  const SAMPLE_RATE = 16000;
  const trackedStreams = new Set();
  let capturing = false;
  let audioCtx = null;
  let merger = null;
  let processor = null;
  const sources = new Map();

  function ensureAudioPipeline() {
    if (audioCtx) return;
    audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    merger = audioCtx.createChannelMerger(1);

    const bufferSize = 4096;
    processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!capturing) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      window.postMessage(
        { type: "__interpreter_audio_chunk", buffer: Array.from(int16) },
        "*"
      );
    };

    merger.connect(processor);
    processor.connect(audioCtx.destination);
  }

  function addRemoteTrack(track, stream) {
    const streamId = stream.id;
    if (track.kind !== "audio" || trackedStreams.has(streamId)) return;
    trackedStreams.add(streamId);

    ensureAudioPipeline();

    const mediaStream = new MediaStream([track]);
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(merger);
    sources.set(streamId, source);

    console.log("[interpreter] intercepted remote audio track:", streamId);

    track.addEventListener("ended", () => {
      const src = sources.get(streamId);
      if (src) {
        src.disconnect();
        sources.delete(streamId);
      }
      trackedStreams.delete(streamId);
      console.log("[interpreter] remote audio track ended:", streamId);
    });
  }

  const OrigRTC = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...args) {
    const pc = new OrigRTC(...args);

    pc.addEventListener("track", (event) => {
      if (event.track.kind === "audio") {
        for (const stream of event.streams) {
          addRemoteTrack(event.track, stream);
        }
      }
    });

    return pc;
  };
  window.RTCPeerConnection.prototype = OrigRTC.prototype;
  Object.assign(window.RTCPeerConnection, OrigRTC);

  window.addEventListener("message", (e) => {
    if (e.data?.type === "__interpreter_start_capture") {
      capturing = true;
      if (audioCtx?.state === "suspended") audioCtx.resume();
      console.log("[interpreter] audio capture enabled");
    }
    if (e.data?.type === "__interpreter_stop_capture") {
      capturing = false;
      console.log("[interpreter] audio capture disabled");
    }
  });
})();
