import type { NoteSave, OpenedNote } from "@/lib/shared/notes";

/* One open note: what the editor holds, the version on disk it was based on, and saving between the two.
   The server never overwrites a file that changed since `base`; this side never replaces the reader's
   unsaved text with the disk's. Framework-free so the rules can be tested without a browser. */

export interface NoteApi {
  save(path: string, text: string, baseHash: string): Promise<NoteSave>;
  /** The file's version when it is no longer `since`: a hash, null when deleted, undefined when unchanged. */
  change(path: string, since: string): Promise<string | null | undefined>;
  open(path: string): Promise<OpenedNote | null>;
}

export type SaveStatus = "saved" | "unsaved" | "saving" | "error";

export interface NoteEvents {
  /** The editor must show this text: the file changed on disk and there was nothing unsaved to lose. */
  replace(text: string): void;
  status(status: SaveStatus, error?: string): void;
  /** A save found the file changed (or deleted) on disk. The reader's text is in `copy`; the editor shows `current`. */
  conflict(copy: string, deleted: boolean): void;
  /** The file was deleted on disk while nothing here was unsaved. */
  gone(): void;
  /** The note was opened again from disk, with fresh backlinks. */
  reopened?(note: OpenedNote): void;
}

export const SAVE_DELAY_MS = 800;

export class NoteSession {
  private base: { text: string; hash: string } | null;
  private text: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private closed = false;

  constructor(
    readonly path: string,
    opened: { text: string; hash: string },
    private readonly api: NoteApi,
    private readonly events: NoteEvents,
  ) {
    this.base = { text: opened.text, hash: opened.hash };
    this.text = opened.text;
  }

  /** Text typed that the disk does not have yet. */
  get dirty() {
    return this.base === null || this.text !== this.base.text;
  }

  /** What a last save as the page closes would send, or null when there is nothing unsaved. */
  unsaved(): { text: string; baseHash: string } | null {
    return this.dirty && this.base && !this.closed ? { text: this.text, baseHash: this.base.hash } : null;
  }

  /** The reader changed the text: save it shortly. */
  edit(text: string) {
    if (this.closed || this.base === null) return;
    this.text = text;
    this.events.status(this.dirty ? "unsaved" : "saved");
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, SAVE_DELAY_MS);
  }

  /** Saves now, and waits for any save already going. Call before leaving the note. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.save();
  }

  /** Stops saving: the note was closed. Call flush first. */
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private save(): Promise<void> {
    if (this.saving) return this.saving.then(() => (this.dirty && !this.closed ? this.save() : undefined));
    if (!this.dirty || this.base === null) return Promise.resolve();
    const run = this.saveOnce().finally(() => {
      this.saving = null;
    });
    this.saving = run;
    return run;
  }

  private async saveOnce() {
    const base = this.base!;
    const text = this.text;
    this.events.status("saving");
    let result: NoteSave;
    try {
      result = await this.api.save(this.path, text, base.hash);
    } catch (error) {
      this.events.status("error", error instanceof Error ? error.message : String(error));
      return;
    }
    if (result.state === "saved") {
      this.base = { text, hash: result.hash };
      if (this.dirty) this.schedule();
      this.events.status(this.dirty ? "unsaved" : "saved");
      return;
    }
    /* Typed while the save was out: those words belong in the copy too, which is the reader's own file. */
    if (this.text !== text) {
      await this.api.save(result.copy, this.text, result.copyHash).catch(() => undefined);
    }
    if (result.current) {
      this.base = result.current;
      this.text = result.current.text;
      this.events.replace(result.current.text);
      this.events.status("saved");
    } else {
      this.base = null;
      this.close();
    }
    this.events.conflict(result.copy, result.current === null);
  }

  /**
   * Looks for a change made on disk, such as an edit in Obsidian, and shows it when nothing typed here would be
   * lost. With unsaved text it does nothing: the next save finds the change and keeps both.
   */
  async checkDisk(): Promise<void> {
    if (this.closed || this.saving || this.dirty || !this.base) return;
    const since = this.base.hash;
    const change = await this.api.change(this.path, since).catch(() => undefined);
    if (change === undefined || this.closed || this.saving || this.dirty || this.base?.hash !== since) return;
    if (change === null) {
      /* Deleted elsewhere with nothing unsaved here: nothing to keep. */
      this.base = null;
      this.close();
      this.events.gone();
      return;
    }
    const opened = await this.api.open(this.path).catch(() => null);
    if (!opened || this.closed || this.saving || this.dirty || this.base?.hash !== since) return;
    this.base = { text: opened.text, hash: opened.hash };
    this.text = opened.text;
    this.events.replace(opened.text);
    this.events.reopened?.(opened);
  }
}
