import { describe, expect, it } from "vitest";
import { numberWords, speakable } from "@/lib/server/voice-text.cjs";

const LEXICON = new Set(["the", "model", "uses", "soft", "max", "back", "propagation", "token", "in", "a", "and", "at", "fps", "frames", "cut", "s", "four", "five", "of", "time", "twenty", "nineteen", "ninety", "percent", "tokenize", "er", "embedding", "torch", "in"]);
const has = (word: string) => LEXICON.has(word);

describe("numberWords", () => {
  it("reads years as people say them", () => {
    expect(numberWords("1995")).toBe("nineteen ninety five");
    expect(numberWords("2005")).toBe("twenty oh five");
  });

  it("reads other numbers in full, with commas and decimals", () => {
    expect(numberWords("24")).toBe("twenty four");
    expect(numberWords("1,024")).toBe("one thousand twenty four");
    expect(numberWords("3.14")).toBe("three point one four");
    expect(numberWords("175000000000")).toBe("one hundred seventy five billion");
  });
});

describe("speakable", () => {
  it("leaves words the lexicon has alone", () => {
    expect(speakable("The model uses a token.", has)).toBe("The model uses a token.");
  });

  it("spells acronyms and splits new compounds into known words", () => {
    expect(speakable("GPT uses softmax and backpropagation.", has)).toBe("g p t uses soft max and back propagation.");
  });

  it("reads a known word with an ending the lexicon lacks, and a piece by its sound", () => {
    expect(speakable("tokenizer embeddings PyTorch", has)).toBe("tokenize er embedding pie torch");
  });

  it("turns numbers and percentages into words, so none is skipped", () => {
    expect(speakable("Cut at 24 fps in 1995, 90% of the time.", has)).toBe("Cut at twenty four fps in nineteen ninety five, ninety percent of the time.");
  });
});
