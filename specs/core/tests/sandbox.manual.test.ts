// Traces: SW-SANDBOX, SW-SANDBOX-HARDENING, SW-CONTEXT (canonical spec: specs/core/spec.md)
// Verification: e2e / manual
//
// The iframe+worker sandbox touches real browser primitives (sandboxed iframe
// at an opaque origin, Web Worker, blob URLs, MessageChannel) — none of which
// reproduce faithfully under happy-dom. It is verified in a real browser via
// the demo playground.
//
// Setup:
//   pnpm dev   → http://localhost:5173/?playground=1
//
// Procedure (each is a playground button; observe the result panel):
//   A. Happy path — "Run happy script": a script that reads items, adds two,
//      and batch-updates one. Confirm the transcript lists each call as
//      name/args/result in order and the result panel shows no error.
//   B. Watchdog — "Run infinite loop": `while (true) {}`. Confirm the run
//      fails with "Script timed out after 3000ms and was terminated,"
//      the page stays responsive throughout, and a subsequent happy run works
//      (fresh worker per run).
//   C. Unknown function — "Run unknown fn": calls set_mood({}). Confirm the
//      error is "set_mood is not defined" (a ReferenceError — unlisted names
//      are never stubbed; the loop layer appends the available-function hint,
//      SW-UNKNOWN-FN, covered by unit tests). The host's own
//      "Unknown function:" echo is defense-in-depth for a call whose name is
//      in apiNames but missing from handlers.
//   D. Frozen context (SW-CONTEXT) — "Mutate context": assigns to
//      appContext.items. Confirm the script errors with a TypeError
//      (read-only / not extensible) rather than mutating.
//   E. No network — "Probe fetch": `await fetch('https://example.com/')`.
//      Confirm "fetch blocked: Failed to fetch" — fetch EXISTS in worker
//      scope; the srcdoc CSP (default-src 'none', inherited by blob workers)
//      is what blocks the request. This is the load-bearing hardening delta
//      vs lm-admin (which had no CSP).
//   F. Isolation — "Run two sandboxes": two sandboxes run scripts
//      concurrently; confirm each transcript contains only its own calls
//      (MessageChannel isolation, no crosstalk).
//   G. Hardening inspection (SW-SANDBOX-HARDENING) — in devtools, verify the
//      playground iframe has sandbox="allow-scripts" only, its srcdoc carries
//      the CSP meta, and (Network tab) no requests originate from the iframe.
//
// Cross-browser: repeat A/B/F on Safari ≥16 (MessagePort transfer into
// sandboxed opaque-origin iframes) before relying on it there.
import { describe } from 'vitest';

describe.skip('SW-SANDBOX: iframe+worker sandbox (manual verification)', () => {
    // See the procedure documented above. No executable assertion — the
    // spec's acceptance criteria plus this procedure are the verification
    // artifact.
});
