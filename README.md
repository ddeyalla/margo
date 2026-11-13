# rigg learn

Read your own EPUB and PDF books with an AI tutor beside you.

Select a passage and ask the tutor to explain it, go deeper, or answer a question. Highlight what matters. Write notes in markdown. Everything you save is also copied to a markdown file, so your notes show up in Obsidian.

The app runs on your own computer. Your books stay there.

![The library, with covers and reading progress](docs/screenshots/library.png)

![Reading in Pages view, with the selection toolbar and the tutor panel](docs/screenshots/reader.png)

| Chapters | PDF with highlights and a note |
| --- | --- |
| ![Chapters drawer](docs/screenshots/chapters.png) | ![A dark PDF page with highlights and a note](docs/screenshots/pdf-notes.png) |

## What you need

- [Node.js 22](https://nodejs.org). Check with `node --version` in a terminal.
- A folder of EPUB or PDF books. Subfolders are fine.
- One tutor. See [Pick a tutor](#pick-a-tutor).

## Set it up

1. Open a terminal in this folder.

2. Install what the app needs.

   ```bash
   npm install
   ```

3. Make your own settings file from the example.

   ```bash
   cp .env.example .env.local
   ```

4. Open `.env.local` in a text editor. Put in the full path to your books folder. Paths start with `/`.

   ```bash
   BOOKS_DIR=/Users/you/Books
   NOTES_DIR=/Users/you/Obsidian/Reading
   ANTHROPIC_API_KEY=
   ```

The app only reads `BOOKS_DIR`. It never moves, renames or changes your books.

`.env.local` is private. Git ignores it, so your paths and key are never committed.

## Send your notes to Obsidian

Set `NOTES_DIR` to a folder inside your Obsidian vault, such as `Reading`. The app makes the folder if it is missing.

Each book gets one file, named after its title. Highlights sit under their chapter. Each one is a quote with a block id, so you can link to it from your other notes. A note sits under the quote it belongs to. Any `#tag` you write in a note is added to the file's tags.

```markdown
## Considerations

> and then fine-tuning your model later to boost its performance and provide more consistent, reliable outputs. ^h-c64781df

Fine-tuning only pays off once you have the data. #training
```

The file is a copy. The app writes it again after every change, so edits you make in Obsidian are replaced. Change highlights and notes in the app.

Leave `NOTES_DIR` empty if you don't want a copy. Everything is still saved in the app.

## Pick a tutor

The tutor can run through any one of these. You only need one.

- **Claude Code.** Install [Claude Code](https://claude.com/claude-code), then run `claude` in a terminal once and sign in. It uses your Claude plan.
- **Codex.** Install the Codex CLI, then run `codex login` in a terminal and sign in.
- **Anthropic API.** Put your key after `ANTHROPIC_API_KEY=` in `.env.local`. You pay per use.

Pick one from the menu at the top of the Chat tab. The menu says which ones are ready, and what to do for the rest. The app remembers your choice.

## Start it

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Your books are listed by folder, with their covers. The ones you read last sit under Continue reading. A bar under each book you've started shows how far you are.

Stop the app with `Ctrl+C` in the terminal.

## Read

- **Ask the tutor.** Select text. A small toolbar appears. Choose Explain, Go deeper or Ask.
- **Highlight.** Select text and choose the highlighter, or press `⌘⇧H`. Click a highlight to remove it or open its note.
- **Write a note.** Select text and choose the notebook button. Notes are markdown. `⌘↩` saves.
- **Find them again.** The Notes and Highlights tabs list everything for the book. Click a quote to jump to it.
- **Chapters.** The list button at the top left, or `⌘⇧L`, opens the table of contents in a column beside the book. The book makes room for it and keeps your place. The chapter you're in is marked. Click any chapter to go there. In a narrow window the list slides over the book instead.
- **Scroll or pages.** Switch at the top right. Pages shows one page at a time, or two side by side in an EPUB when there's room. Turn pages with the arrow keys, `Page Up` and `Page Down`, or the arrows at the edges. Your place is kept when you switch, and the app remembers your choice.
- **Page colours.** The moon and sun at the top right switch an EPUB between a dark page and a warm light one. Only the page changes; the app around it stays dark. Your place is kept. In a PDF, the moon shows white pages dark and the sun shows them in their own colours. Photos keep their colours.
- **More room.** `⌘\` hides or shows the side panel. `Esc` closes the toolbar.

A PDF made of scanned pictures has no text to select. You can still read it, but highlights, notes and the tutor need text.

## Where your data lives

| What | Where |
| --- | --- |
| Your books | `BOOKS_DIR`. Never changed. |
| Reading place, chats, highlights and notes | `data/<book id>.json`, one file per book |
| Your tutor choice, scroll or pages, and the page colours for EPUBs and PDFs | `data/settings.json` |
| Book covers, made from each book the first time it's shown | `data/covers/`. Safe to delete; they're made again. |
| The markdown copy of each book's notes | `NOTES_DIR/<book title>.md` |

The `data/` folder is the real record. Git ignores it. Back it up if your notes matter to you.

To use a different model, add it to `data/settings.json` under the tutor's name (`claude`, `codex` or `api`). For example, `"models": { "claude": "claude-opus-5-5" }`.

## What Phase 2 might add

- Flashcards made from your highlights. The Card button is there, marked "Soon".
- Reading your Obsidian edits back into the app.
- Search across your books and notes.
- A light theme for the whole app. EPUB pages can already be light.
- A Mac app with a Dock icon and a folder picker.

## How it works

It's a [Next.js](https://nextjs.org) app. The browser shows the books and the panel. A small server on your computer does everything that touches files or the tutor, so the browser never reads your disk or sees your key.

| Part | Where | What it does |
| --- | --- | --- |
| Library | `app/page.tsx`, `lib/server/library.ts` | Scans `BOOKS_DIR`. Each book's id is a hash of its path, and files are only ever served by id. |
| EPUB reader | `components/reader/EpubReader.tsx` | Renders with [foliate-js](https://github.com/johnfactotum/foliate-js), kept in `public/vendor/foliate-js`. |
| PDF reader | `components/reader/PdfReader.tsx` | Renders with [pdf.js](https://mozilla.github.io/pdf.js/), with its text layer so you can select. |
| Tutor | `app/api/chat/route.ts`, `lib/server/tutor/` | One adapter per tutor (Claude Code, Codex, API). Answers stream back to the panel. |
| Saving | `lib/server/store.ts` | Writes `data/<book id>.json` safely: to a temp file first, one write at a time per book. |
| Obsidian copy | `lib/server/vault.ts` | Rewrites the book's markdown file after every highlight or note change. |
| Covers | `lib/server/covers.ts` | Takes the cover from the EPUB, or draws page 1 of a PDF, and caches it. |

Claude Code and Codex run as separate programs with no tools turned on, in an empty temp folder, and with only a short list of environment variables. They can answer, but they can't read or change your files.

## For developers

```bash
npm test          # unit tests
npm run lint      # code style
npx tsc --noEmit  # type check
npm run build     # production build
```

## Credits

- [foliate-js](https://github.com/johnfactotum/foliate-js) by John Factotum, MIT licence. A copy is in `public/vendor/foliate-js` with its `LICENSE`.
- [pdf.js](https://github.com/mozilla/pdf.js) by Mozilla, Apache 2.0.
- [Literata](https://github.com/googlefonts/literata) for book text, [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) for the interface. All SIL Open Font Licence.
