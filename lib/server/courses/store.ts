import path from "node:path";
import { emptyCourses, type CoursesFile } from "@/lib/shared/courses";
import { getConfig } from "../config";
import { readJson, updateJson } from "../store";

/** Courses span books, so they live in one file of their own rather than in any book's state. */
export const coursesFile = (dataDir = getConfig().dataDir) => path.join(/*turbopackIgnore: true*/ dataDir, "courses.json");

export const readCourses = async (dataDir = getConfig().dataDir): Promise<CoursesFile> => ({
  ...emptyCourses(),
  ...(await readJson<Partial<CoursesFile>>(coursesFile(dataDir))),
});

/** Reads, changes and writes the courses file inside its queue. */
export const updateCourses = (change: (current: CoursesFile) => CoursesFile, dataDir = getConfig().dataDir): Promise<CoursesFile> =>
  updateJson(coursesFile(dataDir), emptyCourses, (current) => change({ ...emptyCourses(), ...current }));
