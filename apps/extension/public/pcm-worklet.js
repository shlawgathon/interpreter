/**
 * AudioWorkletProcessor that converts incoming Float32 audio to
 * Int16 PCM and posts chunks to the main thread at ~200ms intervals.
 *
 * Messages posted: { type: "pcm", buffer: Int16Array.buffer }
 * Loaded at: new AudioWorklet("pcm-worklet.js")
 */

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_FRAMES = TARGET_SAMPLE_RATE * 0.2; // 200ms = 3200 samples

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(CHUNK_FRAMES);
    this._offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0]; // mono
    let i = 0;

    while (i < channel.length) {
      const remaining = CHUNK_FRAMES - this._offset;
      const toCopy = Math.min(remaining, channel.length - i);

      this._buffer.set(channel.subarray(i, i + toCopy), this._offset);
      this._offset += toCopy;
      i += toCopy;

      if (this._offset >= CHUNK_FRAMES) {
        const int16 = new Int16Array(CHUNK_FRAMES);
        for (let j = 0; j < CHUNK_FRAMES; j++) {
          const s = Math.max(-1, Math.min(1, this._buffer[j]));
          int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage({ type: "pcm", buffer: int16.buffer }, [int16.buffer]);
        this._buffer = new Float32Array(CHUNK_FRAMES);
        this._offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
