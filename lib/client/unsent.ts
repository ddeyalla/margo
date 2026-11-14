import { useEffect } from "react";

let held = 0;
/** True while any field holds typed words that were not sent, so a window refresh does not throw them away. */
export const hasUnsentText = () => held > 0;

/** Registers a field as holding unsent text while `dirty` is true. */
export function useUnsentText(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    held++;
    return () => {
      held--;
    };
  }, [dirty]);
}
