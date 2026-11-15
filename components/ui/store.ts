"use client";

import { useCallback, useInsertionEffect, useRef, useSyncExternalStore } from "react";

/**
 * A value that changes faster than the tree around it should render, such as the reading place on
 * every scroll frame. Only the components that show it subscribe; everyone else reads it when needed.
 */
export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Re-renders only when `select` returns something new; it must return a value already in the store, or a primitive. */
export function useStore<T, S>(store: Store<T>, select: (value: T) => S): S {
  const read = () => select(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}

/**
 * A function whose identity never changes but which always runs the latest `fn`, so a memoised child
 * isn't re-rendered just because its parent made a new closure. Call it from events, not while rendering.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  /* Before any layout effect, so a child's layout effect never calls the previous closure. */
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
