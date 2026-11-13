# Card prompt check

Roadmap Phase 2. Checks that `prompt.md` writes usable flashcards before any card UI is built.

```bash
mkdir -p /tmp/card-eval && cp scripts/card-eval/prompt.md /tmp/card-eval/
node scripts/card-eval/passages.mjs "$PWD" /tmp/card-eval/passages.json "$BOOKS_DIR"
node scripts/card-eval/run.mjs /tmp/card-eval claude-sonnet-5-5
```

`passages.json` and the results hold book text and your reading history, so keep them out of the repo.

Each passage is scored on three checks:

1. **Supported:** every answer is backed by the selection or the text around it.
2. **Stands alone:** each question asks one clear thing, without the page in front of you.
3. **Same fact:** every card on a passage recalls the same fact, each starting from different information.

Gate: 70 % on all three.

## Results, 2026-11-13, claude-sonnet-5-5, 20 passages

| Round | Supported | Stands alone | Same fact | Unparsed |
|---|---|---|---|---|
| 1 | 18/20 | 18/20 | 6/20 | 0 |
| 2 (current prompt) | 19/20 | 17/20 | 14/20 | 1 |

Round 1 packed two or three facts into one and wrote a card per fact, often from the surrounding text. Round 2 asks for one claim, tests every card against it, and lowers the default to one or two cards.

Still wrong in round 2:

- A "fact" joined by "and" or "so" still carries two claims (Personal MBA, Refactoring UI, the pre-LLM NLP passage).
- One reply added a correction after the JSON. Phase 4's single repair round covers this.
- A one-term selection got a card in one book and no card in another.
- Dialogue with no stated point (Good Strategy Bad Strategy) got a card when it should have got none.
