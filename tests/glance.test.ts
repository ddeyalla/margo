import { describe, expect, it } from "vitest";
import { sentenceAround } from "@/components/reader/glance";

describe("sentenceAround", () => {
  it("gives the sentence that holds the word, so the meaning is the one in context", () => {
    const block = "Text comes first. A tokenizer splits it into tokens!  Then the model embeds them.";
    expect(sentenceAround(block, "tokenizer")).toBe("A tokenizer splits it into tokens!");
  });

  it("falls back to the block's first sentence", () => {
    expect(sentenceAround("One idea here. Another one.", "missing")).toBe("One idea here.");
  });
});
