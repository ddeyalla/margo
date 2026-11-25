// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { addFixations, FIXATION_TAG } from "@/components/reader/fixations";
import { pickVoice } from "@/components/reader/narrator";
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

describe("pickVoice", () => {
  const voice = (name: string, lang: string, isDefault = false) =>
    ({ name, lang, voiceURI: `com.apple.voice.${name}`, localService: true, default: isDefault }) as SpeechSynthesisVoice;
  const voices = [voice("Amélie", "fr-CA"), voice("Daniel", "en-GB"), voice("Samantha", "en-US", true), voice("Thomas", "fr-FR")];

  it("keeps the saved voice", () => {
    expect(pickVoice(voices, "com.apple.voice.Daniel", "fr")?.name).toBe("Daniel");
  });

  it("otherwise matches the book's language", () => {
    expect(pickVoice(voices, null, "en-GB")?.name).toBe("Samantha");
    expect(pickVoice(voices, null, "fr-FR")?.name).toBe("Thomas");
    expect(pickVoice(voices, "com.apple.voice.Gone", "fr")?.name).toBe("Amélie");
  });

  it("falls back to the default voice for a language it has none for", () => {
    expect(pickVoice(voices, null, "ja")?.name).toBe("Samantha");
    expect(pickVoice([], null, "en")).toBeNull();
  });
});
