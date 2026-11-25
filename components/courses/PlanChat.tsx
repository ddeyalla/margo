"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check } from "lucide-react";
import { Markdown, StreamingMarkdown } from "@/components/chat/Markdown";
import { useProviders } from "@/components/chat/useProviders";
import { Button, IconButton, Spinner } from "@/components/ui";
import { takeLines } from "@/lib/client/chat";
import { withoutRoadmap, type Plan, type PlanStreamEvent } from "@/lib/shared/courses";
import type { AppSettings, ProviderId } from "@/lib/shared/types";
import { RoadmapCard } from "./RoadmapCard";

async function* streamPlan(body: { planId: string | null; text: string; provider: ProviderId }, signal: AbortSignal): AsyncGenerator<PlanStreamEvent> {
  const response = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const error = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new Error(error ?? `The tutor could not start (${response.status}).`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { lines, rest } = takeLines(buffer + value);
    buffer = rest;
    for (const line of lines) yield JSON.parse(line) as PlanStreamEvent;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as PlanStreamEvent;
}

/**
 * The home chat that plans a Course. The tutor asks about level, goal and weekly time, then proposes a roadmap;
 * the reader edits it by talking, and approves the latest one to create the Course (or update it, once made).
 */
export function PlanChat({
  initialPlan,
  firstMessage,
  provider: savedProvider,
  models,
}: {
  initialPlan: Plan | null;
  /** Sent at once when the chat opens empty, as when the reader typed it on the home page. */
  firstMessage: string | null;
  provider: ProviderId | null;
  models: AppSettings["models"];
}) {
  const router = useRouter();
  const { current: provider, unavailable } = useProviders(savedProvider, models);
  const [plan, setPlan] = useState(initialPlan);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [approving, setApproving] = useState(false);
  /* Not aborted on unmount: leaving the page mid-answer still saves the answer, as the book chat does. */
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  /* Whether the page keeps the newest words in view. Scrolling up to reread stops it; back at the bottom, or
     sending a message, starts it again. Growing text never fires a scroll event, so following holds while it streams. */
  const following = useRef(true);
  const busy = streaming !== null;

  const send = async (text: string) => {
    if (!provider || busy || !text.trim()) return;
    setError(null);
    following.current = true;
    setStreaming("");
    setDraft("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      for await (const event of streamPlan({ planId: plan?.id ?? null, text: text.trim(), provider }, controller.signal)) {
        if (event.type === "plan" || event.type === "done") {
          setPlan(event.plan);
          /* The chat's address names it from its first message, so a reload comes back to it. */
          /* replaceState, not the router: a navigation would render the page again and cut the answer off. */
          if (event.type === "plan" && new URL(location.href).searchParams.get("id") !== event.plan.id) window.history.replaceState(null, "", `/plan?id=${event.plan.id}`);
        } else if (event.type === "text") setStreaming((current) => (current ?? "") + event.delta);
        else if (event.type === "fixing") setFixing(true);
        else setError(event.message);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "The tutor stopped unexpectedly.");
    } finally {
      setStreaming(null);
      setFixing(false);
      abort.current = null;
    }
  };

  useEffect(() => {
    if (firstMessage && !initialPlan && provider && !autoSent.current) {
      autoSent.current = true;
      void send(firstMessage);
    }
  });

  useEffect(() => {
    /* Measured at the last message, not the page: the composer and padding below it would otherwise make the
       follow-scroll itself read as "scrolled away". */
    const onScroll = () => {
      const end = bottom.current?.getBoundingClientRect().bottom;
      following.current = end === undefined || end <= window.innerHeight + 96;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (following.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [plan?.messages.length, streaming]);

  const latestRoadmap = plan?.messages.findLastIndex((message) => message.role === "assistant" && message.roadmap) ?? -1;

  const approve = async () => {
    if (!plan) return;
    setApproving(true);
    setError(null);
    try {
      const response = await fetch("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id }) });
      const body = (await response.json().catch(() => null)) as { course?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.course) throw new Error(body?.error ?? "The course could not be saved.");
      router.push(`/course/${body.course.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The course could not be saved.");
      setApproving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {!plan?.messages.length && !busy ? (
        <p className="text-callout text-fog">
          Say what you want to learn. The tutor asks where you’re starting from, what you’re after and how much time you have, then lays out a plan from your books.
        </p>
      ) : null}
      {plan?.messages.map((message, index) =>
        message.role === "user" ? (
          <div key={index} className="self-end max-w-[85%] rounded-xl bg-panel-raised px-3 py-2 text-callout leading-relaxed text-paper shadow-chip whitespace-pre-wrap">
            {message.content}
          </div>
        ) : (
          <div key={index} className="flex flex-col gap-3 text-callout leading-relaxed text-prose">
            <Markdown text={withoutRoadmap(message.content) || (message.partial ? "*Stopped.*" : "")} />
            {message.roadmap ? (
              <RoadmapCard
                roadmap={message.roadmap}
                footer={
                  index === latestRoadmap ? (
                    <div className="flex items-center gap-2">
                      <Button variant="primary" size="md" onClick={approve} disabled={approving || busy}>
                        {approving ? <Spinner /> : <Check />}
                        {plan.courseId ? "Update the course" : "Approve and create the course"}
                      </Button>
                      <span className="text-label text-dim">Or ask for changes below.</span>
                    </div>
                  ) : (
                    <p className="text-label text-dim">An earlier version. The latest roadmap is further down.</p>
                  )
                }
              />
            ) : null}
          </div>
        ),
      )}
      {busy ? (
        <div className="flex flex-col gap-2 text-callout leading-relaxed text-prose">
          {streaming ? <StreamingMarkdown text={withoutRoadmap(streaming)} /> : null}
          <p className="flex items-center gap-2 text-label text-dim">
            <Spinner />
            {fixing ? "Fixing the roadmap’s format…" : streaming && /```roadmap/.test(streaming) ? "Writing the roadmap…" : "Thinking…"}
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : null}
      <div ref={bottom} />
      <form
        className="sticky bottom-4 flex items-end gap-2 rounded-[calc(var(--radius-sm)+8px)] bg-panel-raised p-2 shadow-canvas"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          aria-label="Message the tutor"
          rows={2}
          autoFocus={!plan?.messages.length && !firstMessage}
          value={draft}
          placeholder={plan?.messages.length ? "Answer, or ask for changes" : "I want to learn…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(draft);
            }
          }}
          className="min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-callout text-paper outline-none placeholder:text-dim"
        />
        <IconButton type="submit" label={unavailable ?? "Send"} disabled={!provider || busy || !draft.trim()}>
          <ArrowUp />
        </IconButton>
      </form>
      {unavailable && !busy ? <p className="-mt-3 text-label text-dim">{unavailable}</p> : null}
    </div>
  );
}
