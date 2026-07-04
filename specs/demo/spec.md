# SandwichTS Demo (TaskBoard) — Canonical Spec

Requirement prefix: `SW-`. App: `apps/demo` (`sandwichts-demo`). Core spec: [../core/spec.md](../core/spec.md).

### SW-DEMO-E2E: End-to-end extraction proof
**Applies to:** frontend-code-mode
**Test category:** e2e / manual (procedure below; `?mock=1` flows are Playwright-able)

The TaskBoard demo shall drive a kanban board (columns, colored cards, board theme)
entirely through code mode: the model emits ```js blocks calling the board tools, the
sandbox executes them against live state, transcripts feed back, and the final prose
renders with all code hidden (revealed under the dev code peek).

**Verification procedure** (`pnpm dev`, http://localhost:5173):
1. Happy path (real model, `.env` ANTHROPIC_API_KEY): send
   "Add three cards to the Doing column about launch prep, each with a different pastel color."
   Confirm: assistant emits one ```js block (hidden in chat; visible via code peek);
   cards appear live; an executed-calls transcript is visible in the dev panel;
   final prose summary renders.
2. Read→write chain: "Rename every card in Done to start with ✅ " — confirm the block
   reads get_board first, then one batch_update_cards; board updates.
3. Remote tool: "Add a card to To Do with an inspirational quote" — confirm the
   get_inspirational_quote call round-trips the dev server and the card carries the quote.
4. Self-correction: "Use the set_card_priority tool to mark the first card urgent"
   (no such tool) — confirm the error transcript lists available functions and the model
   corrects in the next iteration without user input.
5. Abort: start a multi-step request, press Stop mid-run — input unlocks, no further
   mutations after the abort.
6. Watchdog: `?mock=1` scripted flow includes a `while(true){}` block — confirm the
   timeout error is reported and the loop recovers.
7. Mock mode: `?mock=1` runs flows 1 and 6 deterministically offline (Playwright target).
8. Custom event: with `?customEvent=1` the dev backend emits `code_mode.script` CUSTOM
   events — confirm behavior of flow 1 is unchanged (SW-CODE-CHANNEL precedence).
