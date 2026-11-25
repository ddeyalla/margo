import path from "node:path";
import { addActivity, emptyActivity, type ActivityFile, type ActivityKind } from "@/lib/shared/mastery";
import { studyDay } from "@/lib/shared/schedule";
import type { BookId } from "@/lib/shared/types";
import { getConfig } from "./config";
import { readJson, updateJson } from "./store";

/** Learning time across every book, by study day. One file, never pruned: streaks read all of it. */
export const activityFile = (dataDir = getConfig().dataDir) => path.join(/*turbopackIgnore: true*/ dataDir, "activity.json");

export const readActivity = async (dataDir = getConfig().dataDir): Promise<ActivityFile> => ({
  ...emptyActivity(),
  ...(await readJson<Partial<ActivityFile>>(activityFile(dataDir))),
});

/** Adds checked seconds to the day they were spent, as the server's clock sees it. */
export const recordActivity = (bookId: BookId, kind: ActivityKind, seconds: number, now = new Date(), dataDir = getConfig().dataDir): Promise<ActivityFile> =>
  updateJson(activityFile(dataDir), emptyActivity, (current) => addActivity({ ...emptyActivity(), ...current }, studyDay(now), bookId, kind, seconds));
