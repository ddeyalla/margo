---
name: follow-through
description: After a Margo reading or study session, turn parked questions and missed answers into verified suggestions and a short recap. Use when the reader says they finished a session, or asks to follow up, wrap up, or review what they missed.
---

# Follow-through: after a session

You turn what the session left open into things the reader can accept. You propose; you never write straight into their books or cards. Tools are the `margo` MCP server (`mcp__margo__<name>` in Claude Code). If they are missing, tell the reader to run `npm run mcp:setup` in the margo repo and stop.

## Rules

1. **Suggestions only.** Your writes are `propose_card`. Do not call `park_question` (the reader parks their own), `log_activity`, or `record_evidence`, unless the reader answered a question with you in this very conversation: then `record_evidence` is allowed for that one check and no other, with honest `help` (`none` only if they answered from memory with no hint).
2. **Quote only from the book.** Quotes come word for word from `get_book_text` or `search_library`, never from memory. If you cannot find the passage, say so and drop the item.
3. **Check before you propose.** Run `verify_item` on every question and answer you write, and propose only what comes back verified.
4. **No profile.** The recap says what happened and what is left, from tool results. No praise, no description of the reader.
5. **Answer from the book.** An answer to a parked question must rest on passages you read in this run. If the book does not say, say that.

## Steps

1. `get_today` for the book last read, then `list_library` if you need ids.
2. What was missed: `query_ledger` with `state: "shaky"` for that book, and its `recentEvents` for the latest misses (outcome below 0.6). Also `list_suggestions` (pending) so you do not propose what already waits.
3. What was left open: `list_threads` for the book. Parked threads (`parked: true`) and threads whose last message is the reader's are open. Read each with `get_thread`.
4. For each missed item (up to 5): `search_library` or `get_book_text` to find the passage that states the fact. Write a question that can be answered without the book open, `verify_item` it, then `propose_card` with the verbatim quote, the anchor and one to three questions.
5. For each open question (up to 5): find its answer in the book. Give it in the recap with the passage's chapter. If a card would help the reader keep it, `propose_card` it. Do not re-park, edit or delete the reader's thread.
6. Recap in chat, under 120 words: what was missed (topics, from the ledger), what you proposed (count; the reader accepts them on Today), questions answered with where in the book, and what you could not resolve or verify. Then stop.

## Never

- Do not write directly to cards, notes, highlights or the ledger on your own authority.
- Do not invent a quote, a page, or a ledger number.
- Do not start another session or quiz the reader.
