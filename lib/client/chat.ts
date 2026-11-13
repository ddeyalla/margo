import type { ChatRequest } from "@/lib/shared/chat";
import type { ChatStreamEvent } from "@/lib/shared/types";

/** Splits complete lines off a growing buffer; the unfinished tail stays in `rest`. */
export const takeLines = (buffer: string): { lines: string[]; rest: string } => {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.trim()).filter(Boolean), rest };
};

/** Posts a chat request and yields the tutor's newline-delimited events as they arrive. */
export async function* streamChat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    throw new Error(message ?? `The tutor could not start (${response.status}).`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { lines, rest } = takeLines(buffer + value);
    buffer = rest;
    for (const line of lines) yield JSON.parse(line) as ChatStreamEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as ChatStreamEvent;
}
