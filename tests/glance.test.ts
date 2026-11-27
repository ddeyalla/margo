import { describe, expect, it } from "vitest";
import { sentenceAround } from "@/components/reader/glance";
import { parseGlance } from "@/lib/shared/glance";

describe("sentenceAround", () => {
  it("gives the sentence that holds the word, so the meaning is the one in context", () => {
    const block = "Text comes first. A tokenizer splits it into tokens!  Then the model embeds them.";
    expect(sentenceAround(block, "tokenizer")).toBe("A tokenizer splits it into tokens!");
  });

  it("falls back to the block's first sentence", () => {
    expect(sentenceAround("One idea here. Another one.", "missing")).toBe("One idea here.");
  });
});

describe("parseGlance", () => {
  it("reads the three lines", () => {
    expect(parseGlance("Splits text into tokens.\nExample: \"Hi there\" becomes [\"Hi\", \" there\"].\nKind: core")).toEqual({
      gist: "Splits text into tokens.",
      example: "\"Hi there\" becomes [\"Hi\", \" there\"].",
      core: true,
    });
  });

  it("shows the meaning while it is still being written, with no kind yet", () => {
    expect(parseGlance("Splits text into")).toEqual({ gist: "Splits text into", example: "", core: null });
  });

  it("accepts numbered lines and a background kind", () => {
    expect(parseGlance("1. A matrix of numbers.\n2. Example: a 3 by 3 grid.\n3. Kind: background")).toEqual({ gist: "A matrix of numbers.", example: "a 3 by 3 grid.", core: false });
  });
});
