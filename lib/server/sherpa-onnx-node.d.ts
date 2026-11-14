/* The package ships no types. Only what speech.ts uses. */
declare module "sherpa-onnx-node" {
  export interface OfflineStream {
    acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
  }
  export class OfflineRecognizer {
    constructor(config: unknown);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    getResult(stream: OfflineStream): { text: string };
  }
}
