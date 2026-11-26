import { checkerFor, defaultChecker, type Checker } from "../check/provider";
import { isVerified, verifyItem } from "../check/verify";
import { PROVIDER_ORDER } from "../tutor/providers";
import { ToolError } from "./schema";
import { defineTool } from "./tool";

/* One of the two tools that ask a model. It changes nothing: the caller decides what to do with the answer. */

export const PROVIDER_FIELD = {
  type: "string",
  max: 20,
  oneOf: PROVIDER_ORDER,
  optional: true,
  description: "Which of the reader's tutors runs the check. Leave it out to use the one they chose in the app.",
} as const;

export const PASSAGE_FIELD = { type: "string", max: 12_000, description: "The passage, word for word from the book, as search_library or get_book_text gave it." } as const;

/** The tutor and model a checking tool runs on, or a `ToolError` saying none can run. */
export const requireChecker = async (asked: (typeof PROVIDER_ORDER)[number] | undefined): Promise<Checker> => {
  const checker = asked ? checkerFor(asked) : await defaultChecker();
  if (!checker) throw new ToolError("None of the reader's tutors is ready to run this. Claude Code, Codex or an Anthropic API key has to be set up in the app first.");
  return checker;
};

export const verifyItemTool = defineTool({
  name: "verify_item",
  description:
    "Checks a study question and its answer against the passage they were written from, before the reader ever sees them. A fresh model call answers the question from the passage alone, without the stored answer; a second compares the two and says whether the passage backs the stored answer. Use it on any card or quiz question you write, and propose only what comes back verified. It takes two model calls, so several seconds.",
  effect: "read",
  input: {
    question: { type: "string", max: 2_000, description: "The question as the reader would see it." },
    expected: { type: "string", max: 2_000, description: "The answer stored for the question." },
    passage: PASSAGE_FIELD,
    provider: PROVIDER_FIELD,
  },
  run: async ({ question, expected, passage, provider }) => {
    const checker = await requireChecker(provider);
    const result = await verifyItem(checker.provider, { question, expected, passage }, checker.model, new AbortController().signal);
    return { verified: isVerified(result), ...result, model: checker.model };
  },
});
