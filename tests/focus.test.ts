import { describe, expect, it } from "vitest";
import { formatRemaining } from "@/components/book/useFocusSession";

describe("focus sessions", () => {
  it("shows the time left as minutes and seconds, with hours past the first", () => {
    expect(formatRemaining(24 * 60_000 + 7_000)).toBe("24:07");
    expect(formatRemaining(64 * 60_000 + 7_000)).toBe("1:04:07");
    expect(formatRemaining(400)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
  });
});
