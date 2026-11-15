// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StreamingMarkdown } from "@/components/chat/Markdown";
import { settledLength, settledStarts } from "@/components/chat/settled";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("settledStarts", () => {
  it("lists every finished block start, ending where settledLength splits", () => {
    const text = "A\n\nB\n\nC\nstill C\n\nD";
    expect(settledStarts(text)).toEqual([3, 6]);
    expect(settledLength(text)).toBe(6);
  });

  it("only grows as text arrives", () => {
    const full = "One\n\nTwo\n\n```\nx\n\ny\n```\n\nThree\n\n- a\n\n- b\n\nFour\n";
    let previous: number[] = [];
    for (let end = 0; end <= full.length; end++) {
      const starts = settledStarts(full.slice(0, end));
      expect(starts.slice(0, previous.length)).toEqual(previous);
      previous = starts;
    }
  });
});

describe("StreamingMarkdown", () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = (text: string) => act(() => root.render(createElement(StreamingMarkdown, { text })));
  const blocks = () => Array.from(host.firstElementChild!.children) as HTMLElement[];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps a block's node when it settles, and marks only the block being written as live", () => {
    render("First para");
    const [first] = blocks();
    expect(first.dataset.live).toBe("");

    render("First para\n\nSecond");
    expect(blocks()[0]).toBe(first);

    render("First para\n\nSecond\n");
    const [settled, tail] = blocks();
    expect(settled).toBe(first);
    expect(settled.dataset.live).toBeUndefined();
    expect(tail.textContent).toBe("Second");
    expect(tail.dataset.live).toBe("");
  });

  it("renders blocks that arrive already finished as settled, so they fade in", () => {
    render("Intro");
    const [intro] = blocks();
    render("Intro\n\nWhole one\n\nWhole two\n\nTail\n");
    const [a, b, c, d] = blocks();
    expect(a).toBe(intro);
    expect([b.textContent, c.textContent, d.textContent]).toEqual(["Whole one", "Whole two", "Tail"]);
    expect(b.dataset.live).toBeUndefined();
    expect(c.dataset.live).toBeUndefined();
    expect(d.dataset.live).toBe("");
  });

  it("does not touch settled blocks while the tail grows", () => {
    render("A\n\nB\n\nC");
    const [a, b] = blocks();
    render("A\n\nB\n\nC grows");
    render("A\n\nB\n\nC grows more");
    expect(blocks()[0]).toBe(a);
    expect(blocks()[1]).toBe(b);
    expect(host.firstElementChild!.className).toContain("settle-fade");
  });
});
