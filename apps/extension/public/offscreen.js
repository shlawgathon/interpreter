const SAMPLE_RATE = 16000;

let stream = null;
let audioCtx = null;
let source = null;
let processor = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "startCapture") {
    startCapture(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "stopCapture") {
    stopCapture();
    sendResponse({ ok: true });
  }
});

async function startCapture(streamId) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  source = audioCtx.createMediaStreamSource(stream);

  const bufferSize = 4096;
  processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  processor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    chrome.runtime.sendMessage({
      type: "audioChunk",
      buffer: Array.from(int16),
    });
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);
  console.log("[offscreen] tab audio capture started");
}

function stopCapture() {
  processor?.disconnect();
  source?.disconnect();
  audioCtx?.close();
  stream?.getTracks().forEach((t) => t.stop());
  processor = null;
  source = null;
  audioCtx = null;
  stream = null;
  console.log("[offscreen] tab audio capture stopped");
}
