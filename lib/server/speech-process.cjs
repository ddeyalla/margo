// Runs the speech model in its own process, started by lib/server/speech.ts.
// Decoding here never blocks the server, and when this process exits every byte of the model goes with it.
// Messages in: { id, samples: Float32Array }. Out: { type: "ready" }, { type: "failed", error }, { id, text } or { id, error }.
const path = require("node:path");

const dir = process.env.MARGO_SPEECH_MODEL;
const file = (name) => path.join(dir, name);

const load = () => {
  const sherpa = require("sherpa-onnx-node");
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: file("encoder.int8.onnx"), decoder: file("decoder.int8.onnx"), joiner: file("joiner.int8.onnx") },
      tokens: file("tokens.txt"),
      numThreads: 4,
      provider: "cpu",
      modelType: "nemo_transducer",
    },
  });
};

const serve = (recognizer) => process.on("message", ({ id, samples }) => {
  try {
    // Only JS-owned arrays go in: the library's own wave reader hands back native memory, which Electron's Node refuses.
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    recognizer.decode(stream);
    process.send({ id, text: recognizer.getResult(stream).text });
  } catch (error) {
    process.send({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

// The server went away, so this has nobody to answer.
process.on("disconnect", () => process.exit(0));
try {
  serve(load());
  process.send({ type: "ready" });
} catch (error) {
  process.send({ type: "failed", error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
}
