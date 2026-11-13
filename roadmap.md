# Roadmap

What to build next, in order. Ideas come from
[learnharness](https://github.com/amosblomqvist/learnharness.git) (AGPL-3.0), so every
item is rewritten here, never copied.

Effort: `S` hours · `M` a day or two · `L` a week or more.

## Ground rules

- **Review never calls a model.** Flip and rate, on the reader's machine.
- **The highlight owns the schedule, not the card.** Three cards on one highlight are one
  review, not three.
- **Cards outlive the highlight.** Deleting a highlight keeps its cards and their schedule.
- **Cards and questioning are opt-in.** Nothing happens until the reader asks.
- **Every questioning mode has a way out.** "Just tell me" is always one click away.

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
reader's own words.

- [ ] New `TutorAction` `"work"`, labelled "Work it out", kept for the thread's life.
- [ ] Prompt: decide the right answer first, name the target in one line ("why X holds"),
      then ask. Judge each reply right / partly / wrong, and nudge at the first mistake
      without giving the correction.
- [ ] **Hint** button, one step per click: re-read this part → what kind of idea it is →
      name it → the worked step.
- [ ] **Just tell me** button: the tutor explains it fully. Also happens on its own after
      six turns.

## Phase 7 — Explain it back · S

- [ ] Toolbar action: the reader writes two lines on the passage; the tutor points to the
      first mistake, or says it holds. No grade.

## Phase 8 — Mac app · L

- [ ] Electron shell around the Next server. Reference: learnharness `electron/`,
      `docs/desktop-release.md`.
- [ ] Folder picker instead of `BOOKS_DIR`, Dock icon, signed DMG.
- [ ] No auto-update, no Windows or Linux builds.

## Not building

- Decks: the book is the deck.
- Knowledge graph, notes import, plugin system, worker batches: built for their lesson
  runtime, not a reader.
- More tutor providers: three is enough.
- Practice mode, stats, archive, card generation from files.
- Confidence ratings, hint counters, calibration panels, per-book mode settings.
- Other questioning modes (find the flaw, counter-examples, argument maps, chapter
  debriefs, cold opens). Revisit only if Phase 6 gets used.
- Model-graded free-text review.

## Open decision

- [ ] **Licence.** rigg-learn has none, so it's all rights reserved. Add MIT (or another)
      before it's shared. Rewriting learnharness ideas, not code, keeps that choice open.
