// Runs the reading voice (Kokoro v1.0, through sherpa-onnx) in its own process, started by lib/server/voice.ts.
// sherpa-onnx 2 reads words through a lexicon, one per accent, so one engine is made for each accent asked for.
// Messages in: { id, text, speaker, lexicon: "us" | "gb", speed }. Out: { type: "ready" }, { type: "failed", error },
// { id, samples: Float32Array, sampleRate } or { id, error }.
const fs = require("node:fs");
const path = require("node:path");
const { speakable } = require("./voice-text.cjs");

const dir = process.env.MARGO_VOICE_MODEL;
const file = (name) => path.join(dir, name);
const sherpa = require("sherpa-onnx-node");

/* The words each lexicon has, so a word it lacks can be rewritten before Kokoro skips it. */
const words = new Map();
const wordsOf = (lexicon) => {
  if (!words.has(lexicon)) {
    const known = new Set();
    for (const line of fs.readFileSync(file(`lexicon-${lexicon}-en.txt`), "utf8").split("\n")) known.add(line.slice(0, line.indexOf(" ")).toLowerCase());
    words.set(lexicon, known);
  }
  return words.get(lexicon);
};

const engines = new Map();
const engine = (lexicon) => {
  if (!engines.has(lexicon)) {
    engines.set(
      lexicon,
      new sherpa.OfflineTts({
        model: {
          kokoro: { model: file("model.onnx"), voices: file("voices.bin"), tokens: file("tokens.txt"), lexicon: file(`lexicon-${lexicon}-en.txt`) },
          numThreads: 4,
          provider: "cpu",
        },
        maxNumSentences: 1,
      }),
    );
  }
  return engines.get(lexicon);
};

const serve = () => process.on("message", ({ id, text, speaker, lexicon, speed }) => {
  try {
    // A JS-owned array, since Electron's Node refuses the native memory the library hands back by default.
    const accent = lexicon === "gb" ? "gb" : "us";
    const known = wordsOf(accent);
    const audio = engine(accent).generate({ text: speakable(text, (word) => known.has(word)), sid: speaker, speed, enableExternalBuffer: false });
    process.send({ id, samples: Float32Array.from(audio.samples), sampleRate: audio.sampleRate });
  } catch (error) {
    process.send({ id, error: error instanceof Error ? error.message : String(error) });
  }
});

// The server went away, so this has nobody to answer.
process.on("disconnect", () => process.exit(0));
try {
  // The US engine loads at once, so a model that cannot load fails here and not on the first sentence.
  engine("us");
  serve();
  process.send({ type: "ready" });
} catch (error) {
  process.send({ type: "failed", error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
}
