import type { ProviderId } from "@/lib/shared/types";
import type { FoundBook } from "../library";
import { readSettings } from "../settings";
import { readBookState, updateBookState } from "../store";
import { CHECK_MODEL } from "../check/provider";
import { PROVIDERS, modelFor } from "../tutor/providers";
import { writeQuiz } from "./generate";

/**
 * Quizzes being written, and the last failure for a chapter, by book and chapter. Writing runs off the request,
 * so the reader can keep reading; nothing waits on it. On globalThis because the dev server loads this module
 * once per route.
 */
interface Jobs {
  writing: Map<string, number>;
  failed: Map<string, string>;
}
const jobs = ((globalThis as { [key: symbol]: unknown })[Symbol.for("rigg-learn.quiz-jobs")] ??= {
  writing: new Map(),
  failed: new Map(),
}) as Jobs;

const key = (bookId: string, chapter: string) => `${bookId}\n${chapter}`;

/** The chapters of a book whose quiz is being written, and those whose last try failed, with why. */
export const quizJobs = (bookId: string) => {
  const writing: string[] = [];
  const failed: { chapter: string; error: string }[] = [];
  for (const id of jobs.writing.keys()) if (id.startsWith(`${bookId}\n`)) writing.push(id.slice(bookId.length + 1));
  for (const [id, error] of jobs.failed) if (id.startsWith(`${bookId}\n`)) failed.push({ chapter: id.slice(bookId.length + 1), error });
  return { writing, failed };
};

/**
 * Starts writing a chapter's quiz unless one is being written or already exists. Writing includes checking every
 * question against the chapter's text, which is the slow part and why it all happens here, off the request. The
 * written quiz is stored in the book's state; a quiz already taken is never replaced.
 */
export const startQuiz = async ({ book }: FoundBook, chapter: string, labels: string[], providerId: ProviderId): Promise<void> => {
  const id = key(book.id, chapter);
  if (jobs.writing.has(id)) return;
  const [state, settings] = await Promise.all([readBookState(book.id), readSettings()]);
  if (state.quizzes.some((quiz) => quiz.chapter === chapter)) return;
  jobs.writing.set(id, Date.now());
  jobs.failed.delete(id);
  const label = { title: state.meta?.title ?? book.fileTitle, author: state.meta?.author ?? book.fileAuthor };
  void (async () => {
    try {
      const quiz = await writeQuiz(PROVIDERS[providerId], { bookId: book.id, book: label, chapter, labels }, { model: modelFor(settings.models, providerId), checkModel: CHECK_MODEL[providerId] }, new AbortController().signal);
      await updateBookState(book.id, (current) =>
        current.quizzes.some((q) => q.chapter === chapter) ? current : { ...current, quizzes: [...current.quizzes, quiz] },
      );
    } catch (error) {
      jobs.failed.set(id, error instanceof Error ? error.message : "The quiz couldn't be written.");
      console.warn(`Could not write the quiz for “${chapter}”:`, error);
    } finally {
      jobs.writing.delete(id);
    }
  })();
};
