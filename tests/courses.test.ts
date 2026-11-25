import { describe, expect, it } from "vitest";
import { courseSteps, matchBook, matchChapter, parseRoadmap, resolveRoadmap, withoutRoadmap, type LibraryEntry } from "@/lib/shared/courses";
import type { BookId } from "@/lib/shared/types";

const fence = (value: unknown) => `Here's a plan that fits four hours a week.\n\n\`\`\`roadmap\n${typeof value === "string" ? value : JSON.stringify(value)}\n\`\`\``;

const draft = {
  name: "Product discovery",
  goal: "Run weekly customer interviews and pick what to build",
  level: "New PM",
  weeklyHours: 4,
  timeline: "about 6 weeks",
  books: [
    { key: "b1", libraryId: "cdh", title: "Continuous Discovery Habits", author: "Teresa Torres", edition: null },
    { key: "b2", libraryId: null, title: "The Mom Test: How to talk to customers", author: "Rob Fitzpatrick", edition: null },
    { key: "b3", libraryId: null, title: "Escaping the Build Trap", author: "Melissa Perri", edition: "1st edition, 2018" },
  ],
  units: [
    {
      title: "Outcomes",
      concepts: ["outcomes over outputs"],
      weeks: 2,
      readings: [{ book: "b1", chapters: ["Chapter Three: Focusing on Outcomes Over Outputs", "Chapter 5", "Chapter Ninety"] }],
    },
    { title: "Interviews", concepts: [], weeks: 2, readings: [{ book: "b2", chapters: ["Avoiding bad data"] }, { book: "b3", chapters: ["Part I"] }] },
  ],
};

const library: LibraryEntry[] = [
  { id: "cdh" as BookId, title: "Continuous Discovery Habits", author: "Teresa Torres", chapters: ["Introduction", "Chapter Three: Focusing on Outcomes Over Outputs", "Chapter Five: Continuous Interviewing"] },
  { id: "mom" as BookId, title: "The Mom Test", author: "Rob Fitzpatrick", chapters: ["The Mom Test", "Avoiding bad data", "Asking important questions"] },
];

describe("reading the planner's roadmap", () => {
  it("finds no roadmap in an answer without the block", () => {
    expect(parseRoadmap("What's your goal?")).toBeNull();
  });

  it("explains what to fix when the block can't be used", () => {
    expect(parseRoadmap(fence("{ not: json }"))).toMatch(/did not parse/);
    expect(parseRoadmap(fence("{ unfinished"))).toMatch(/no JSON object/);
    expect(parseRoadmap(fence({ ...draft, name: "" }))).toMatch(/"name"/);
    expect(parseRoadmap(fence({ ...draft, units: [{ title: "U", readings: [{ book: "b9", chapters: [] }] }] }))).toMatch(/book key/);
    expect(parseRoadmap(fence({ ...draft, books: [draft.books[0], draft.books[0]] }))).toMatch(/share the key/);
  });

  it("reads a good block, and the words around it show without it", () => {
    const parsed = parseRoadmap(fence(draft));
    expect(parsed).toMatchObject({ name: "Product discovery", weeklyHours: 4, units: [{ weeks: 2 }, { readings: [{ book: "b2" }, { book: "b3" }] }] });
    expect(withoutRoadmap(fence(draft))).toBe("Here's a plan that fits four hours a week.");
  });

  it("reads a block still being written as unfinished, not as words", () => {
    expect(withoutRoadmap("Here it is.\n\n```roadmap\n{\"name\": \"Pro")).toBe("Here it is.");
  });
});

describe("matching a roadmap to the library", () => {
  it("matches books by id, then by title without the subtitle; the rest are to find", () => {
    expect(matchBook({ title: "The Mom Test: How to talk to customers", author: null }, library)?.id).toBe("mom");
    expect(matchBook({ title: "Escaping the Build Trap", author: null }, library)).toBeNull();
  });

  it("matches chapters to the book's own labels, and keeps the rest as planned", () => {
    expect(matchChapter("chapter three: focusing on outcomes over outputs", library[0].chapters!)).toBe("Chapter Three: Focusing on Outcomes Over Outputs");
    expect(matchChapter("Chapter Five", library[0].chapters!)).toBe("Chapter Five: Continuous Interviewing");
    expect(matchChapter("Chapter Ninety", library[0].chapters!)).toBeNull();
  });

  it("resolves the whole roadmap and lists the found chapters in course order", () => {
    const roadmap = resolveRoadmap(parseRoadmap(fence(draft)) as Exclude<ReturnType<typeof parseRoadmap>, string | null>, library);
    expect(roadmap.books.map((book) => book.bookId)).toEqual(["cdh", "mom", null]);
    expect(roadmap.books[2]).toMatchObject({ title: "Escaping the Build Trap", edition: "1st edition, 2018" });
    expect(roadmap.units[0].readings[0].chapters).toEqual([
      { title: "Chapter Three: Focusing on Outcomes Over Outputs", inBook: true },
      { title: "Chapter 5", inBook: false },
      { title: "Chapter Ninety", inBook: false },
    ]);
    expect(courseSteps(roadmap)).toEqual([
      { bookId: "cdh", chapter: "Chapter Three: Focusing on Outcomes Over Outputs", unit: 0 },
      { bookId: "mom", chapter: "Avoiding bad data", unit: 1 },
    ]);
  });
});
