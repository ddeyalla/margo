export {};

declare global {
  interface Window {
    /** Set by the Mac app's preload script. Absent in a browser. */
    margoApp?: {
      pickFolder(): Promise<string | null>;
      isApp: true;
    };
  }
}
