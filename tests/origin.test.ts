import { describe, expect, it } from "vitest";
import { refusal } from "@/lib/server/origin";

const allowed = (method: string, host: string | null, origin: string | null = null) => refusal({ method, host, origin }) === null;

describe("which requests the API answers", () => {
  it("answers 127.0.0.1 and localhost on any port", () => {
    expect(allowed("GET", "127.0.0.1:3210")).toBe(true);
    expect(allowed("GET", "localhost:3000")).toBe(true);
    expect(allowed("GET", "LOCALHOST:3000")).toBe(true);
    expect(allowed("GET", "127.0.0.1")).toBe(true);
  });

  it("refuses any other host, such as a rebound domain or the machine's network address", () => {
    expect(allowed("GET", "evil.example:3210")).toBe(false);
    expect(allowed("GET", "192.168.1.20:3210")).toBe(false);
    expect(allowed("GET", "127.0.0.1.evil.example")).toBe(false);
    expect(allowed("GET", "localhost.evil.example:3210")).toBe(false);
    expect(allowed("GET", null)).toBe(false);
    expect(allowed("GET", "")).toBe(false);
  });

  it("lets a change through from the same origin or with no origin at all", () => {
    expect(allowed("POST", "127.0.0.1:3210", "http://127.0.0.1:3210")).toBe(true);
    expect(allowed("PATCH", "localhost:3000", "http://localhost:3000")).toBe(true);
    expect(allowed("DELETE", "127.0.0.1:3210")).toBe(true);
  });

  it("refuses a change sent from another origin", () => {
    expect(allowed("POST", "127.0.0.1:3210", "https://evil.example")).toBe(false);
    expect(allowed("POST", "127.0.0.1:3210", "http://localhost:3210")).toBe(false);
    expect(allowed("POST", "127.0.0.1:3210", "http://127.0.0.1:4000")).toBe(false);
    expect(allowed("PUT", "127.0.0.1:3210", "null")).toBe(false);
  });

  it("does not check the origin of a read", () => {
    expect(allowed("GET", "127.0.0.1:3210", "https://evil.example")).toBe(true);
    expect(allowed("HEAD", "127.0.0.1:3210", "https://evil.example")).toBe(true);
  });
});
