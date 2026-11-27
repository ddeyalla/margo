# Roadmap

What to build next, in order. Ideas come from
[learnharness](https://github.com/amosblomqvist/learnharness.git) (AGPL-3.0) and
[anything](https://github.com/ai4next/anything) (GPL-3.0), so every item is rewritten
here, never copied. This repo is MIT; pasting their code in would relicense it.

Effort: `S` hours · `M` a day or two · `L` a week or more.

## Ground rules

- **Card review never waits on a model.** Flip and rate, on the reader's machine. A free-text
  answer is another matter: since 2026-11-26 the checker may grade one the reader wrote
  (Phases 27 and 28), and one tap overrules the grade.
- **The highlight owns the schedule, not the card.** Three cards on one highlight are one
  review, not three.
- **Cards outlive the highlight.** Deleting a highlight keeps its cards and their schedule.
- **Cards and tutor questioning are opt-in.** Nothing happens until the reader asks.
  The exception is the quiz at the end of a chapter (Phases 17 and 29). Inside a Course it
  is part of finishing the chapter; anywhere else it is offered once, and passing over it
  is remembered.
- **Every questioning mode has a way out.** "Just tell me" is always one click away. A
  chapter quiz can be retaken without limit, and a missed question shows its answer.
- **Mastery is computed from evidence, never stored as a number.** Coverage and retention
  are read from reading position, card schedules and quiz results, so they can't be
  inflated and they fall when you stop reviewing.
- **Quizzes are written ahead, not on the spot.** Recall questions never wait on a model.
  The one written answer in a chapter test waits on the checker, and falls back to the
  reader's own mark when it can't be graded (Phase 29).
- **Nothing the tutor writes as a question is saved unchecked.** A quiz question or a card is
  kept only after a second model call answered it from its passage without seeing the stored
  answer, and the two agreed (Phase 27).
- **A model's grade is advice.** The reader can overrule it in one tap, and a middling answer
  is reported as unsure, not given a verdict. Flip-and-rate review never waits on one.
- **A moment away from the book is a modal over it; a new task is a page.** When the reader's
  attention leaves the page for a short turn and must come back to the same place (answering
  a question, a review, a chapter's test, a search), the turn opens in a modal over the book.
  A page is for when attention moves on to something else: the library, a Course, what you
  know. What follows from it, and is checked when a surface is added (Phase 31):
  - The book stays mounted and in place behind the modal. Nothing beside it folds or resizes.
  - Esc, the close button and a click outside all return to the exact reading position.
  - Nothing typed is lost by closing. An unfinished answer is saved and opens again where it
    was. Where the work lives only in the modal, as in a test part-way through, a click
    outside does not close it.
  - Nothing in a modal navigates away, and a modal never opens a second one of its own.
  - A modal that asks for recall blurs the book behind it until the answer is in, since a
    visible passage would answer the question.
  - Exceptions: what the reader consults while reading is not modal at all (the tutor panel,
    notes, the contents). What needs the room, a whiteboard, takes the pane or sits beside the
    book. Long or many-step work gets a page.

## Phase 1 — Tighter tutor answers · S

Prompt changes in `lib/server/tutor/prompt.ts`. No UI.

- [x] Smallest useful answer: no preamble, no closing summary, the rest left for
      follow-ups.
- [x] Say plainly when unsure, before building on it.
- [x] Ask at most one question per reply.
- [x] **Guess first on Go deeper:** pose one question about the passage, hold the
      explanation until the reader answers. Change `ACTION_REQUESTS.deeper`.

Done when `tests/tutor.test.ts` passes and five real questions read tighter.

## Phase 2 — Card prompt check · S

The risk is the prompt, not the code. Prove it before building any UI.

- [x] Draft the card prompt: pick one fact the passage supports, then write 1–3 questions
      that each reach it a different way. Zero cards when the passage has no clear fact.
      `scripts/card-eval/prompt.md`.
- [x] Run it on 20 passages (your tutor threads plus other books) with one fixed model.
- [x] Score each: answer supported by the text · question answerable on its own · every
      card recalls the same fact.

Gate: **70 % pass on all three.** Below that, fix the prompt and rerun.

Passed on round 2: 95 % · 85 % · 70 %. Scores and open issues in
`scripts/card-eval/README.md`.

## Phase 3 — Scheduler · M

Pure functions and tests in `lib/shared/schedule.ts`. No routes, no components.

- [x] Add `ts-fsrs`, pinned to an exact version. Retention 0.9, learning steps 1 m and
      10 m, relearning 10 m.
- [x] Card choice: weighted by each card's last rating (Again 4, Hard 3, Good 2, Easy 1,
      never tried 3).
- [x] A highlight still in learning keeps showing the card it failed until it graduates.
- [x] Next interval for each of the four ratings, for the buttons.
- [x] Study day starts at 04:00 local and survives daylight-saving changes.
- [x] Rating the same showing twice is ignored.

Done when those cases have tests.

## Phase 4 — Card data and generation · M

- [x] Replace the unused `Card` in `lib/shared/types.ts:130` with a `CardSet`: id,
      anchor, quote, the fact, cards (question and answer), one schedule. Migrate old
      `data/*.json` in `lib/server/store.ts`.
- [x] A second generation on the same passage (`sameAnchor`) adds to its existing set.
- [x] `POST /api/books/:id/cards`: the Phase 2 prompt through the chosen tutor, JSON back,
      validated. Bad JSON goes back once with the error. Doesn't touch the chat session.
- [x] Turn on the Card button in `SelectionToolbar.tsx` (remove "Soon").
- [x] Edit and delete a single card.

## Phase 5 — Review · M

- [x] Cards tab beside Notes and Highlights, grouped by chapter (`byChapter`).
- [x] Review sheet over the book, keeping your place: question → Space to reveal →
      Again / Hard / Good / Easy (1–4), each showing its next interval.
- [x] New highlights per day: 10 per book by default. Due reviews uncapped.
- [x] Render both sides with `components/chat/Markdown.tsx`.
- [x] Write each highlight's cards under it in the Obsidian file (`lib/server/vault.ts`),
      so the README's "everything is copied" stays true.

## Phase 6 — Work it out · M

Folded into Go deeper in Phase 28: the button is gone, and threads saved as Work it out still
run on the rules below.

A fourth toolbar action. The tutor leads the reader to the answer instead of giving it.
Check it on 20 passages first: one question per turn, no early answer, nudges use the
reader's own words. Passed on round 2: 16 · 17 · 19 of 20, and 17 of 20 for Hint 1.
Questions joined by "and" still slip through; see `scripts/work-eval/README.md`.

- [x] New `TutorAction` `"work"`, labelled "Work it out", kept for the thread's life.
- [x] Prompt: decide the right answer first, name the target in one line ("why X holds"),
      then ask. Judge each reply right / partly / wrong, and nudge at the first mistake
      without giving the correction.
- [x] **Hint** button, one step per click: re-read this part → what kind of idea it is →
      name it → the worked step.
- [x] **Just tell me** button: the tutor explains it fully. Also happens on its own after
      six turns.

## Phase 7 — Explain it back · S

- [x] Toolbar action: the reader writes two lines on the passage; the tutor points to the
      first mistake, or says it holds. No grade.
      *Folded into Go deeper in Phase 28, where an explain-back is graded. Threads saved
      this way still run as written here.*

## Phase 8 — Mac app · L

- [x] Electron shell around the Next server. Reference: learnharness `electron/`,
      `docs/desktop-release.md`.
- [x] Folder picker instead of `BOOKS_DIR`, Dock icon.
- [ ] Signed DMG. *Paused:* the project is open source and ships from GitHub unsigned, so the
      first open needs right-click, Open.
- [x] No auto-update, no Windows or Linux builds.

## Phase 9 — Voice input · M

Speak instead of typing, anywhere you'd type to the tutor. Runs on this machine; no audio
leaves it. Reference: [Handy](https://github.com/cjpais/Handy) (MIT), which uses the same
model.

- [x] Parakeet TDT 0.6B v3 (int8) through `sherpa-onnx-node` on the server, so the
      browser and the app share one model. Checked: a 7 s question in 0.25 s, loads in
      1.3 s, also under the app's Electron Node.
- [x] Download on first use (about 490 MB), with progress, into a `models` folder beside the data folder.
- [x] Mic button in the Ask and Explain it back inputs and the chat box. The words land in
      the field for you to fix before sending.
- [x] Mac app asks for the microphone. The app is signed ad hoc so macOS can tie the permission to it.

## Phase 10 — Staying with the book · M

For getting started again, tangents and drifting off. Nothing here calls the tutor unless
you ask.

- [x] **Park it:** save a question on a passage without asking it. Parked questions wait
      in a list until you send them.
- [x] **Where you left off:** on opening a book, the last paragraph you read and your
      latest highlights and notes in that chapter. A Recap button asks the tutor only if
      pressed.
- [x] **Spotlight:** dim all but the current paragraph and hide the top bar. EPUB first.
- [x] "3 cards due" when a book opens, one click to start.
- [x] Minutes left in the chapter, for EPUB.

## Phase 11 — Read-along · M

- [x] The browser's speech voices read the book aloud, highlighting each word, with a
      speed control. EPUB first.
      *How it works:* foliate's `tts.js` (through `view.initTTS`) splits the section into blocks
      and gives each one as SSML with a mark before every word. Web Speech can't speak SSML, so
      `components/reader/ssml.ts` turns a block into plain text plus a map from character offset
      to mark. Each word `boundary` event's `charIndex` finds its mark, `setMark` returns the word's
      Range, and the CSS Custom Highlight API paints it in the section's frame without touching the
      DOM. Only on-device voices (`voice.localService`) are offered, so no audio leaves the machine.
      The controls float at the foot of the book (header button or ⌘⇧S): play/pause, 0.75× to 2×,
      and a voice picker. The voice and speed are saved in settings. Reading starts at the paragraph
      in view, or the spotlight's paragraph, and turns the page when the word leaves the view. It
      carries on into the next section and stops at the book's end, on a jump to another chapter,
      and when the book closes. The spotlight follows the paragraph being read. Pause cancels the
      voice and play resumes at the last word, since a paused utterance is unreliable in Chromium.
      Checked with macOS voices in the Electron app (Electron 45) and in Google Chrome 158, both
      lighting each word. In Pages mode the page keeps a wider margin while the controls are open,
      so its last line stays clear of them. PDF is not covered yet.

## Phase 12 — Light and dark audit · S

Fix the theme before new UI lands on it. Colours are tokens in `app/globals.css`, so fix
at the token, not per component.

- [x] **Dark is grey, not black.** Retuned every dark surface to a neutral ramp with no
      hue: ink `#1e1e1e`, panel `#232323`, raised `#292929`, hover `#313131`, lines
      `#2f2f2f` and `#3e3e3e`. The old `#19191b`–`#323236` range was both darker and
      faintly blue, which read as a hole on a long page rather than a surface. Text
      follows: paper `#f2f2f2`, fog `#b9b9b9`, dim `#9e9e9e`, prose `#dcdcdc`. The window
      colour in `electron/main.cjs` moved with it, so nothing flashes on launch.
- [x] Screenshot every surface in both themes: library, reader (EPUB and PDF), chat,
      highlights, notes, cards, TOC, reading settings, tutor menu, and a book figure.
- [x] Check text and control contrast against the tokens, in both themes. `dim`, `page-dim`,
      light `warn` and `live` failed; retuned to pass 4.5:1 (3:1 for icons). Dark now
      passes with margin on every surface, including `panel-hover`, the worst case.
- [x] Replace hardcoded colours with tokens. Dialog and drawer backdrops read `scrim`
      (lighter in light). Book images sit on `--prose-image`: a light card on the dark
      page so black line art stays visible, nothing on the light page. Both selection
      washes, EPUB and PDF, read `select-soft`. Left alone on purpose: the generated
      cover tones in `BookList.tsx` (a book's colour, not a surface), the image viewer's
      black backdrop, and the white fill used when flattening covers to JPEG.
- [x] Make the app theme and the reading page theme (`data-reading-theme`) agree where
      they should, and differ only on purpose. On "Auto" the page follows the app; a
      chosen page theme carries every page token with it, image backing included.

Done when no surface has unreadable text or a leftover colour in either theme.

## Phase 13 — Long threads, and what they cost · M

The failure this prevents is already reachable: `lib/server/tutor/api.ts` sends the whole
thread on every request (`apiMessages`, `lib/server/tutor/api.ts:9`) and the only limit in
the file is `max_tokens: 64000` (`:33`). A long thread either overflows the window or
arrives as a bill you didn't see coming, and nothing in the UI says which.

- [x] Record token usage per turn, per thread, from whatever the provider reports. Never
      estimate in place of a real number; show "—" when the provider sent none. Each
      answer saves the provider's `usage`: Claude Code's `result` line (cost from
      `total_cost_usd`, marked plan-paid when `costBasis` is `list`), Codex's
      `turn.completed` (a running total per session, turned into per-answer deltas), and
      the API's final message (priced from the table in `api.ts`).
- [x] A quiet row under the composer: context used out of the model's window, and the
      session's estimated cost. Click for per-turn detail. (`UsageRow.tsx`)
- [x] **Compaction.** Past a threshold, replace the oldest turns with a summary and keep
      the rest. The full history stays on disk and stays readable — only what goes to the
      model is cut. Summaries keep the position, the open threads and the reader's own
      words, not just the gist. Past about 150K tokens sent, the same tutor writes a
      summary of all but the newest six messages, saved as `thread.compaction`; the
      passage always goes as written. A resumed CLI session sends only the newest message
      and compacts itself, so this applies to the API and to CLI threads with no session.
- [x] A line above the composer when the reader types while a turn is running: queued,
      not dropped, and sent when the current turn settles. One message waits at a time;
      if the answer before it fails it is held with Send now, and nothing newer goes
      ahead of it.

Done when a thread of 200 turns still answers, and the cost of asking is on screen.

## Phase 14 — Confidence and thinking · S

The cheapest real evidence about whether knowledge exists, and the thing that separates
"lucky" from "fragile" from "confidently wrong". learnharness puts a 0–100 rail on every
answer and a free-text thinking field on every instrument; `shared/25-confidence.md` there
is the argument, and it holds: *wrong + high confidence is the strongest signal you can
receive — a committed misconception.*

- [x] Every card rating and quiz answer stores two extra things: a confidence of 0–100,
      and what the reader was thinking when they answered. Both optional, never required.
      *Each rating now goes into the set's `history` (`ReviewRecord`: time, cue, rating,
      confidence or null, thinking or null), the newest 50 kept. Quizzes don't exist yet;
      Phase 17 asks the same two things with the same `StanceInput`.*
- [x] One step each: a rail, and one line of text. Skipping is a first-class answer.
      *Both sit under the question, before the answer shows, so the answer can't colour
      them. The rail starts at "Skipped" and has a Skip link once moved; Enter in the line
      shows the answer, and the rail leaves Space and 1–4 to the sheet.*
- [x] Retention (Phase 18) reads them: a card answered right at 30 % is not the same as one
      answered right at 100 %, and a card answered wrong at 100 % is worth resurfacing
      sooner.
      *Resurfacing is done: a cue last answered wrong while sure (70 % or more) is picked
      6 times as often as an untried one, against 4 for a plain Again. Retention (Phase 18,
      2026-11-25) counts a right answer given while close to guessing (under 40 %) at 0.6
      of its recall and a half-sure one at 0.85; a skipped rail costs nothing.*
- [x] Card generation (Phase 2's prompt) reads them: a cue that keeps drawing a confident
      wrong answer is a bad cue, not a bad reader.
      *Twice wrong while sure marks a cue in the Cards tab, with "Ask for a better card".
      The request lists that cue with its count and the reader's last thinking line, and
      `prompt.md` says to ask for the fact from a side where that wrong answer can't come
      up.*

Labels (`lib/shared/confidence.ts`): right at 70 % or more is **held**, 40–69 **unsure**,
under 40 a **lucky guess**; wrong at 70 % or more is **confidently wrong**, under 70 a
**known gap**. The end of a review session counts each and lists the lucky and the
confidently wrong questions; each card in the Cards tab shows its last label.

Tried **2026-11-25** with Claude Code on Sonnet 5.5, on *Continuous Discovery Habits*,
against scratch data. A seeded card with two confident wrong answers showed the flag. In
review, that cue came up, the rail at 85 % and a thinking line went in before the answer,
Good saved both into `history`, and the end screen read "1 held". "Ask for a better card"
came back with one new card asking which group decided what to build, set against the
project manager the reader had confused it with.

Done when a review session can tell a lucky guess from a held fact in one glance.

## Phase 15 — Citations in chat · S

A tutor answer that rests on a passage should be able to point at it, and a reader should
be able to hand the tutor a quote without retyping it.

- [x] Quote a highlight into the composer as one atomic chip, not pasted text that can be
      half-deleted. The anchor travels with it (`Anchor`, `lib/shared/types.ts:18`), so the
      tutor sees the passage, not a copy of it. "Quote" sits on the highlight menu in the
      book and on each row of the Highlights tab. Chips wait above the words, up to 5 a
      message; × or Backspace at the start of the box takes one away whole. The message
      stores them as `quotes` (`QuotedPassage`), shown on the sent message as numbered
      chips that lead back to the passage.
- [x] Every claim the tutor makes from a quoted passage carries a link back to it. Hit the
      link, land on the paragraph. Passages are numbered across the thread and reach the
      tutor as `<passage n="2">`; the prompt asks it to link the words that rest on one to
      `#cite-2`. The link renders as dotted words with a superscript number, and the
      passages an answer cites are listed under it. A number the thread has no passage for
      stays plain words. After a summary, folded turns' passages go with the summary, so
      numbers never move.
- [x] Citations survive the thread being reread later; they resolve from the anchor, so a
      moved or re-imported book either finds the passage or says it can't. Each reader's
      `findPassage` goes to the anchor and compares the text there with the quoted text
      (letters and digits only, so spacing and hyphenation don't matter). An anchor that
      doesn't resolve, or lands on other text, gets a toast and a "Not found" mark, with
      the quoted text still showing.
- [x] "Save to notes" on a citation, matching Phase 22. Each cited passage under an answer
      has the button; it adds a note on that passage through `annotations.addNote`, quoting
      what the tutor said rests on it.

Tried **2026-11-24** with Claude Code on two test books. On a one-screen EPUB, two
highlights quoted into one question got an answer that linked one claim to each passage,
and Save to notes wrote the note under its passage in the notes folder. After a reload both
links still resolved as found. With one quote's stored text changed to stand in for another
edition, that link said it couldn't find the passage and the other still found its own. On
a four-page PDF, with a hand-written cited thread on a highlight from page 3, the link
jumped from page 1 to the highlighted line and read as found, even though the line wraps
mid-word; with its text changed it said it couldn't find it. The run caught one bug: the
EPUB range comes from the book's frame, so `instanceof Range` was false and every passage
read as missing.

Done when no answer needs the phrase "as you can see above".

## Phase 16 — Courses and the roadmap chat · L

Start from home: say what you want to learn and get a plan.

- [x] A `Course`: name, goal, level, weekly time, ordered units. Each unit lists concepts
      and the books or chapters that cover them.
      *`lib/shared/courses.ts`. Courses span books, so they live in `DATA_DIR/courses.json`
      with the planning chats, not in any book's state. A chapter of a library book is
      stored under that book's own table-of-contents label, the one the reader reports, so
      Phase 17 can key quizzes on it. A chapter the tutor named that the book's contents
      don't have is kept, marked "not found in your copy".*
- [x] Home chat: the tutor asks about level, goal and time per week, then returns a
      structured roadmap (units, ordered book list with the chapters that matter, rough
      timeline). Edit it in the same chat, then approve to create the Course.
      *A box at the top of home opens `/plan` with what was typed. The tutor sees every
      library book by id, title and author, and the chapter lists of up to 12 books most
      like what the reader has said (all of them in a small library). It ends a roadmap
      answer with a fenced `roadmap` JSON block; a block that doesn't parse goes back once
      with the reason, like card JSON. Approving the latest roadmap creates the Course;
      approving again after more edits updates the same Course.*
- [x] Match each listed book against the library. Present ones link to the reader;
      missing ones show as "to find" with title, author and edition.
      *By the id the tutor was given, else by title (letter pairs, subtitle ignored, 0.85 or
      more). Chapters match exactly, then by prefix, then by closest name (0.75 or more).
      The lookup links in "Open: where the books come from" are not added; that section is
      still to discuss.*
- [x] Course page: units, books and progress.
      *`/course/[id]`: each unit's concepts and chapters, every book with how far it has
      been read, and books started out of those in the library. Progress by chapter comes
      with Phase 17's quizzes. "Change the plan" goes back to the chat; "Remove course"
      deletes only the Course.*

Tried **2026-11-25** with Claude Code on Sonnet 5.5, on scratch copies of four books. A
single message giving the level, goal and weekly time got a six-unit roadmap in the first
answer, from *Continuous Discovery Habits* and *The Mom Test*, and every one of its 33
chapters matched the books' own labels. Asking to add *Inspired* as a short last unit came
back as a whole new roadmap with a seventh unit of its nine discovery chapters, all found.
Approving it opened the Course page, and home listed the Course. A seeded Course with a
book not in the library showed it as "To find" with author and edition, and removing it
worked. The run caught two bugs: Chrome's `scrollIntoView` now returns a promise, which
the chat's effect handed back to React, and the reader's message was saved before the
library was read, so a failure there left an unanswered message.

## Phase 17 — Chapter quizzes · M

- [x] A short quiz (5–8 questions, recall and "explain why") at the end of each chapter of
      a book in a Course. Passing it marks the chapter done and unlocks the next one.
      Since Phase 29 every chapter of every book gets one, and only a Course's are gated.
      *`lib/shared/quiz.ts`. A quiz belongs to a chapter of a book, keyed by its contents
      label, and lives in the book's state, so two Courses reading the same chapter share
      it. Passing needs 80 % (4 of 5 up to 7 of 8), since Phase 29 of everything the test
      asked, earlier chapters' questions included. Answers are self-graded after the answer
      is shown, like card reviews. That was the rule for all free text until 2026-11-26, when
      grading it was approved (Phases 27 and 28); since Phase 29 one question in each test is
      answered in writing and graded. Each answer also asks "how sure" and "your answer, in a line" with Phase 14's
      `StanceInput`. "Unlocks" is advice, not a wall: the book always opens, a chapter whose
      step comes before is shown as locked on the Course page, and the book says once "in
      this Course, this comes after …". The order runs across books, in the order the units
      read them.*
- [x] Questions are written when the chapter is finished reading, in one batch, and stored.
      *Moving from inside a Course chapter (its entry or anything nested under it) to a later
      contents entry starts writing its quiz in the background, from the chapter's own
      extracted text (numbered blocks, thinned evenly past about 60k characters). Each
      question carries the real start of the block the tutor cited. A reply that can't be
      read goes back once with the reason. The book shows "Finished …, its quiz is being
      written", then "Take quiz". A written quiz is never replaced.*
- [x] Retake without limit. A missed question shows its answer and where in the chapter.
      Since Phase 29 it is also asked once more before the test ends, and again the next day.
      *The result lists each missed question with its answer and a link to its place;
      Phase 14's signal summary ("1 held", "1 misconception") sits above it.*
- [x] Books outside a Course are never gated.
      *They got no quizzes, notices or locks at all until Phase 29. Now they get the quiz and
      its notice, and still no lock: the 80 % mark is shown and decides nothing.*
- [x] Results feed retention (Phase 18).
      *Every attempt keeps each answer with right or wrong, confidence and thinking, ready
      for Phase 18 to read.*

Tried **2026-11-25** with Claude Code on Sonnet 5.5, on the scratch Course from Phase 16.
Opening *Continuous Discovery Habits* at Chapter One showed "this comes after
Introduction", which also proved the reader's contents label is the one the Course stored.
Moving to Chapter Two started the quiz on its own; it came back in under a minute with
eight questions, three of them "why", each tied to the right passage. Six of eight right
said "Not passed yet" and listed the two misses with their places; a retake at eight of
eight passed, and the Course page then read "1 of 42 chapters passed", Chapter One
passed, Chapter Two open, Chapter Three locked. `?quiz=` from the Course page opens the
sheet, and a chapter with no quiz yet says so and offers to write it instead of waiting.
Not checked live: a PDF book in a Course (its extracted chapter labels look right), and a
quiz failing to write. Left as is: a Course listing both a chapter and a section nested in
it (as with *The Mom Test*) gets overlapping quizzes, since the parent's quiz covers its
sections too. Phase 29 adds no overlap of its own, and leaves this one: writing the parent's
quiz from the text outside its sections fails when the sections hold all of its text, and a
Course chapter with no quiz can't be passed.

## Phase 18 — Mastery and daily learning · M

- [x] **Coverage:** how much of the Course you've read and passed.
      *Chapters whose quiz is passed, out of the Course's chapters the library has. Reading
      position is left out on purpose: scrolling to the end would raise it, and mastery is
      read from evidence.*
- [x] **Retention:** predicted recall over the Course's cards and quiz questions, from the
      FSRS data already stored, weighted by the confidence recorded in Phase 14. Falls when
      you stop reviewing.
      *`lib/shared/mastery.ts`, computed when a page asks and never stored. Each rated card
      set's recall now comes from FSRS's forgetting curve with the scheduler's own
      parameters (`recallAt`); sets never rated don't count. Quiz questions keep no
      schedule, so each one's answers are replayed as ratings (right as Good, wrong as
      Again) to get one (`replaySchedule`), and they fade like cards. A right answer close
      to a guess counts 0.6, a half-sure one 0.85. Cards count when made in a chapter the
      Course reads, or in a section of one: quizzes now keep their chapter's nested labels
      for that. With nothing rated yet it says "nothing to retain yet", not 0 %.*
- [x] Show both per Course ("62 % covered · 78 % retained"), never one blended score.
      *On each Course card at home and at the top of the Course page.*
- [x] **Learning time:** minutes spent reading, reviewing and quizzing each day, and
      whether you learned today. Needs reading time recorded, which isn't kept today.
      *The book page counts seconds while it is visible and used in the last two minutes,
      as reading, review or quiz by what is open, and posts them to `/api/activity` every
      30 seconds and when hidden or left (`fetch` with `keepalive`, which keeps the Origin
      header). A move in the book counts as use, since an EPUB page's clicks happen in its
      frame. The server takes at most 120 seconds a report and 16 hours a book a day, and
      files them under the study day (4 a.m. cutoff) in `DATA_DIR/activity.json`, by book
      and kind, kept for good for Phase 19. Any time at all counts as learned.*
- [x] A week view: days learned, minutes per day, per Course.
      *Home shows the last seven days over every book; each Course page shows them over
      its own books, and each Course card its minutes this week. A book in two Courses
      counts in both Courses but once in the day's total.*

Tried **2026-11-25** on the scratch data, with a week of activity seeded. Home read
"2 % covered · 100 % retained" for the Course (one chapter of 42 passed, everything
answered within the hour) and "learned 6 of 7 days · 159 min"; the Course's own week
left out the half hour spent on a paper that isn't in it. About 41 seconds on *The Mom
Test* recorded 39 seconds of reading, through one 30-second report and the flush on
leaving, both answered 204. A report of 99,999 seconds stored 120; a bad kind or book id
was refused. Not checked live: the two-minute idle cutoff, and review and quiz time
(the kind switches with what's open; the unit tests cover the store). Retention falling
over time is covered by unit tests with a moved clock, since the live data is an hour old.

## Phase 19 — Today and streaks · M

- [x] Home "Today" card: cards due, the next chapter quiz, minutes left in the current
      book, one button that starts it.
      *`lib/server/today.ts`, at the top of home. Cards due across every book; the first
      Course chapter, in Course order, whose quiz is written and not passed; the book read
      last with its minutes left (from its indexed words at 230 a minute, left out until
      the book is indexed). The button starts the most useful one: "Review N cards" in the
      book holding the most (`?review=1` opens the review at once), else "Take the quiz"
      (`?quiz=`), else "Keep reading". The chapters drawer now steps aside while a review
      or quiz is open.*
- [x] Daily minimum (one review session or 15 minutes). Meeting it keeps the streak.
      *`lib/shared/streak.ts`. 15 minutes of reading, reviewing and quizzing together from
      Phase 18's log, or a review session: five card ratings that day (or every card, in a
      library with fewer than five, counting the cards it had that day), or a chapter quiz
      taken. Ratings and attempts are read from their own timestamps, so nothing new is
      logged.*
- [x] Streak freeze and a rest-day token, so one missed day doesn't erase weeks.
      *One rest day a week (weeks start Monday) covers the first miss automatically; a
      freeze, earned every seven days met in a row and banked up to two, covers the next.
      Covered days keep the streak without adding to it; today never breaks it while open;
      misses with no streak running spend nothing. All of it is recomputed from the days
      met each time (`streakOf`, a pure function with edge-case tests); no streak is
      stored. Making more cards later never un-meets a past day. Left: a day met only by
      ratings, with under 15 minutes logged, can drop out if its card set is deleted or
      the set's history passes 50 ratings, since history is where ratings are kept.
      Logging a day's rating count in the activity file would close that.*

Tried **2026-11-25** on the scratch data with Phase 18's seeded week. Today read "7 days
streak · 1 freeze · rest day available" with the minimum met: every day of the week met
it, two of them only through a single rating, since the scratch library has one card set.
With that set made due, the button read "Review 1 card" and opened the book straight into
the review; closing it dropped `?review=1` from the address. With a written, unpassed quiz
for Chapter Two it read "Take the quiz"; with neither, "Keep reading" and about 245
minutes left. The final review caught past days being judged by today's deck size, so
making cards could have broken a streak; each day now counts the deck it had. Not checked live: a broken streak, rest and freeze days spent (the unit
tests walk those), and a library whose current book isn't indexed yet.

## Phase 20 — Find it again · M

Search is the biggest real gap: everything the app knows is reachable only by scrolling to it.
Cheap first layer, and the expensive one only if the cheap one fails on real queries. Precedent
for the chunking: `anything`'s segment-aware chunker, which keeps every chunk pointed at a place
in the book. Reference, not code — that repo is GPL-3.0.

- [x] **BM25 over the whole library, before any embeddings.** Book text, highlights, notes and
      cards in one index. No model, no download, no network. It answers exact terms and names,
      which is most of what you search for in your own books. `lib/shared/search.ts` scores
      every source at once, so a term's rarity is judged across the library and a note ranks
      on the same scale as book text. Case and accents fold, and words are lightly stemmed (see
      below). The last word, while it is still being typed, also matches as a prefix. Highlights, notes and cards are read
      from each book's state at query time (cached by the state file's mtime), not stored in
      the index, because they change with every edit.
- [x] **Chunk on the anchors we already have**, not on fixed windows: EPUB CFI
      (`lib/shared/cfi.ts`), PDF page plus character range
      (`Anchor` in `lib/shared/types.ts:18`). A result that can't jump to its place is a
      truncated quote. Target ~300 tokens, 20 % overlap, as a starting point.
      `lib/server/search/book-text.ts` reads EPUB blocks (paragraphs, headings, list items)
      and gives each the CFI foliate itself would make: the spine step from the package
      document and the path in the section, built by foliate's own `epubcfi.js` on an XML
      parse (`@xmldom/xmldom`). A jsdom test resolves every one back to its block with
      foliate's `toRange`, with and without bold starts. PDF blocks are lines, each with its
      character range in `pageText`. Chunks are ~300 terms of whole blocks, never cross a
      section or page, and repeat up to 20 % of the previous chunk. A result jumps to the
      block in its chunk with the most of the query, not to the chunk's start.
- [x] **Derived, never authored.** The index lives in `DATA_DIR`, keyed by book id, and rebuilt
      from the book file when its fingerprint changes (`size`, `mtimeMs`, `ino`, `sha256` are
      already tracked by the library index in `docs/plans/stable-book-ids.md`). Deleting it costs
      a rebuild and nothing else. `DATA_DIR/search/<id>.json`, fingerprinted by `size` and
      `mtimeMs` plus a format version (not `sha256`, which stays null until the background
      hash runs). One background builder per data folder reads stale books one at a time, so
      the first search answers at once from saved notes and says how many books are still
      being read. Indexes of books the library no longer knows are deleted on the next run.
- [x] **One box, opened by a key, over everything.** Results grouped by book then chapter, each
      line showing the matching words in place, Enter jumps to the anchor and closes the panel.
      ⌘K on the library and in a book, also a Search button in both headers
      (`components/search`). A result in another book opens it at `?at=<anchor>`; the jump
      waits for the reader's first place, so the saved place doesn't land over it. A PDF jump
      now reads an undrawn page's text first, so it lands on the line, not the page top.
- [x] **Vectors only behind a gate.** First measure the BM25 misses: 20 real queries with the
      passage you wanted each to find. Add embeddings only for the ones keyword search can't
      reach. Local model in the same shape as the speech model (Phase 9): downloaded once,
      listed in a `models` folder, no key needed.
      *Measured 2026-11-24, no embeddings added:* **3 of 20 missed** (top 5, and the same at top
      10), 0 passages unfound. The 20 passages were picked at random, one each from 20 of the 59
      books in the real library (a copy of the data folder). Claude wrote the queries from the gist
      of each passage, so they lean on the passage's own words more than yours would; a real miss
      rate is likely higher. The misses: "objection turned into a question" (the text says
      *concern* and *query*: a vocabulary gap, the one only vectors fix); "life is only suffering"
      (exact words, but common ones, ranked #48: a phrase or proximity boost would fix it);
      "reader bored stops reading copy" (#26: *reader*/*reading*, *stops*/*stop*: stemming would
      fix it). Rerun with `node scripts/search-misses.mjs <queries.json> --data <DATA_DIR>`.
- [ ] ~~If vectors land: hybrid = BM25 + vector, merged by reciprocal rank fusion, which needs no
      reranker. Say the *similarity*, higher is better, and test that ordering on five queries
      before shipping. `anything` stores sqlite-vec's distance (lower is better) and then filters
      `>= 0.3` and sorts descending, so it keeps its worst matches (`rag/search.ts:115`).~~
      *Not needed:* the gate measured 3 of 20 misses, and only one is a vocabulary gap, the one
      kind only vectors fix. No vectors land.
- [ ] ~~Wire the vector path at startup and prove it runs. `anything` exports a
      `configureSearch()` that nothing ever calls, so its "semantic search" silently falls back
      to BM25 on every query. Same trap: a test that catches the fallback, not just the result.~~
      *Not needed:* no vector path (same reason).
- [ ] ~~One copy of the vectors. A chunk's embedding goes in one place, not in the book's data and
      a side database both.~~ *Not needed:* no vectors (same reason).
- [x] **Phrase boost.** BM25 ignores word order, so the 300 best BM25 documents are re-read and
      scored up to twice as high for their highest-idf run of query words held adjacent and in
      order (the run's summed idf over the whole query's), so a run of common words lifts little.
      The result lands on the part holding that run (`lib/shared/search.ts`). *Measured 2026-11-25, same 20 queries and data copy:* "life is
      only suffering" #48 → **#1**.
- [x] **Light stemming.** A small suffix-stripping stemmer (plurals, -ing, -ed; no -er or final
      e, no dependency; consonant-y becomes -ie so *story*/*stories* and *movie*/*movies* both
      meet; *does*/*goes* map to *do*/*go*) runs in `tokenize`, on the book's text and the query
      alike, so *stops*/*stop* and *reading*/*reads*/*read* meet. Marks still highlight the book's
      own words. The word being typed matches as a prefix, and when it isn't a term yet, also the
      stems it could still become ("stopp" finds *stop*), while a word that is a term stays
      itself ("care" doesn't reach *car*). The
      saved indexes hold raw text and terms are built at load, so no format bump or rebuild.
      *Measured 2026-11-25:* "reader bored stops reading copy" #26 → **#50**, still a miss. The
      roadmap's diagnosis was wrong: by score the passage was already #2 before stemming (#3
      after); it ranks low only because results are grouped by book, and two other copywriting
      books' hits (all of them) show first. Totals: **2 of 20 missed** (was 3); the 17 earlier
      hits all stay in the top 5.
- [ ] Display order: a book's group shows every hit before the next book, so one book with many
      good hits buries a better passage elsewhere (the miss above). Cap each book's hits in the
      grouped list, or order groups by more than their single best hit.

Done when a phrase you half-remember from any book, note or highlight is two keystrokes away and
lands on the exact paragraph.

## Phase 21 — Diagrams, math and code in chat · S

The tutor gets text formats it can write well. Highest value for the effort, so it goes
first of this group. `components/chat/Markdown.tsx` and `lib/server/tutor/prompt.ts`.

- [x] Render Mermaid fences (flowchart, sequence, state, mind map, timeline) as SVG in
      chat, in strict mode. Mermaid loads only when an answer has a diagram
      (`components/chat/mermaid.ts`), takes the app's theme colours, and draws at its own
      size: a wide diagram scrolls rather than shrinking its labels out of reach.
- [x] The prompt says when a diagram is worth it, to lay flowcharts top to bottom for the
      narrow chat, and to quote labels with punctuation. No raw SVG from the model.
- [x] A Mermaid block that doesn't parse goes back once with the error, like bad card
      JSON. If it still fails, show the source as code. Mermaid needs a DOM, so the browser
      parses a finished answer and posts the broken blocks to
      `/api/books/[bookId]/diagrams`, which asks the tutor on a session of its own and
      saves the fix; `diagramsRepaired` on the answer keeps it to once.
- [x] KaTeX math and syntax-highlighted code blocks in the same renderer. Math only
      between double dollars, so "$5 or $10" stays text. Code is highlighted only when its
      fence names a language.
- [x] "Save to notes" on a diagram drops the Mermaid block into a note on the thread's
      passage. Obsidian renders it there. Threads with no passage have no button.

Check on 20 real questions first: how often the first Mermaid parses, and whether the
tutor draws only when it helps. **Done 2026-11-24** on *Inspired* with Claude Code on
Sonnet 5.5, asking 20 reader questions each in a new thread. 5 answers drew a diagram,
all `flowchart TD`, and all 5 parsed the first time in Mermaid 12.2.0, so no repair was
needed. All 5 were questions about a process or flow. Definitions, comparisons and lists
got none. Sample is small: 5 of 5 shows the first try usually works, not that repair is
never needed. An earlier deliberately broken diagram came back fixed in 3.4 s.

## Phase 22 — Notes editor · M

Replace the textarea with a live-preview Markdown editor (CodeMirror 6): formatting shows
inline, raw syntax shows on the line being edited. Not a clone of Obsidian.

- [x] Standalone notes are real `.md` files in the notes folder. The app edits them in
      place and picks up changes made in Obsidian.
      *Notes page at `/notes` (linked from the library). It lists every `.md` in the
      folder and its subfolders, skipping hidden folders such as `.obsidian` and `.trash`.
      An open note checks the disk every 2.5 s while the window is in front, and on focus.
      An outside change shows up at once unless there is unsaved text.*
- [x] The app never overwrites a file that changed on disk since it loaded it. On a
      conflict it keeps both.
      *A save carries the SHA-256 of the bytes it was based on. The server re-reads the
      file inside the file's queue. If the file changed or was deleted, the file is left
      alone and the app's text goes to `Note (conflict 2026-11-24 14.32).md` beside it. The
      editor then shows the disk version, with a banner linking to the copy. New notes and
      copies are created with an exclusive open, so they never replace a file.
      `lib/server/notes-folder.ts` holds this, kept generic for Phase 23's `.excalidraw`
      files. Tests: `tests/notes-files.test.ts` (server) and `tests/note-session.test.ts`
      (editor side).*
- [x] Notes on a highlight stay in the app's data and keep mirroring to the vault. That
      per-book file stays app-owned, with a "generated, don't edit" header.
      *The header is an Obsidian callout under the frontmatter, so it shows in reading view.
      The notes page lists these files apart and refuses to edit them. A link to one opens
      the book. The side panel's note editor is the same CodeMirror editor, compact.*
- [x] `[[wikilinks]]`, a backlinks list, `/` commands, `#tags`, checklists, pasted images.
      *Links resolve as Obsidian does: same folder first, then the shortest path. Clicking a
      link to a missing note creates it. Pasted or dropped images go where
      `.obsidian/app.json` `attachmentFolderPath` says, otherwise `attachments/`. They are
      linked `![[Pasted image …]]`, or as a Markdown link when `useMarkdownLinks` is on.
      Not done: renaming or deleting notes, and updating links when a note is renamed.*
- [x] Highlight quotes embed by block id. Code blocks with highlighting, KaTeX math.
      *`![[Book#^h-1a2b3c4d]]` shows the quote, read from the book's file, with a link that
      opens the book. "/Embed a highlight" lists every highlight. Headings and other
      `^block` ids embed too. Code uses the chat's `.hljs-*` classes through a CodeMirror
      highlight style. Math is `$$…$$` only, as in chat, drawn by KaTeX.*

## Phase 23 — Whiteboard · L

A free whiteboard per chapter that you and the tutor both draw on. Excalidraw (MIT);
tldraw is out because its SDK needs a production licence.

- [x] One `.excalidraw` file per chapter, in the notes folder so Obsidian's Excalidraw
      plugin opens it.
      *`Whiteboards/<Book>/<Chapter>.excalidraw`, through `lib/server/notes-folder.ts`: created
      with an exclusive open, saved only over the version it opened, and a conflict goes to
      a copy beside it. The chapter is the Course's chapter when a Course reads the book,
      else the top-level contents entry. The board saves itself a moment after each change
      and as it closes. `lib/server/boards.ts`, `components/board/`.*
- [x] Review with the tutor: send the scene as compact JSON (text, positions, arrow
      connections) plus a PNG. The tutor reports missing concepts, wrong links and one
      "why does A lead to B?" question.
      *The scene is ideas (shapes and free text) and links (arrows bound at both ends), with
      short ids; loose arrows and sketches are only counted. The tutor also gets the
      chapter's text. Its additions come back as suggestions, and its question can be
      answered in the chat.*
- [x] **Draw it back:** a blank board, the book closed. The tutor points at the first
      wrong link and gives no grade.
      *The tutor panel folds away while it runs. The wrong link is selected on the canvas
      with a hint toward the passage; the drawing is never saved over the board.*
- [x] The tutor edits the board by returning JSON operations (add, update, delete),
      validated by the app. Bad JSON goes back once with the error.
      *Ops are `add_node`, `add_link`, `update` and `delete`, at most 60, checked against the
      ids sent. Changes are asked for in the chat, not in a second box on the board: the
      open board rides along as a chip on the message, the tutor answers in words and puts
      its ops in a `board` fence, and they land on that board as suggestions once the
      answer finishes, read against the board as it was sent. The chat only says where
      they went.*
- [x] **Agent edits are suggestions:** shown in their own colour, accepted or rejected one
      by one, so the tutor never overwrites your drawing. Undo covers the rest.
      *Suggestions are violet and locked (new shapes and links also dashed; a reworded label
      shows as violet text), and carry what they would do on the
      elements themselves, so undo and redo keep the list right. Keeping a link keeps the
      new ideas it joins; dropping an idea drops its links. They are never saved until kept.*
- [x] Mermaid from chat converts to an editable board.
      *Every chat diagram carries an "Open as whiteboard" bar. It opens as a new board of the
      reader's own, in the board pane with the chat beside it, as an artifact opens. The same
      diagram opens the same board. Flowcharts become shapes and bound arrows; other kinds
      come in as one picture. Asked to draw, the tutor names its diagram in a `%%` first line,
      which titles the board.*
- [x] **Many boards per book, in their own pane.** The board pane opens between the book
      and the chat, so all three show at once, and moves to the book's other side with one
      button; it can also hide the book and take its room.
      It lists the book's boards (the chapter's own, new ones by title, and ones from the
      chat) and draws the open one. The tutor's review, edits and Draw it back sit in a rail
      that opens on demand, or by itself when it has something to show.
      *Each board is its own file, `Whiteboards/<Book>/<Title>.excalidraw`. The book's state
      lists them by id; a board saved before keeps its file and becomes its chapter's board.
      Renaming keeps the file's name, and removing a board leaves its file in the notes.
      Draw it back stays on chapter boards, so only they count toward retention. To have
      the tutor draw a new board, ask in the chat. Labels measured before Excalidraw's hand
      font loaded are measured again when a board opens, so none draw clipped.*
- [x] **One board per topic, not one per diagram.** A chat diagram goes on the board that is
      open, or else the board whose title it shares words with, and only otherwise on a board
      of its own ("New board" is always offered). On an existing board a flowchart adds only
      what is new, as suggestions: ideas already drawn are reused by their words, so a diagram
      that corrects or grows the board adds the missing ideas and links and rewords links. A
      kind Excalidraw opens as one picture goes on the board as it is. With a
      board attached, the tutor draws, expands and corrects on that board through ops (now
      up to 60) instead of drawing a separate diagram.
      *Suggestions left undecided when a board closes come back when it reopens in the same
      visit, and which answers' changes went on a board is remembered in the browser (the last
      300 of them), so a reload doesn't offer them twice. Suggested ideas are sized to their words.*
- [x] **Panes that hold up.** The board opens even when the window has no room for the book,
      the board and the chat together, by taking the book's place. The chat folds away with
      the board on either side, and a layout saved with a board open no longer comes back as
      an empty pane. In a narrow pane, Excalidraw's tool bar wraps instead of hanging off
      both edges. Leaving a board saves it first, however it is left; one whose save fails
      stays open with the drawing until it saves or the reader leaves without saving.
- [x] **One design system.** `components/ui` holds the primitives every surface uses:
      `Field`, `TextArea`, `Surface`, `PaneHeader` and `Divider` beside `Button`. Edges are
      hairlines (`line`, `line-strong`); only floating surfaces get elevation. Excalidraw's
      chrome and canvas take the app's tokens, so the board reads as part of the pane.
- [x] Results feed retention (Phase 18).
      *Each Draw it back check is an attempt, right when no link was wrong. A Course chapter
      with a board gains a recall item scheduled from those attempts, like a quiz.*

## Phase 24 — Coding tasks · L

Books use different languages, so the app writes no scaffolds or tests. T3 Code's agent
sets up the project. The design work is making that agent teach, not write the code for
you.

- [ ] **Code it** on a selected code listing creates
      `code-deyalla/learn/<book>/<nn-topic>/`, with `git init` at the book level.
- [ ] `TASK.md`: book, chapter, the code listing, a goal, what "done" means.
- [ ] `AGENTS.md` and `CLAUDE.md`: set up the environment, hints before answers, never
      write the full solution until asked. T3 Code threads read them on their own.
- [ ] Open the folder in T3 Code and copy a one-line start prompt ("Read TASK.md, set up
      the project, and start").
- [ ] **Spike first (5 minutes):** `open -a "T3 Code (Beta)" <folder>`. T3 Code registers
      `t3code://` but only `pair` and `app` routes were found, so one-click open and start
      is unproven. Fallback: open the app, copy the prompt, reveal the folder, add it as a
      project once.
- [ ] "Mark done" in the app plus an optional reflection note saved to the notes. It
      counts as evidence for mastery (Phase 18). No hint counters.

## Phase 25 — Theme files · S

Moved out of Phase 12: the audit's done-when needed none of it, and it's a feature.

- [ ] **One JSON per theme, the way learnharness does them:** `name`, `mode`
      (`dark` or `light`, which drives `color-scheme`, the native window and the reading
      page), and the token values. Export the active theme, import one back, and let a
      single colour be overridden without forking the palette. That turns "is the light
      theme right?" into a file you can edit and diff, instead of a hunt through
      components. Their `docs/themes.md` is the reference; the code is AGPL, so this is a
      format to copy, not source.

## Phase 26 — Tools for outside agents · L

The app is the reader, the tools and the record. Claude Code and Codex are the agent: the app
builds no agent loop of its own. Every capability becomes a typed tool an outside agent calls,
and anything that would change the reader's content arrives as a suggestion they accept, the way
whiteboard edits do. This phase is the foundation; playbooks and scheduled runs build on it.

- [x] **One tool registry** in `lib/server/tools/`: a name, a description, input fields and a
      typed function per tool. The fields are checked at this boundary, and they are also the
      schema an agent reads, so the two can't drift.
      *Read: library, book text by chapter or place, search, highlights and notes, tutor
      threads, review queue, Today, Courses, boards. Write: park a question, log learning time.
      The activity and parked-question routes call the same functions.*
- [x] **Writes are safe across processes.** An agent's server is a second process, and the
      store's queue only ordered writes inside one.
      *A lock file beside each data file, held from read to write, with the queue kept in front
      of it. A lock whose owner died is taken over. `tests/file-lock.test.ts` runs three
      writers in separate processes and loses none of 120 updates; without the lock it kept 41.*
- [x] **A log of every tool call**, append-only, in `data/tool-log.jsonl`: time, tool, caller,
      a short form of the arguments, outcome.
- [x] **An MCP server on stdio** (`npm run mcp`) that runs with the app closed, and
      `npm run mcp:setup` to register it with Claude Code and Codex.
      *Hand-written, about a hundred lines: the server needs four methods, and the protocol's
      SDK would bring a schema library and an HTTP stack with it.*
- [x] **Suggestions inbox.** A proposed change has a kind, a target, a payload, a proposer, a
      time and a status. One kind is wired end to end: a review card for a passage, shown on
      Today with Add and Reject, stored on accept through the code the Cards button uses.
      *Whiteboard suggestions stay on the board; the model has room for them as a second kind.*
- [ ] Move whiteboard suggestions into the inbox, so one place shows everything waiting.
- [ ] More kinds: a note, a highlight, a quiz question, a Course change.
- [ ] A relinked or forgotten book refuses a waiting write only inside one process. Make the
      agent's server see it too.
- [ ] Ship the server inside the Mac app, so it needs no checkout of this repo.

No web search or fetch tool: the agents have their own. No tool that asks a model, until
Phase 27 added two that check and grade and change nothing.

Done when the type check and tests pass, a real `claude -p` and a real `codex exec` each list
the tools and answer a question that needs search and the review queue with the app closed, and
a card proposed through the server shows on Today and is created on accept.

## Phase 27 — Checked questions and graded answers · M

In 393 real complaints about learning tools, the largest trust problem was AI-written questions
with wrong answers. So a question is checked against its passage before the reader can meet it,
and free-text answers can be graded by a call that is not the tutor.

- [x] **`verifyItem`** in `lib/server/check/verify.ts`: given a question, its stored answer and
      the passage, a fresh call answers from the passage alone, without the stored answer; a
      second call says whether the two answers match and whether the passage backs the stored
      one. Returns answerable, matches, supported and a one-line reason.
      *The first call must quote the stretch of the passage its answer rests on, and the quote
      is looked up in the passage word for word, so an answer from general knowledge fails. A
      question the passage can't answer stops after one call. Replies are validated and sent
      back once with the reason, through `structured` in `lib/server/tutor/structured.ts`,
      which the quiz and card generators now share.*
- [x] **Quiz questions are checked before they are saved**, in the background job that writes
      the quiz. A question that fails is dropped and asked for again once.
      *Each is checked against the block it cites and the block either side. At most 12
      questions are checked per quiz (8 written, 4 replacements), two calls each, four at a
      time. Fewer than 3 passing saves nothing and the job reports "Only 2 of the 9 questions
      … held up", with the first reason; 3 or 4 passing saves a short quiz. A check that
      couldn't run counts as a fail. A quiz can now be shorter than 5 and can lack a "why",
      and at 3 or 4 questions the 80 % pass mark rounds up to all of them.*
- [x] **Cards are checked before they are stored.** A card that fails is dropped; if none
      pass, nothing is added and the reader is told why.
      *This runs on the Cards click, which already waited on the tutor. The one real run took
      25 s for writing and checking one card; how much of that is the check wasn't measured
      apart. No second try.*
- [x] **`verifiedAt`** on each saved question and card. Older ones have none and load as
      before. A card the reader rewrites loses it.
- [x] **`gradeAnswer`** in `lib/server/check/grade.ts`: a score from 0 to 1, a verdict (right,
      partly, wrong), a confidence, the first gap with the stretch of the passage that shows
      it, and `unsure`.
      *Two calls. The first writes the rubric, one to four points, from the passage and the
      expected answer, and never sees the reader's answer, so the answer can't bend what
      counts as right. The second marks each point yes, partly or no. A caller that kept the
      rubric passes it back and only the second runs. The score and the verdict are computed
      from the marks, not asked for: right at 0.85 or more, wrong only at 0, anything between
      is "partly" and always `unsure`, as is any grade with confidence under 0.7. The gap's
      note is about the answer, never the reader.*
- [x] **Two tools**, `verify_item` and `grade_answer`, each in its own file in
      `lib/server/tools/`, listed by the MCP server and written to the tool log like the rest.
      *Both only read. They run on the tutor the reader chose in the app, or the first one
      that is ready.*
- [x] **A fixed evaluation set** in `tests/eval/`: 16 questions for checking, half of them
      broken on purpose, and 24 answers for grading. `node scripts/check-eval/run.mjs <model>`
      runs the real model over it; it is not part of `npm test`.
- [x] **The cheapest model that passes.** Checks run on Haiku 5.5 through Claude Code and the
      API, not on the tutor's model.
      *Haiku 16/16 on checking and 21/24 then 23/24 on grading; Sonnet 16/16 and 22/24; no
      confident right-for-wrong on either. About $0.0003 a check on Haiku against $0.004 on
      Sonnet at list price, and 6 to 7 s. Every miss is in `scripts/check-eval/README.md`.*
- [x] **Cards an agent proposes are checked when they are proposed**, against the quote the
      agent gave. The agent waits on the model; the reader's Add stays instant.
      *Cards that fail are left out and shown on the suggestion with why. When none pass,
      the suggestion is stored as "failed", the agent is told, and the reader isn't asked. A
      suggestion from before this has no checked cards and can only be rejected.*
- [x] A reader-facing use of the grade, with the one-tap overrule. *Go deeper, Phase 28.*
- [ ] Score Codex once its account can run. It keeps its default model, unscored.
- [ ] A larger evaluation set drawn from real chapters. Checking scored 16/16 on every run,
      which says the set is too easy to tell models apart.

Tried **2026-11-26** with Claude Code on a copy of the real data. Writing the quiz for "The Mom
Test" chapter through the app took 51 s and saved eight questions, each with `verifiedAt`. For
"Asking important questions" the server log read "kept 8, dropped 3": one answer added a claim
the passage doesn't make, and one question's answer ran past the cited paragraphs, which is the
check being stricter than a person would be. Cards on a 422-character passage saved one card,
checked. With the app closed, a real `claude -p` called both tools through the MCP server:
"about nine hours" verified, the same question with "about three hours" was rejected, and
"Trains were quicker I think" came back `partly`, `unsure: true`. Not checked: Codex, the API
provider with a key, a PDF chapter, and a quiz failing for too few questions outside the unit
test.

## Phase 28 — Ask and Go deeper · M

The five passage modes fold into two, because only two were ever used, and the reader's turn
moves out of the chat into a sheet over the book. The same 393 complaints set the bar: be
tested, don't be lectured, and be able to trust the verdict.

- [x] **Toolbar: Ask, Go deeper, Highlight, and More** (Note, Park, Make cards). Explain, Work
      it out and Explain it back are no longer buttons.
      *Ask sent empty means "explain this" and starts an `explain` thread; a typed question
      starts an `ask` thread. Threads saved as `work`, `explainBack` or the old `deeper` keep
      their own request strings and open as before.*
- [x] **Ask answers first and briefly**, about 120 words, then may close with one "Your turn"
      question. The app lifts that line out of the answer and shows it as a prompt with a
      skip button.
      *Passing over a prompt is dismissing it or sending the tutor anything else while it is
      on offer. Two in a session and no more are shown until the app is opened again; the
      count is in `sessionStorage`. Taking one opens Go deeper on its question.*
- [x] **Go deeper is a sheet over the book** with the passage hidden and the chat folded away.
      A passage with no earlier thread gets one question written by the tutor, to try first;
      one already asked about gets an explain-back, with no model call. Hint, up to four
      steps, and Just tell me are always there. Enter checks, Esc saves the draft and closes,
      and the thread opens the sheet again.
      *`lib/server/study.ts`, one route with an `op`. "Already asked about" is an earlier
      thread on the same text, or one whose passage holds the selection or is held by it for
      at least 24 characters. The question is written with
      its expected answer in one `structured` call on the tutor's model; hints and Just tell
      me are ordinary tutor turns in the thread, sent without opening it in the chat.*
- [x] **Answers are graded by `gradeAnswer`**, on the checking model, not by the tutor. The
      sheet shows right or not right, the first gap and the stretch of the passage that shows
      it, marked in the passage. An unsure grade says so and leaves the call to the reader.
      **I had it** and **I missed it** overrule any grade in one tap.
      *An explain-back is graded against the passage itself. A prompt taken from an Ask
      answer is graded against that answer. The rubric from the first grade is kept, so a
      second try is marked against the same points.*
- [x] **Each turn is kept on the thread** in the book's JSON, in `study.turns`: the answer,
      verdict, score, unsure, the gap, hints used and the reader's overrule. The answer and
      the grade's note also join the thread's messages, so the transcript reads whole and the
      tutor knows where the reader stands.
- [x] **Focus sessions no longer need Three.** The timer, the folded chrome and the recall at
      the end are the app's own; nothing outside it is blocked, and `/api/focus` is gone.
      *Fixed on the way: the recall was sent as a reply to the open thread and silently
      dropped when none was open. It now starts a thread of its own.*
- [ ] The question the tutor writes for Go deeper is not checked with `verifyItem` before it
      is asked. It is asked once and not stored as a card or quiz question, and checking would
      add about 7 s to opening the sheet.
- [ ] Record graded turns in the learner ledger. The data is on the thread; nothing reads it.
- [ ] Dictation in the Go deeper sheet. The Ask and Park fields have it.
- [ ] The focus recall goes to the tutor with no passage, so it can't be checked against what
      was read. It could carry the text of the pages read during the session.

Tried **2026-11-26** in the app with Claude Code, on a copy of the real data and three of the
real books. Ask sent empty on a paragraph of *Evals for AI Engineers* answered in about 95
words and offered one prompt. Taking it opened the sheet; a deliberately vague answer came back
"Not sure about this one" with the gap and the span marked, and **I had it** was saved as
`override: "right"` on a turn graded `partly`, 0.5, `unsure`. Go deeper on a paragraph not
asked about took about 12 s to write its question; Hint 1 named where to think back to without
the answer; a full answer was graded right; Just tell me explained in the sheet. Go deeper on
the paragraph already asked about opened at once as an explain-back. Esc saved a half-written
answer to `study.draft`, and the thread's button reopened the sheet. A `deeper` thread saved on
13 November opened as an ordinary thread. After two prompts were passed over, the next Ask
answer showed none. A focus session started, ran and ended with no call to Three, and its
recall arrived as a new thread. Not checked: a PDF, Codex, the API provider, and grading when
the tutor is signed out.

## Phase 29 — A test at the end of every chapter · M

"Not sure I actually understood" and "I want to be tested" were among the largest themes in the
393 complaints, and review backlog was the main reason people gave up on review tools. So every
chapter ends in a short test, and none of it stands between the reader and the book.

- [x] **Finishing any chapter of any book offers its quiz**, with a quiet notice, and starts
      writing it in the background when it has none. Depends on Phases 26 to 28.
      *Outside a Course a chapter is a top-level entry of the book's contents, or an entry
      directly under a top-level entry that only groups chapters: one named "Part", "Book" or
      "Volume", or one whose entries are numbered as chapters ("I. Foundations" over
      "1. Introduction"). Sections nested in a chapter are covered by its quiz and get none, so
      nothing overlaps. Entries named exactly Cover, Copyright, Contents, Index, Notes and the
      like are not chapters. In a book a Course reads, the Course's own chapters stay as they
      were and any entry that overlaps one of them is left to the Course. `bookChapters` in
      `lib/shared/sitting.ts`. Such a chapter is finished by reading on into the entry after
      it, or the one after that, having had it open for 20 seconds; a jump further ahead is
      not finishing, so paging through a book doesn't have a quiz written for every chapter
      passed. The notice shows only while the quiz is being written or is ready. One that
      couldn't be written, as for a chapter with too little text, is not announced.*
- [x] **Nothing is gated outside a Course.** The result says "6 of 8 right" and "the 80 % mark
      is 7", and nothing follows from it. Closing the notice is one tap and is kept in the
      book's state, in `quizSkips`, so that chapter's notice does not come back. A chapter
      already tested is not offered again either. In a Course the notice, the pass and the
      order of chapters work as in Phase 17.
- [x] **The test mixes in earlier chapters.** Six to eight questions: up to six of the
      chapter's own and two from quizzes already written for chapters before it in the book,
      three when the chapter's quiz is short. With nothing earlier it is the chapter's own
      quiz, up to eight.
      *`composeTest`. No model call: earlier questions are drawn from saved quizzes, the ones
      last answered wrong first, then ones never asked, then the rest. When the chapter has
      more than six, the same order picks which are asked, spread evenly through the chapter
      on a first test, so a retake brings the ones left out. "Earlier" goes by the book's
      contents. Six of the chapter's and two earlier is 75 to 25, five and two is 71 to 29.*
- [x] **One question in each test is answered in writing and graded** by `gradeAnswer`, on the
      checking model: a "why" when the quiz has one. The sheet shows the first gap and the
      stretch of the text that shows it, says so when the grader is unsure and leaves the
      call to the reader, and **I had it** or **I missed it** overrules any grade in one tap.
      Recall questions are as they were: show the answer, then mark it.
      *The graded view is the one Go deeper uses, moved to `components/study/Outcome.tsx`. The
      two sheets stay two components: Go deeper is one thread with the tutor, hints and a
      saved draft, a test is a queue of questions, and one component for both would have
      been mostly branches. The answer is graded against the block the question cites and
      the block either side, read from the book again, which is what it was checked against
      when it was written. The rubric of the first grade is kept on the question, so later
      answers are marked against the same points with one call. With no tutor, or when
      grading fails, the reader sees the answer and marks it. **Just show me** does the same
      without waiting. The graded turn is saved on the answer with the reader's overrule.*
- [x] **A missed question is asked once more before the test ends.** The score is the first
      answers; how the second go went is kept beside the first.
- [x] **The misses come back the next day** as a retest of three or four questions, offered
      by the same notice when the book is opened.
      *Up to four misses, filled up to three with the questions the reader was least sure of.
      Nothing is stored for it: `retestDue` reads the chapter's latest test, and a retest
      taken or passed over is what ends it. A new test replaces an older one's retest. A
      retest never passes a Course chapter.*
- [x] **Each answer is kept with the quiz its question belongs to.** A test that asked two
      questions from Chapter 1 adds an attempt of kind "review" to Chapter 1's quiz, with the
      same time as the test, so a question's history is in one place and retention (Phase 18)
      reads it with no change. Attempts have a `kind`, and a test's attempt has its score over
      everything asked. Attempts saved before have no kind and read as the whole quiz taken
      alone; they pass a chapter as before and never start a retest.
- [x] **Only checked questions are asked.** Other chapters' questions are drawn only when they
      carry `verifiedAt`. A quiz saved before Phase 27 has none checked: it still opens, each
      question marked "written before questions were checked", and is never mixed into
      another chapter's test.
- [x] Retakes without limit, as before.
- [ ] A way to open a chapter's quiz from the contents. Outside a Course the notice is the
      only way in, so a quiz that finishes writing after the book is closed is not offered
      until that chapter is finished again.
- [ ] Check the old quizzes' questions, so they can be mixed in too.
- [ ] The overlap between a Course chapter and a Course section nested in it (Phase 17).
- [x] Record test answers in the learner ledger. *Phase 30: one event for each answer, on the
      quiz its question belongs to, written answers included.*

Tried **2026-11-26** in the app with Claude Code, on a copy of the real data. *Evals for AI
Engineers* is in no Course. Moving from Chapter 2 into Chapter 3 after half a minute showed
"Finished … A short quiz on it is being written", and "ready" about a minute later, with seven
checked questions. A miss on the first came back as "Question 8 of 8 · once more". A vague
written answer came back "Not sure about this one" with the gap and the span marked; **I had
it** saved it as `partly`, `unsure`, `override: "right"`. The result read "6 of 7 right. The
80 % mark is 6." Once Chapter 1 had a quiz, a retake asked eight: six of the chapter's and two
marked "from 1. Introduction", saved as a test on Chapter 2 and a review on Chapter 1 at the
same time. Closing the notice for Chapter 3 saved the skip, and leaving Chapter 3 again showed
nothing. With the saved attempts moved back a day by hand, opening the book offered "A
3-question retest", two misses and one fill. A hand-made quiz with no `verifiedAt` and an
attempt with no kind opened from `?quiz=` and ran, each question marked as unchecked. *Inspired*
in a two-chapter scratch Course: moving from Chapter 1 to Chapter 2 offered the quiz at once, 7
of 8 read "Passed. The chapter is done.", and the Course page read "1 of 2 chapters passed" with
Chapter 2 open. Not checked: a PDF, Codex, the API provider, a grade that fails (only **Just
show me** and the unit test), a retest on a real next day, the "comes after" notice on a locked
Course chapter, and the Mac app.

## Phase 30 — Learner ledger · M

The tutor sees one passage and one thread, mastery reads only cards and quizzes, and nothing is
shared across books. The ledger is the record under all of it: one line per piece of evidence
of what the reader knows, written by what they already do. It is data that code and agents
query, not a profile pasted into a prompt.

- [x] **An event log for the whole library**, append-only, in `data/ledger.jsonl`: time, book,
      anchor, chapter, source, outcome from 0 to 1 (none when the reader only met the
      material), unaided or not, hint level, days since they last met the item, confidence,
      and a topic in words already stored. Written under the cross-process lock.
      *No concept ids: the topic is the card's fact, the quiz question or the highlighted line.*
- [x] **Evidence strength** as one pure function: strong is an unaided answer a day or more
      after the last meeting, medium the same on the day, weak anything hinted or picked from
      options, exposure no check at all.
- [x] **Written by what the reader already does**: rating a card, answering a quiz or a chapter test, a
      draw-it-back, a highlight, a parked question, a question to the tutor. No model call. A
      ledger that can't be written is logged and never fails the action.
      *Each path hands over the book's saved state; events are named by what happened, so the
      log takes only what it lacks and the next action heals a missed write.*
- [x] **Backfill** from the book files (`npm run ledger:backfill`), safe to run again.
- [x] **Held, shaky, untested**, worked out when asked and never stored. Only strong evidence
      makes an item held, a miss takes it back to shaky until it is proven again, and held
      fades by replaying the checks through the card scheduler's forgetting curve.
- [x] **Three tools** for outside agents: `query_ledger`, `weakest_items`, `record_evidence`.
- [x] **What you know**, a page per book from Today: held, shaky and untested by chapter, and
      the three items most worth going back to, each with a link to its passage. No scores,
      no log.
- [ ] A link to the page from inside the book.
- [ ] Grade an explain-back and record it as a check. It is exposure-only until then.
- [ ] A recall check at the end of a focus session (`focus-recall` has no writer yet).
- [ ] Old evidence added late does not recount the days of events already written after it.

Mastery is unchanged: Courses still read retention from cards, quizzes and boards.

Done when the type check, lint, build and tests pass, the backfill fills the ledger from real
data and adds nothing on a second run, rating a card, answering a quiz and highlighting each
add their event in the running app, and a real `claude -p` with the app closed answers what
the reader is weakest on in a book from the ledger tools.

## Phase 31 — Modals over the book · S

Go deeper, card review and the chapter test each took over the whole reader pane, like a new
page, and Go deeper folded the tutor panel as well, which left a blank strip beside it. The
reader was only away for a moment and had lost the page they were on. The ground rule above
is the result; the sources behind it are in the pull request.

- [x] **The rule, written down** in the ground rules and in `AGENTS.md`, after reading what
      Nielsen Norman Group, Apple and Material say about modals and what the interruption
      studies measured.
      *The sources agree a modal should be short, keep its context in view and never lose
      work; that is where the exceptions in the rule come from.*
- [x] **One modal for a turn away from the book**, `BookModal` in `components/ui/dialog.tsx`,
      built on `ModalDialog`: centred over the dimmed book, as tall as what it holds up to most
      of the window, scrolling inside. Go deeper, card review and the chapter test all use it.
      *The book is blurred while a question is unanswered and clear once it is graded.*
- [x] **Go deeper no longer folds the tutor panel**, so the book does not move. Esc, the close
      button and a click outside all save the answer first. "Back to the book" is gone; the
      modal's own close does it.
- [x] **A chapter test is not closed by a click outside**: a test part-way through lives only
      in the modal. Esc and the close button still close it.
- [x] **The reader no longer throws when it leaves the page.** A change saved elsewhere
      remounts the book on return; the reader's pane then reported a resize to nothing, and
      laying out a frame with no document threw `Cannot read properties of null (reading
      'documentElement')`. Both resize observers, ours and foliate's, now skip a reader that is
      off the page.
- [x] **Folding the tutor panel gives its room to the book.** The room went to the board's
      empty slot and showed as a blank strip; the panel opens again at its earlier width.
- [ ] A chapter test part-way through is lost when it is closed. Saving the sitting, as Go
      deeper saves its answer, would let a click outside close it too.
- [ ] The whiteboard sheet, the end-of-session recall and the contents drawer are overlays of
      their own making, not `ModalDialog`. Left as they are; see the audit in the pull request.

Done when the type check, lint, build and tests pass, and in the running app on an EPUB Go
deeper opens over the visible book, the console stays clear of the `documentElement` error
while it opens, the window is resized and it closes, Esc returns to the same page, a
half-typed answer is there on reopening, and a chapter test runs in the same modal.

## Open: where the books come from

To discuss before building. The roadmap names the books; getting them is a separate
question. Current thinking: list the exact title, author and edition still needed, add
legal lookup links (Open Library and Internet Archive lending, OpenStax, Project
Gutenberg, publisher pages, the local library), and pick up whatever lands in the books
folder. Not building any automated downloading from shadow libraries.

## Not building

- **LangGraph, or an agent framework.** `anything` pulls five `@langchain/*` packages, a
  vendor patch on `@langchain/core` and a `ChatDeepSeek` subclass that re-injects
  `reasoning_content` — all to run one ReAct loop it could write in a hundred lines. This app
  already has its own tutor loop; a framework here is more surface for less.
- Decks: the book is the deck.
- Knowledge graph, notes import, plugin system, worker batches: built for their lesson
  runtime, not a reader.
- More tutor providers: three is enough.
- Archive, card generation from files, a practice mode apart from chapter quizzes.
- Hint counters, calibration panels, per-book mode settings. (A confidence number itself is
  in Phase 14; the dashboards around it are not.)
- Other questioning modes (find the flaw, counter-examples, argument maps, chapter
  debriefs, cold opens). Revisit only if Phase 6 gets used.
- Model-graded card review. Flip and rate stays on the reader's machine. Grading a free-text
  answer on request is Phase 27, approved 2026-11-26 on two conditions: one tap overrules any
  grade, and plain review never waits on a model.
