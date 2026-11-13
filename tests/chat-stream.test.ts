import { describe, expect, it } from "vitest";
import { takeLines } from "@/lib/client/chat";

describe("NDJSON line splitting", () => {
  it("keeps a line cut across chunks until its newline arrives", () => {
    const first = takeLines('{"type":"text","delta":"a"}\n{"type":"te');
    expect(first.lines).toEqual(['{"type":"text","delta":"a"}']);
    const second = takeLines(`${first.rest}xt","delta":"b"}\n\n`);
    expect(second).toEqual({ lines: ['{"type":"text","delta":"b"}'], rest: "" });
  });
});
