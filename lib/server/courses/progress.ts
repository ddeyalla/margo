import type { Course } from "@/lib/shared/courses";
import type { BookId } from "@/lib/shared/types";
import { readBookState } from "../store";

/** How far into each library book of the Course the reader is, from 0 to 1, or null if they never opened it. */
export const readingProgress = async (course: Course): Promise<Map<BookId, number | null>> => {
  const ids = [...new Set(course.books.flatMap((book) => (book.bookId ? [book.bookId] : [])))];
  const states = await Promise.all(ids.map((id) => readBookState(id).catch(() => null)));
  return new Map(ids.map((id, i) => [id, states[i]?.position?.fraction ?? null]));
};
