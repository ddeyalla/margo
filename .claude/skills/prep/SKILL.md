---
name: prep
description: Prepare the reader's next rigg learn session. Reads the learner ledger and review queue, then leaves one prepared plan and any new cards as suggestions on the Today card. Use when asked to prep, prepare tomorrow, or get ready for the next study session.
---

# Prep: get tomorrow's session ready

You prepare. You never interrupt, never test the reader, and never change their books. Everything you leave is a suggestion on the Today card that the reader accepts or dismisses when they next open the app.

Tools are the `rigg-learn` MCP server (`mcp__rigg-learn__<name>` in Claude Code; the same names in Codex). If they are missing, tell the reader to run `npm run mcp:setup` in the rigg-learn repo and stop.

## Rules

1. **Suggestions only.** Your writes are `propose_card` and `propose_session_plan`. Do not call `record_evidence` (nothing was tested), `log_activity` (no time was spent) or `park_question`.
2. **Read the ledger, not a profile.** Decide from `weakest_items`, `query_ledger`, `review_queue` and `list_threads`. Do not write or keep a description of the reader. The plan's `note` is one or two neutral sentences on why these items, with no praise.
3. **Quote only from the book.** Any quoted passage comes word for word from `get_book_text` or `search_library`. Never from memory.
4. **Check before you propose.** Every question you write for the reader goes through `verify_item` against its passage; propose only what comes back verified. `propose_card` checks cards again itself.
5. **Small.** At most 8 retest items, 2 exercises, 5 open questions, 3 new cards. A short plan beats a full one.

## Steps

1. `get_today`: the book being read, what is due, minutes left. That book is "where the reader is". Then `list_library` for ids and titles.
2. `list_suggestions` with status `pending`: do not repeat what already waits.
3. For the current book, and one or two other recent books: `weakest_items` (limit 8). Take items in this order: missed while sure, missed, faded, never checked. Use `query_ledger` with `state: "shaky"` or `"untested"` for a chapter you want more of. Evidence in the ledger is what counts: an item only held when recalled unaided a day or more after meeting it.
4. `review_queue` for due cards. Do not duplicate due cards as retest items; mention the count in the note only if it is large.
5. `list_threads` for the current book: parked questions and threads with no answer. Read one with `get_thread` before listing it. Pick up to five.
6. Exercises: use `get_today`'s current book and the reader's position. `get_book_text` for the chapter they are in (or the next, if they are near its end), or `search_library` for a weak topic. Write one or two prompts the reader answers from memory or by explaining, each tied to one passage you actually read. Write the answer you expect and run `verify_item` on every prompt; the server does not check it. Skip an exercise that does not come back verified.
7. New cards (these wait behind the plan on Today), only where a weak item has no card: `propose_card` with the verbatim quote, its anchor and one to three questions. Each is its own suggestion.
8. `propose_session_plan` once, with `retest`, `exercises`, `questions` and the note. Items carry the `bookId`, `topic`, `chapter`, `anchor` and a one-line `why` taken from the ledger ("missed twice", "not checked since 12 Nov"). Preparing again for the same day replaces the plan still waiting.
9. Report in chat, briefly: what you left, how many items by state, and anything you could not verify. Then stop. Do not start a session or quiz the reader.

## Never

- Do not ask the reader questions or wait for answers; this runs while they are away.
- Do not write evidence, activity, or notes.
- Do not claim a number you did not read from a tool result.
