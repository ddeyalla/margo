// Hands the microphone's samples to the page, 4096 at a time. Loaded by components/chat/useDictation.ts.
class DictationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let read = 0;
    while (read < channel.length) {
      const take = Math.min(channel.length - read, this.buffer.length - this.filled);
      this.buffer.set(channel.subarray(read, read + take), this.filled);
      this.filled += take;
      read += take;
      if (this.filled === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(4096);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("dictation-capture", DictationCapture);
