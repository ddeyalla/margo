# Item bank, daily limit and ledger wiring

## What was migrated
- **Cards and chapter-quiz questions are one bank.** An item is a `Cue` (`type`: flip, choice or free) in the set of its passage, which holds the anchor and the FSRS schedule.
- **Read-time migration** (`bankQuizzes`, called from `store.ts` `normalize`): once a chapter quiz has been taken, each of its askable questions becomes an item. Recall questions become flips, "why" questions become written (graded) items. A question at a passage that already has a set joins it and leaves its schedule alone; otherwise it gets a new set whose schedule is the replay of the test answers, held to come back no sooner than a day after the last one.
- `cardSets` and `quizzes` stay on disk untouched. `banked` records each question moved, so an item the reader deletes is not made again. The merged state is saved by the next normal write (same lock, atomic write).
- Chapter tests still use `quizzes`; their questions are copies. Editing one does not edit the other.
- Quiz-only sets stay out of the markdown notes, a Course's retained figure (the quiz replay counts them) and the streak's "cards made".
- Old ledger events are not rewritten (ids dedupe). New rules apply from now on.

## Daily limit
`dailyLoad` in settings: 20 new, 60 due reviews, per book per study day. Learning steps always come. Overflow stays due and is not counted anywhere; `review_queue` returns only `moreWaiting`. Adjust it on the Cards tab.

## Ledger
- Go deeper answers write one check each (first unaided try: medium same day, strong a day later; unsure, hinted, told or repeated tries are weak). The reader's overrule adds a second weak check.
- Chapter tests: an unsure grade is weak; an overrule adds a weak check after the grader's mark.
- Bank reviews: picked-from-options, unsure grades and ratings that overrule the grader are `aided` (weak). A wrong pick allows only Again. Reviews of quiz-origin items land on the quiz's ledger item.

## Known limits
- The limit is per book, not across books.
- `delete-set` on a set that quiz questions joined removes them for good.
- A set mixing the reader's own cards and quiz questions counts the quiz replay and the set in mastery.
- Quiz sets use a 32-bit hash of the anchor for their id.

## Test by hand
1. Take a chapter test, then open Review the next day: its questions come back as cards (written ones ask you to type).
2. Cards tab: change the two daily limits, reload, check they stuck; with more due than the limit, "Review N" shows only the limit and no backlog number.
3. Review a written item: Check answer, grade shown, rating buttons suggest one; "unsure" asks you to decide.
4. Review a choice item (propose one via `propose_card` with `type: "choice"`): a wrong pick enables only Again.
5. Go deeper: answer, overrule, then `query_ledger` / `weakest_items` show the passage with weak, not held.
6. Delete a migrated item, edit another card, reload: it does not come back.
