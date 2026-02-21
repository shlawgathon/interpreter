/**
 * Injected into Google Meet's main world to intercept remote WebRTC audio tracks.
 * Posts PCM audio chunks to the content script via window.postMessage.
 */
(function () {
  if (window.__interpreterWebRTCPatched) return;
  window.__interpreterWebRTCPatched = true;

  const SAMPLE_RATE = 16000;
  const trackedTracks = new Set();
  let capturing = false;
  let audioCtx = null;
  let merger = null;
  let processor = null;
  const sources = new Map();
  const peerConnections = [];

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

  function addAudioTrack(track) {
    const trackId = track.id;
    if (track.kind !== "audio" || trackedTracks.has(trackId)) return;
    trackedTracks.add(trackId);

    ensureAudioPipeline();

    const mediaStream = new MediaStream([track]);
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(merger);
    sources.set(trackId, source);

    console.log("[interpreter] intercepted remote audio track:", trackId);

    track.addEventListener("ended", () => {
      const src = sources.get(trackId);
      if (src) {
        src.disconnect();
        sources.delete(trackId);
      }
      trackedTracks.delete(trackId);
    });
  }

  function scanExistingConnections() {
    for (const pc of peerConnections) {
      try {
        const receivers = pc.getReceivers();
        for (const receiver of receivers) {
          if (receiver.track && receiver.track.kind === "audio") {
            addAudioTrack(receiver.track);
          }
        }
      } catch (e) {}
    }
  }

  function scanAudioElements() {
    const elements = document.querySelectorAll("audio, video");
    for (const el of elements) {
      if (el.srcObject instanceof MediaStream) {
        const audioTracks = el.srcObject.getAudioTracks();
        for (const track of audioTracks) {
          addAudioTrack(track);
        }
      }
    }
  }

  const OrigRTC = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...args) {
    const pc = new OrigRTC(...args);
    peerConnections.push(pc);

    pc.addEventListener("track", (event) => {
      if (event.track.kind === "audio") {
        addAudioTrack(event.track);
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
      scanExistingConnections();
      scanAudioElements();
      console.log(
        "[interpreter] capture enabled, tracked tracks:",
        trackedTracks.size,
        "peer connections:",
        peerConnections.length
      );
    }
    if (e.data?.type === "__interpreter_stop_capture") {
      capturing = false;
    }
  });

  const observer = new MutationObserver(() => {
    if (capturing) scanAudioElements();
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
