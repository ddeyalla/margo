import type { LibraryEntry, PlanMessage } from "@/lib/shared/courses";
import { tokenize } from "@/lib/shared/search";
import type { BookId } from "@/lib/shared/types";
import { readLibrary } from "../library";
import { bookText, searchLibrary } from "../search/index";
import { readBookState } from "../store";

export const PLANNER_SYSTEM = `You help someone plan what to learn from books, as a course they work through at their own pace. They start by saying what they want to learn.

## Before the roadmap

Find out three things, a question or two at a time, in plain words:
- their level: what they already know of the subject, and what they've read or done;
- their goal: what they want to be able to do or understand at the end;
- their time: roughly how many hours a week they can give it.

If they already told you one, don't ask again. Keep each turn short. Once you know all three, propose the roadmap in the same turn; don't ask permission first.

## The roadmap

- Units in a sensible order, each a handful of concepts that build on the unit before.
- For each unit, the books and the chapters of them that cover it. Name only the chapters that matter; skipping is fine.
- Prefer books in the reader's library, listed below. For those, copy chapter names exactly from the book's chapter list, and give the book's id as "libraryId". If no chapter list is given for a library book, name the chapters as the book's table of contents does.
- Add a book that isn't in the library only when the library has nothing good for a unit. Give its exact title, author and the edition you mean; the reader will find it.
- A rough timeline from their weekly time: weeks per unit, and the total.
- Write a sentence or two around the roadmap saying how it fits what they told you. Don't repeat the roadmap in prose.

When they ask for changes, make them and give the whole roadmap again, not just the changed part. They approve it with a button, so never ask them to type "approve".

## Roadmap format

Put the roadmap at the very end of your answer, in a fenced block marked roadmap, holding exactly one JSON object:

\`\`\`roadmap
{"name": "short course name", "goal": "what they'll be able to do", "level": "where they start, in a few words", "weeklyHours": 4, "timeline": "about 9 weeks",
 "books": [{"key": "b1", "libraryId": "id from the library list, or null", "title": "...", "author": "...", "edition": "for books to find, else null"}],
 "units": [{"title": "...", "concepts": ["...", "..."], "weeks": 2, "readings": [{"book": "b1", "chapters": ["exact chapter name", "..."]}]}]}
\`\`\`

Only one roadmap block per answer, and none until you know their level, goal and time.`;

/** About how many library books get their chapter lists in the prompt; the rest are listed by title only. */
const WITH_CHAPTERS = 12;
const MAX_CHAPTERS = 60;

/**
 * Every library book the planner may use, with chapter lists for the books whose text has been read. Books not
 * read yet are queued for the search builder, so a later turn has their chapters.
 */
export const libraryEntries = async (): Promise<LibraryEntry[]> => {
  const { books } = await readLibrary();
  const entries = await Promise.all(
    books.map(async (book): Promise<LibraryEntry> => {
      const [state, text] = await Promise.all([readBookState(book.id).catch(() => null), bookText(book.id, { extract: false }).catch(() => null)]);
      return {
        id: book.id,
        title: state?.meta?.title || book.fileTitle,
        author: state?.meta?.author ?? book.fileAuthor,
        chapters: text?.chapters ?? null,
      };
    }),
  );
  if (entries.some((entry) => entry.chapters === null)) void searchLibrary("").catch(() => undefined);
  return entries;
};

/** The books most about what the reader has said, by shared words in their titles and chapters. */
const relevant = (entries: readonly LibraryEntry[], said: string): Set<BookId> => {
  if (entries.length <= WITH_CHAPTERS) return new Set(entries.map((entry) => entry.id));
  const words = new Set(tokenize(said));
  const scored = entries.map((entry) => {
    const title = tokenize(`${entry.title} ${entry.author ?? ""}`);
    const chapters = tokenize((entry.chapters ?? []).join(" "));
    const score = title.filter((w) => words.has(w)).length * 3 + new Set(chapters.filter((w) => words.has(w))).size;
    return { id: entry.id, score };
  });
  return new Set(
    scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, WITH_CHAPTERS)
      .map((entry) => entry.id),
  );
};

/** The library as the planner sees it: every book by id, title and author, and chapters for the relevant ones. */
export const libraryBlock = (entries: readonly LibraryEntry[], messages: readonly PlanMessage[]): string => {
  if (!entries.length) return "The reader's library is empty. Every book you suggest is one they'll need to find.";
  const said = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
  const detailed = relevant(entries, said);
  const lines = entries.map((entry) => {
    const head = `- id ${entry.id}: ${entry.title}${entry.author ? `, by ${entry.author}` : ""}`;
    if (!detailed.has(entry.id) || !entry.chapters?.length) return head;
    return `${head}\n  Chapters: ${entry.chapters
      .slice(0, MAX_CHAPTERS)
      .map((chapter) => JSON.stringify(chapter))
      .join(", ")}`;
  });
  return `## The reader's library\n\n${lines.join("\n")}`;
};
