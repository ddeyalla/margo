# Roadmap

What to build next, in order. Ideas come from
[learnharness](https://github.com/amosblomqvist/learnharness.git) (AGPL-3.0) and
[anything](https://github.com/ai4next/anything) (GPL-3.0), so every item is rewritten
here, never copied. This repo is MIT; pasting their code in would relicense it.

Effort: `S` hours · `M` a day or two · `L` a week or more.

## Ground rules

- **Review never calls a model.** Flip and rate, on the reader's machine.
- **The highlight owns the schedule, not the card.** Three cards on one highlight are one
  review, not three.
- **Cards outlive the highlight.** Deleting a highlight keeps its cards and their schedule.
- **Cards and tutor questioning are opt-in.** Nothing happens until the reader asks.
  The exception is a chapter quiz inside a Course (Phase 17), which is part of finishing
  the chapter.
- **Every questioning mode has a way out.** "Just tell me" is always one click away. A
  chapter quiz can be retaken without limit, and a missed question shows its answer.
- **Mastery is computed from evidence, never stored as a number.** Coverage and retention
  are read from reading position, card schedules and quiz results, so they can't be
  inflated and they fall when you stop reviewing.
- **Quizzes are written ahead, not on the spot.** Taking a quiz never waits on a model.

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

## Phase 8 — Mac app · L

- [x] Electron shell around the Next server. Reference: learnharness `electron/`,
      `docs/desktop-release.md`.
- [x] Folder picker instead of `BOOKS_DIR`, Dock icon.
- [ ] Signed DMG. Unsigned for now: the first open needs right-click, Open.
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

- [ ] The browser's speech voices read the book aloud, highlighting each word, with a
      speed control. EPUB first.

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
      *`lib/shared/quiz.ts`. A quiz belongs to a chapter of a book, keyed by its contents
      label, and lives in the book's state, so two Courses reading the same chapter share
      it. Passing needs 80 % (4 of 5 up to 7 of 8). Answers are self-graded after the answer
      is shown, like card reviews, because model-graded free text is under "Not building";
      each answer also asks "how sure" and "your answer, in a line" with Phase 14's
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
      *The result lists each missed question with its answer and a link to its place;
      Phase 14's signal summary ("1 held", "1 misconception") sits above it.*
- [x] Books outside a Course are never gated.
      *They get no quizzes, notices or locks at all.*
- [x] **One design system.** `components/ui` holds the primitives every surface uses:
      `Field`, `TextArea`, `Surface`, `PaneHeader` and `Divider` beside `Button`. Edges are
      hairlines (`line`, `line-strong`); only floating surfaces get elevation. Excalidraw's
      chrome and canvas take the app's tokens, so the board reads as part of the pane.
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
sections too.

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
      on the same scale as book text. Case and accents fold; no stemming. The last word, while
      it is still being typed, also matches as a prefix. Highlights, notes and cards are read
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
- [ ] If vectors land: hybrid = BM25 + vector, merged by reciprocal rank fusion, which needs no
      reranker. Say the *similarity*, higher is better, and test that ordering on five queries
      before shipping. `anything` stores sqlite-vec's distance (lower is better) and then filters
      `>= 0.3` and sorts descending, so it keeps its worst matches (`rag/search.ts:115`).
- [ ] Wire the vector path at startup and prove it runs. `anything` exports a
      `configureSearch()` that nothing ever calls, so its "semantic search" silently falls back
      to BM25 on every query. Same trap: a test that catches the fallback, not just the result.
- [ ] One copy of the vectors. A chunk's embedding goes in one place, not in the book's data and
      a side database both.

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
      *Ops are `add_node`, `add_link`, `update` and `delete`, at most 30, checked against the
      ids sent. Changes are asked for in the chat, not in a second box on the board: the
      open board rides along as a chip on the message, the tutor answers in words and puts
      its ops in a `board` fence, and they land on that board as suggestions once the
      answer finishes, read against the board as it was sent. The chat only says where
      they went.*
- [x] **Agent edits are suggestions:** shown in their own colour, accepted or rejected one
      by one, so the tutor never overwrites your drawing. Undo covers the rest.
      *Suggestions are dashed, violet and locked, and carry what they would do on the
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
- Model-graded free-text review.
