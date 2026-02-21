class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunkSize = options?.processorOptions?.chunkSize || 4096;
    this.chunkSize = chunkSize;
    this.buffer = new Float32Array(chunkSize);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      let srcOffset = 0;
      while (srcOffset < channel.length) {
        const copyLen = Math.min(this.chunkSize - this.offset, channel.length - srcOffset);
        this.buffer.set(channel.subarray(srcOffset, srcOffset + copyLen), this.offset);
        this.offset += copyLen;
        srcOffset += copyLen;

        if (this.offset === this.chunkSize) {
          const chunk = this.buffer;
          this.port.postMessage(chunk, [chunk.buffer]);
          this.buffer = new Float32Array(this.chunkSize);
          this.offset = 0;
        }
      }
    }

    const out = outputs[0];
    if (out) {
      for (let i = 0; i < out.length; i++) {
        out[i].fill(0);
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-worklet", PCMWorkletProcessor);
