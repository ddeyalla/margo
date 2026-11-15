"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef } from "react";
import { markRefresh } from "@/lib/client/open";

/**
 * Shows what another window changed. When this window loses focus or hides it takes a snapshot of
 * `readRevision`; when it comes back it reads the revision again and refreshes the route if it differs.
 * Writes this window made were all done before the snapshot, so it never reloads for its own changes.
 * With no `readRevision` it refreshes on every return, without the mark: only a refreshed book page stays quiet. `beforeLeave` runs first, so a pending save lands before the snapshot.
 * While `isBusy` is true, such as an answer still streaming in, this window is still writing, so it skips the refresh:
 * reloading then would cut the work off, and the change it sees may be its own.
 */
export function useRefreshOnReturn(
  readRevision: (() => Promise<string | null>) | null,
  beforeLeave?: () => Promise<unknown>,
  isBusy: () => boolean = () => false,
) {
  const router = useRouter();
  const snapshot = useRef<Promise<string | null> | null>(null);
  const busyAtLeave = useRef(false);
  const busy = useEffectEvent(isBusy);

  useEffect(() => {
    const leave = () => {
      if (snapshot.current) return;
      busyAtLeave.current = busy();
      snapshot.current = (async () => {
        await beforeLeave?.();
        return readRevision ? readRevision() : null;
      })().catch(() => null);
    };
    /* Focus moving into an iframe, such as an EPUB page, also blurs the window; the document keeps focus then. */
    let blurTimer = 0;
    const onBlur = () => {
      clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (!document.hasFocus()) leave();
      }, 0);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leave();
      else void back();
    };
    const back = async () => {
      const before = snapshot.current;
      snapshot.current = null;
      if (!before) return;
      const then = await before;
      if (busyAtLeave.current || busy()) return;
      if (!readRevision) return router.refresh();
      const now = await readRevision().catch(() => null);
      if (then && now && then !== now) {
        markRefresh();
        router.refresh();
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(blurTimer);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, readRevision, beforeLeave]);
}
