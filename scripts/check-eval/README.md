# Check and grade evaluation

Roadmap Phase 27. Runs the real model over the fixed set in `tests/eval/` and prints how often it agrees with
the labels. It checks two things: `verifyItem` (does a written question hold up against its passage) and
`gradeAnswer` (is a free-text answer right, wrong or in between).

```bash
node scripts/check-eval/run.mjs claude-haiku-5-5            # both parts, through Claude Code
node scripts/check-eval/run.mjs claude-sonnet-5-5 claude grade
node scripts/check-eval/run.mjs claude-haiku-5-5 api verify # needs ANTHROPIC_API_KEY
```

It is not part of `npm test`: the whole set is about 90 model calls and takes two to three minutes.
`tests/check.test.ts` covers the parsing, the validation and the wiring with a scripted provider, and checks
that the set keeps its shape.

## The set

All five passages were written for this set, so no book text is in the repo.

- `verify-items.json`: 16 question, answer and passage triples. Eight are sound. Eight are broken on purpose:
  a wrong answer, a wrong number, a reversed claim, a wrong mechanism, a true fact the passage never states, a
  detail the passage doesn't give, and a right answer with an unsupported claim added.
- `grade-answers.json`: 24 answers to six questions, labelled `right` (8), `wrong` (8) or `middling` (8). One
  wrong answer is an instruction to the grader to mark it correct. Items `g17` to `g24` are held out: they were
  written after the first run and before the second, and the prompts were not changed after seeing them.

A clear answer agrees when it gets its verdict and is not hedged. A middling answer agrees when it comes back
with `unsure: true`, whatever the verdict.

## The bar

Set before the first run:

- Verification: no broken item accepted, at most one sound item rejected.
- Grading: no confident flip (a right answer graded wrong, or the reverse, without `unsure`), at most one
  middling answer not reported unsure, and agreement on at least 81 % (13 of 16, 20 of 24).

## Results, 2026-11-26, through Claude Code 2.1.326

| Model | Verification | Grading | Held out | Confident flips | Middling reported unsure |
|---|---|---|---|---|---|
| claude-haiku-5-5, run 1 | 16/16 | 21/24 | 7/8 | 0 | 8/8 |
| claude-haiku-5-5, run 2 | 16/16 | 23/24 | 8/8 | 0 | 8/8 |
| claude-sonnet-5-5 | 16/16 | 22/24 | 8/8 | 0 | 7/8 |

Both models pass. The app uses Haiku 5.5, the cheaper one (`CHECK_MODEL` in `lib/server/check/provider.ts`).
Codex was not run: its account is at its usage limit until 2026-12-12, so it keeps its default model, unscored.

Every miss:

- Haiku run 1, `g05` (wrong, the reversed spring and neap answer): marked `no, partly` and reported unsure.
- Haiku run 1, `g21` (right, two bulges and the Earth turning): marked `partly, yes` and reported unsure, because
  the answer never says the Moon's gravity makes the bulges.
- Haiku runs 1 and 2, and Sonnet, `g16` (right, "The railway next to it did the trip in under an hour"): reported
  unsure, because the answer never gives the nine hours it is being compared with. This label is the most
  arguable in the set.
- Sonnet, `g08` (middling, "Spaced repetition is better than cramming"): graded wrong with confidence 0.85.

Every Haiku miss is a clear answer reported as unsure. None is a wrong verdict stated with confidence.

### The first run failed, and what changed

Before the prompts and the scoring were changed, grading on the first 16 answers was 11/16 on Haiku and 9/16 on
Sonnet, with 2 of 5 and 0 of 5 middling answers reported unsure. Two causes:

1. A score of 0.25 or less counted as a confident "wrong", so an answer that partly made one point of two was
   graded wrong. Now only a score of 0, no point made even in part, is "wrong".
2. The rubric asked for details the question never asked for (the year 1843, "new and full moon"), so right
   answers lost points. The rubric prompt now leaves out dates, names and figures unless the question asks for
   them, and the marking prompt says a detail the point doesn't name isn't needed.

The first 16 answers were used to make those changes, so their score flatters the prompts. The eight held-out
answers are the fairer number.

### What these numbers don't show

- Verification at 16/16 on three runs means the set is too easy to tell the models apart, not that checking is
  never wrong. On real chapters it rejects sound questions too: in two runs on "Asking important questions"
  from *The Mom Test* it dropped two of ten and three of eleven, among them a question whose answer ran past
  the cited paragraph and its neighbours.
- 24 answers on five tidy passages is small. The labels are one person's.
- Each model was run once or twice. Run-to-run variation is at least two answers of 24.

## Cost and time

Measured through Claude Code on a Claude plan, so the dollars are list prices the CLI reports, not a bill, and
they depend on how much of the CLI's own prompt was cached. Six items each.

| Model | One verification (two calls) | One grade (two calls) |
|---|---|---|
| claude-haiku-5-5 | $0.0003 | $0.0006 |
| claude-sonnet-5-5 | $0.0041 | $0.0093 |

Each call sends about 2,800 to 3,000 input tokens, most of them the CLI's own, and gets back 80 to 230.

A verification took a median 6.4 to 7.0 s on Haiku and 5.6 s on Sonnet; a grade 6.8 to 7.2 s and 5.7 s. The
runs overlapped, four items at a time each, so this is not a clean speed comparison. A whole chapter quiz, with
writing, checking 8 to 11 questions four at a time and one round of replacements, took 50 to 51 s (two runs timed).
