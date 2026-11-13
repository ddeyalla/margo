import { describe, expect, it } from "vitest";
import { fixations } from "@/components/reader/fixations";

/** The text with each bold start between ** marks. */
const marked = (text: string) => {
  let out = "";
  let at = 0;
  for (const [start, end] of fixations(text)) {
    out += `${text.slice(at, start)}**${text.slice(start, end)}**`;
    at = end;
  }
  return out + text.slice(at);
};

describe("bold starts", () => {
  it("bolds one character of a word up to three long, two of four, and 40% rounded up of longer words", () => {
    expect(marked("a an the word quick reading extraordinary")).toBe(
      "**a** **a**n **t**he **wo**rd **qu**ick **rea**ding **extrao**rdinary",
    );
  });

  it("leaves punctuation and whitespace alone", () => {
    expect(marked("“Hello,” she said —  twice!\n(Again.)")).toBe("“**He**llo,” **s**he **sa**id —  **tw**ice!\n(**Ag**ain.)");
    expect(fixations(" … — !? ")).toEqual([]);
  });

  it("treats each part of a hyphenated word as its own word", () => {
    expect(marked("well-known state-of-the-art")).toBe("**we**ll-**kn**own **st**ate-**o**f-**t**he-**a**rt");
  });

  it("keeps an apostrophe between letters inside the word", () => {
    expect(marked("don't it’s rock 'n' roll")).toBe("**do**n't **it**’s **ro**ck '**n**' **ro**ll");
  });

  it("counts digits as words", () => {
    expect(marked("In 2024, GPT4 cost 3.5x")).toBe("**I**n **20**24, **GP**T4 **co**st **3**.**5**x");
  });

  it("reads accented Latin, Cyrillic and Greek as letters", () => {
    expect(marked("Ça été naïve")).toBe("**Ç**a **é**té **na**ïve");
    expect(marked("Привет мир")).toBe("**При**вет **м**ир");
    expect(marked("Καλημέρα κόσμε")).toBe("**Καλη**μέρα **κό**σμε");
  });

  it("never splits a character from its combining marks or a surrogate pair", () => {
    const decomposed = "e\u0301te\u0301 cafe\u0301s";
    expect(fixations(decomposed)).toEqual([
      [0, 2],
      [6, 8],
    ]);
    expect(marked("𝒜bc")).toBe("**𝒜**bc");
  });

  it("does nothing to Chinese, Japanese, Korean or other unspaced scripts", () => {
    expect(fixations("日本語のテキストです。")).toEqual([]);
    expect(fixations("中文文本")).toEqual([]);
    expect(fixations("안녕하세요 세계")).toEqual([]);
    expect(fixations("สวัสดีครับ")).toEqual([]);
    expect(marked("Read 日本語 now")).toBe("**Re**ad 日本語 **n**ow");
  });
});
