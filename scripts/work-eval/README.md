# Work it out check

Roadmap Phase 6. Checks that the Work it out rules, `ACTION_REQUESTS.work` in `lib/server/tutor/prompt.ts`, lead the reader to the answer instead of giving it.

```bash
mkdir -p /tmp/work-eval
node scripts/card-eval/passages.mjs "$PWD" /tmp/work-eval/passages.json "$BOOKS_DIR"
node scripts/work-eval/run.mjs /tmp/work-eval claude-sonnet-5-5 claude-opus-5-5 round2
```

The optional last argument names the results file (`results-<tag>.json`, default the tutor model), so rounds do not overwrite each other.

The script imports `buildTurn`, `cliInput` and `TUTOR_SYSTEM` from the app, so it tests the prompt that ships. Each passage gets three tutor turns through the `claude` CLI, with no tools, an empty folder and no session, so every call carries the whole transcript:

1. **Opening:** the thread with only "Help me work this out."
2. **Partly right reply:** a separate `claude` call plays the reader, answers the opening question in one or two casual sentences with one real misconception and one phrase of its own, and the tutor replies.
3. **Hint 1:** the reader sends "Hint 1" and the tutor replies.

A judge call (`claude-opus-5-5`, no tools) then reads the passage, the text around it and the transcript. It scores four checks, one of them also counted mechanically:

1. **One question:** every tutor turn asks exactly one question. Two asks joined by "and" or "or" count as two. The gate uses the mechanical count, every tutor turn has exactly one `?`. The judge's verdict is reported beside it and is stricter, because it also catches two asks joined by "and" or "or" inside one question mark.
2. **No early answer:** no tutor turn states the answer or the correction.
3. **Own words:** turn 2 nudges at the reader's first mistake and reuses the reader's own wording.
4. **Hint step:** turn 3 only points back to the part to re-read, and does not name the idea or answer it.

Gate: 70 % on each. One question is gated on the mechanical count; the judge scores the other three.

`passages.json` and the results hold book text and your reading history, so keep them out of the repo. The results file (`/tmp/work-eval/results-<model>.json`) holds every transcript, the judge's reason for each check, and the number of question marks in each tutor turn.

## Results, claude-sonnet-5-5 tutor, claude-opus-5-5 judge, 20 passages

| Check | Round 1 | Round 2 |
|---|---|---|
| One question, mechanical (gate) | 9/20 | 16/20 |
| One question, judge | 0/20 | 9/20 |
| No early answer | 15/20 | 17/20 |
| Own words | 20/20 | 19/20 |
| Hint step | 9/20 | 17/20 |
| Unparsed | 0 | 0 |

Gate (70 %, 14/20) met on every check in round 2, so there was no round 3. Round 1 missed it on one question and hint step. Round 1 had no mechanical score in its run; its 9/20 is the same count taken from the saved transcripts.

**Round 1.** The first rules: decide the answer privately, name the target, ask one question, nudge at the first mistake using the reader's words, give hints in four steps, explain fully on "Just tell me" or the sixth reply.

**Round 2.** Same five paragraphs and same hint ladder. It says what counts as one question: a single sentence with one question mark, asking for one thing, where "and" or "or" or a second question anywhere makes two, and context goes before it as statements. The nudge must quote the reader's words that go wrong and say what to look at again, and must never say what the passage says instead, write the corrected version, or use "it doesn't say X, it says Y". Hint 1 names only where to look again, by the first few words of the sentence or paragraph, and must not quote the part that holds the answer, explain it, add a clue, or ask a question that names the idea.

The judge is noisy. Earlier runs of the round 1 tutor with other judge prompts scored one question anywhere from 2 to 20. Treat the counts as a range, not a point.

Remaining failure patterns (round 2):

- **Compound questions still slip through.** The mechanical count is 16/20, but the judge finds a question joined by "and" or "or" in 11 of 20 passages, mostly in the opening ("which is X, and which is Y?"). One question mark does not mean one ask, so the mechanical gate is the weaker measure.
- **Extra question marks.** 4 passages have a turn with two or three, from a lead-in question before the real one or a rhetorical aside.
- **Hint 1 still leaks in a few passages.** The quoted opening words of the sentence sometimes carry the answer itself, or the follow-up question describes what the sentence holds. 3 of 20 fail.
- **Early answer, 3 of 20.** The opening restates what the passage says before asking, or the nudge says what the passage does not claim.
- **Own words, 1 of 20.** When the reader's reply is right, the tutor says "Right" and quotes the passage instead of the reader.
