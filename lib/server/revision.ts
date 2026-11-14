import type { BookId } from "@/lib/shared/types";
import { settingsUpdatedAt } from "./settings";
import { bookStateUpdatedAt } from "./store";

/** Changes whenever the book's saved state or the settings are written, by any window. */
export const bookRevision = async (id: BookId): Promise<string> => {
  const [state, settings] = await Promise.all([bookStateUpdatedAt(id), settingsUpdatedAt()]);
  return `${state?.getTime() ?? 0}-${settings}`;
};
