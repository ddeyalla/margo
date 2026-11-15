import { describe, expect, it } from "vitest";
import { settledLength } from "@/components/chat/settled";

const settled = (text: string) => text.slice(0, settledLength(text));

describe("settledLength", () => {
  it("settles nothing until a new block has started on a finished line", () => {
    expect(settled("One para")).toBe("");
    expect(settled("One para\n\n")).toBe("");
    expect(settled("One para\n\nTwo")).toBe("");
    expect(settled("One para\n\nTwo\n")).toBe("One para\n\n");
  });

  it("splits before the last finished block start", () => {
    const text = "A\n\nB\n\nC\nstill C";
    expect(settled(text)).toBe("A\n\nB\n\n");
  });

  it("never splits inside a code fence", () => {
    const open = "Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n";
    expect(settled(open)).toBe("Intro\n\n");
    const closed = "Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter\n";
    expect(settled(closed)).toBe("Intro\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\n");
  });

  it("closes a fence only with the same character and at least its length", () => {
    const text = "````\n```\n\nstill code\n````\n\nAfter\n";
    expect(settled(text)).toBe("````\n```\n\nstill code\n````\n\n");
    expect(settled("~~~\n```\n\ncode\n")).toBe("");
  });

  it("keeps list items and indented continuations with the block above", () => {
    expect(settled("1. one\n\n2. two\n")).toBe("");
    expect(settled("- a\n\n  more of a\n")).toBe("");
    expect(settled("- a\n\n- b\n\nAfter\n")).toBe("- a\n\n- b\n\n");
  });
});
