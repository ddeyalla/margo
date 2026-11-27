// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { addFixations, FIXATION_TAG } from "@/components/reader/fixations";
import { Narrator, sentencesOf, type FoliateTTS } from "@/components/reader/narrator";
import { markAt, ssmlToText } from "@/components/reader/ssml";
import { TTS } from "@/public/vendor/foliate-js/tts.js";
import { textWalker } from "@/public/vendor/foliate-js/text-walker.js";

const SSML_NS = "http://www.w3.org/2001/10/synthesis";

/* Browsers have CSS.escape, which foliate uses to find a mark; jsdom does not. Mark names are digits. */
globalThis.CSS ??= { escape: (value: string) => value } as unknown as typeof CSS;

describe("ssmlToText", () => {
  it("keeps every character and puts each mark where its word starts", () => {
    const ssml = `<speak xmlns="${SSML_NS}" xml:lang="en"><mark name="0"/>Zero  to <emphasis><mark name="1"/>One</emphasis>,
<mark name="2"/>maybe.</speak>`;
    const { text, marks } = ssmlToText(ssml);
    expect(text).toBe("Zero  to One,\nmaybe.");
    expect(marks).toEqual([
      { offset: 0, name: "0" },
      { offset: 9, name: "1" },
      { offset: 14, name: "2" },
    ]);
    for (const { offset, name } of marks) expect(text.slice(offset)).toMatch(["Zero", "One", "maybe"][Number(name)]);
  });

  it("speaks a break as a space, so the words either side stay apart", () => {
    const { text, marks } = ssmlToText(`<speak xmlns="${SSML_NS}"><mark name="0"/>end<break/><mark name="1"/>Next</speak>`);
    expect(text).toBe("end Next");
    expect(marks[1]).toEqual({ offset: 4, name: "1" });
  });

  it("reads the text inside lang and phoneme elements", () => {
    const { text, marks } = ssmlToText(
      `<speak xmlns="${SSML_NS}"><lang xml:lang="fr"><mark name="0"/>café</lang> <phoneme ph="x"><mark name="1"/>tomato</phoneme></speak>`,
    );
    expect(text).toBe("café tomato");
    expect(marks.map((m) => m.offset)).toEqual([0, 5]);
  });

  it("gives nothing to say for SSML it cannot parse", () => {
    expect(ssmlToText("<speak><mark></speak>")).toEqual({ text: "", marks: [] });
  });
});

describe("markAt", () => {
  const marks = [
    { offset: 0, name: "0" },
    { offset: 5, name: "1" },
    { offset: 9, name: "2" },
  ];

  it("finds the word a boundary falls in", () => {
    expect(markAt(marks, 0)).toBe("0");
    expect(markAt(marks, 4)).toBe("0");
    expect(markAt(marks, 5)).toBe("1");
    expect(markAt(marks, 8)).toBe("1");
    expect(markAt(marks, 9)).toBe("2");
    expect(markAt(marks, 400)).toBe("2");
  });

  it("finds none before the first word or in an empty block", () => {
    expect(markAt([{ offset: 3, name: "0" }], 1)).toBeNull();
    expect(markAt([], 0)).toBeNull();
  });
});

/* A section the way an EPUB ships it, with inline markup, a line break and a word split across elements. */
const SECTION = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>One</title></head>
<body>
  <h1>Chapter one</h1>
  <p>Zero to <em>One</em> is about building the future,<br/>not copying it.</p>
  <p>A <b>bold</b>ly <span><i>nested</i> word</span> ends here.</p>
</body></html>`;

const section = () => {
  const doc = new DOMParser().parseFromString(SECTION, "application/xhtml+xml");
  const lit: string[] = [];
  const tts = new TTS(doc, textWalker, (range: Range) => lit.push(range.toString()), "word");
  return { doc, tts, lit };
};

/* What a voice does with the text: a word boundary at the start of each word, as Chromium fires them. */
const boundaries = (text: string) => [...text.matchAll(/[\p{L}\p{N}’']+/gu)].map((m) => m.index);

describe("read-along over foliate's TTS", () => {
  it("lights each word on the page as the voice reaches it", () => {
    const { tts, lit } = section();
    const spoken: string[] = [];
    for (let ssml = tts.start(); ssml !== undefined; ssml = tts.next()) {
      const { text, marks } = ssmlToText(ssml);
      for (const index of boundaries(text)) {
        const mark = markAt(marks, index);
        if (mark) tts.setMark(mark);
      }
      spoken.push(text.replace(/\s+/g, " ").trim());
    }
    expect(spoken).toEqual(["Chapter one", "Zero to One is about building the future, not copying it.", "A boldly nested word ends here."]);
    expect(lit).toEqual("Chapter one Zero to One is about building the future not copying it A boldly nested word ends here".split(" "));
  });

  it("lights whole words when bold starts has split them into marked pieces", () => {
    const doc = new DOMParser().parseFromString(SECTION, "application/xhtml+xml");
    addFixations(doc);
    expect(doc.getElementsByTagName(FIXATION_TAG).length).toBeGreaterThan(0);
    const lit: string[] = [];
    const tts = new TTS(doc, textWalker, (range: Range) => lit.push(range.toString()), "word");
    tts.next();
    const { text, marks } = ssmlToText(tts.next()!);
    expect(text.trim()).toBe("Zero to One is about building the future, not copying it.");
    for (const index of boundaries(text)) tts.setMark(markAt(marks, index)!);
    expect(lit).toEqual("Zero to One is about building the future not copying it".split(" "));
  });

  it("starts at a paragraph in view, from its first word", () => {
    const { doc, tts, lit } = section();
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelectorAll("p")[1]);
    const { text, marks } = ssmlToText(tts.from(range)!);
    expect(text.trim()).toBe("A boldly nested word ends here.");
    tts.setMark(markAt(marks, text.indexOf("nested"))!);
    expect(lit).toEqual(["nested"]);
  });

  it("resumes at the last word lit", () => {
    const { tts, lit } = section();
    tts.next();
    const { text, marks } = ssmlToText(tts.next()!);
    tts.setMark(markAt(marks, text.indexOf("future"))!);
    const resumed = ssmlToText(tts.resume()!);
    expect(resumed.text.trim()).toBe("future, not copying it.");
    tts.setMark(resumed.marks[0].name);
    expect(lit).toEqual(["future", "future"]);
  });
});

describe("sentencesOf", () => {
  it("cuts a block after each sentence and keeps the text between them", () => {
    const text = "Zero to One is about building the future. It is not about copying it! Is that clear?";
    const parts = sentencesOf(text).map(({ start, end }) => text.slice(start, end).trim());
    expect(parts).toEqual(["Zero to One is about building the future.", "It is not about copying it!", "Is that clear?"]);
  });

  it("joins a very short sentence to the next, so the voice never speaks two words alone", () => {
    const text = "Yes. Zero to One is about building the future.";
    expect(sentencesOf(text).map(({ start, end }) => text.slice(start, end))).toEqual([text]);
  });

  it("covers every character, so each word's mark falls in a sentence", () => {
    const text = "Mr. Smith arrived late, as usual. He sat down without a word to anyone at all.";
    const parts = sentencesOf(text);
    expect(parts[0].start).toBe(0);
    expect(parts.at(-1)!.end).toBe(text.length);
  });
});

/* Web Audio, enough for the narrator: a source ends as soon as it starts. */
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = async () => {};
  createBufferSource() {
    const source = { buffer: null, onended: null as null | (() => void), connect() {}, stop() {}, start: () => queueMicrotask(() => source.onended?.()) };
    return source;
  }
}

const sectionTTS = (): FoliateTTS => {
  const { doc, tts } = section();
  return Object.assign(tts, { doc }) as unknown as FoliateTTS;
};

describe("Narrator", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("speaks each sentence in the chosen voice and speed, then says the book ended", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const said: [string, string, number][] = [];
    const say = async (_: BaseAudioContext, text: string, voice: string, speed: number) => {
      said.push([text, voice, speed]);
      return { duration: 1 } as AudioBuffer;
    };
    const stopped = vi.fn();
    const narrator = new Narrator({ tts: async () => sectionTTS(), nextSection: async () => false, stopped }, say);
    narrator.voice = "emma";
    narrator.rate = 1.25;
    await narrator.play(null);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledWith("end"));
    expect(said).toEqual([
      ["Chapter one", "emma", 1.25],
      ["Zero to One is about building the future, not copying it.", "emma", 1.25],
      ["A boldly nested word ends here.", "emma", 1.25],
    ]);
  });

  it("stops with an error when the voice cannot speak, the model missing for one", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const stopped = vi.fn();
    const narrator = new Narrator({ tts: async () => sectionTTS(), nextSection: async () => false, stopped }, async () => {
      throw new Error("The voice model is not installed.");
    });
    await narrator.play(null);
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledWith("error"));
  });

  it("stops with an error when the section's TTS cannot be made", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const say = vi.fn();
    const stopped = vi.fn();
    const narrator = new Narrator({ tts: () => Promise.reject(new Error("import failed")), nextSection: async () => false, stopped }, say);
    await narrator.play(null);
    expect(say).not.toHaveBeenCalled();
    expect(stopped).toHaveBeenCalledWith("error");
  });
});
