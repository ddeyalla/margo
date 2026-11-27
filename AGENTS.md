<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Where a new surface opens

Full rule and its tests: `roadmap.md`, ground rules, "A moment away from the book is a modal over it".

- A short turn that returns to the same reading place (a question to answer, a review, a test, a search) opens in a modal over the book. Use `BookModal` or `ModalDialog` from `components/ui/dialog.tsx`; do not add another overlay.
- A new page is only for when attention moves on to a different task.
- The book stays mounted and in place behind a modal: fold or resize nothing beside it.
- Esc, the close button and a click outside return to the exact reading position, and save anything typed first. If the work lives only in the modal, turn off the click outside (`lightDismiss={false}`).
- Nothing in a modal navigates away or opens a second modal of its own.
- A modal that asks for recall sets `veiled`, which blurs the book until the answer is in.
- What the reader consults while reading (tutor panel, notes, contents) is not modal. A whiteboard takes the pane.

## Agent playbooks

Two playbooks run on the `rigg-learn` MCP server (`npm run mcp:setup`). Claude Code loads them as skills from `.claude/skills/`; Codex reads the same files. They are the single copy of each: do not duplicate them.

- Prep, the night before: `.claude/skills/prep/SKILL.md`. Reads the ledger and review queue, then leaves one prepared plan (`propose_session_plan`) and any new cards on the Today card.
- Follow-through, after a session: `.claude/skills/follow-through/SKILL.md`. Turns parked questions and missed answers into verified card suggestions and a short recap.

Both only propose. The reader accepts or dismisses on Today. Never write to the ledger from Prep.
