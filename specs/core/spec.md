# SandwichTS Core — Canonical Spec

Requirement prefix: `SW-`. Home repo: `frontend-code-mode` (this repo). Package: `@sandwichts/core`.

SandwichTS is a browser-native CodeAct engine extracted from lm-admin's Mobi code mode
(`lm-admin` branch `mobi_code_mode`, `React/Components/Builder/mobi/codeMode/`): instead of
native LLM tool calling, the model writes one ```js block that is executed in an
origin-isolated sandbox (iframe → Web Worker), with tools exposed as async stubs that RPC
to the host over postMessage. A multi-turn loop feeds the execution transcript back until
the model answers in prose. The LLM transport is `@itkennel/lm-ag-ui`'s `AgentClient`
(consumed structurally — core never imports the package at runtime).

---

### SW-EXTRACT: Code block extraction
**Applies to:** frontend-code-mode
**Test category:** unit

`extractCode(text)` shall return the trimmed body of the FIRST ```js or ```javascript
fenced block (case-insensitive language tag, trailing text on the fence line tolerated),
and `null` when the text contains no such block, only an empty block, only a bare ```
block, or is nullish. A `null` return signals the loop to stop (final answer).

**Acceptance criteria:**
- '```js\nawait f();\n```' → 'await f();'
- '```JS copy\nawait f();\n```' → 'await f();'
- bare '```\nx\n```' → null; '```js\n\n```' → null; prose-only → null; null/undefined/'' → null
- two js blocks → first block's body
- backtick template literals in the body survive verbatim

### SW-JSAPI: JS API surface rendering
**Applies to:** frontend-code-mode
**Test category:** unit

`buildJsApi(tools)` shall render each tool definition (name, description, JSON-schema
`parameters`) as a JSDoc comment plus `async function name(args) { /* bridged to the app */ }`
signature, and return `apiNames` in definition order (the sandbox whitelist). JSDoc types:
string/number/boolean/Array<item>/Object; enums render as a quoted union; required args as
`args.x`, optional as `[args.x]`; per-prop descriptions carried; `@returns {Promise<Object>}`.

**Acceptance criteria:**
- apiNames follow map iteration order
- required vs optional bracket notation; enum → `{"a" | "b"}`; array → `Array<Object>`
- empty map → `{ signatures: '', apiNames: [] }`

### SW-TRANSCRIPT: Execution transcript feedback
**Applies to:** frontend-code-mode
**Test category:** unit

`buildTranscriptMessage(transcript, error, iteration, availableFunctions)` shall render each
bridged call as `- await name(args) => result` (args/results JSON-serialized, each truncated
to 6000 chars with a `… [truncated N chars]` marker), `(did not complete)` for entries whose
result never resolved, `No tool calls were executed.` for an empty transcript, an appended
`Script error: …` when the script failed, and a closing instruction (write another block /
fix the problem). The message role is `user` and its id starts with `code_result_`.

**Acceptance criteria:**
- entry with result → `await name({...}) => {...}` line; entry without → `(did not complete)`
- result longer than 6000 chars → truncated with marker
- error present → `Script error:` line + corrective instruction; success → continuation instruction

### SW-UNKNOWN-FN: Unknown-function self-correction hint
**Applies to:** frontend-code-mode
**Test category:** unit

When the script error matches `/ is not defined\b/` or `/^Unknown function:/` and the
available-function list is non-empty, the transcript message shall append
`Available functions: <sorted, comma-joined>` plus "Call only these" guidance. No hint on
unrelated errors, on success, or when the list is empty. The sandbox host shall answer a
`call` for a name outside the whitelist with an `Unknown function: <name>. Available
functions: <sorted list>` error result (not a thrown host error).

**Acceptance criteria:**
- 'x is not defined' + [b,a] → 'Available functions: a, b'
- 'Unknown function: x' → hint present; "Cannot read properties…" → no hint
- success transcript → no hint; empty list → no hint

### SW-HIDE: Display content helpers
**Applies to:** frontend-code-mode
**Test category:** unit

`stripFencedCode` shall remove complete fenced blocks (any language) AND a trailing
unclosed fence (mid-stream), then trim. `hasVisibleProse` is true iff prose remains after
stripping. `extractFencedBlocks` returns each fenced block verbatim (including fences),
`[]` when none. `isDevCodeRevealEnabled()` reads localStorage key `sandwichShowCode`,
try/catch-guarded, false by default.

**Acceptance criteria:**
- js-only message → no prose; prose + trailing block → prose survives
- unclosed streaming block → no prose, and extractFencedBlocks captures it
- nullish input → '' / false / []

### SW-PROMPT: System prompt composition
**Applies to:** frontend-code-mode
**Test category:** unit

`composeSystemPrompt(parts)` shall join, separated by blank lines: the driving guide
(default `DEFAULT_DRIVING_GUIDE` — write ONE ```js block of await calls; template literals
for markup; `Promise.all` for independent calls; inspect results; no imports/wrappers; a
reply with no block ends the turn), the `Available API functions:` signatures block, a
context-binding line naming `contextName` (default `appContext`) when app context is
provided, consumer `rules` blocks in order, and the serialized app context last.

**Acceptance criteria:**
- ordering: guide < signatures < context-binding < rules < app context
- no appContext → no context-binding line and no context block
- custom contextName appears in the binding line verbatim

### SW-SANDBOX: Origin-isolated script execution
**Applies to:** frontend-code-mode
**Test category:** e2e (browser primitives — verified via the demo playground; see tests/sandbox.manual.test.ts)

`createSandbox()` shall execute a script inside a Web Worker spawned (per run, from a Blob
URL) inside a hidden `<iframe sandbox="allow-scripts">` WITHOUT `allow-same-origin`
(opaque origin). The generated code shall have access to exactly: the whitelisted tool
stubs (`apiNames`), the frozen read-only context binding, and standard JS built-ins — no
DOM, no fetch, no app storage. Tool calls RPC to the host over a per-run `MessageChannel`
port; the host runs the real handlers. A watchdog (default 8000 ms) terminates the worker
and resolves with a timeout error the loop can resubmit. `dispose()` removes the iframe.

**Acceptance criteria:**
- happy path: script calls whitelisted fns, transcript records name/args/result per call
- `while(true){}` script → watchdog kills worker at ~timeout, page stays responsive
- script referencing an unlisted fn → ReferenceError/Unknown-function error in result
- mutating the context binding throws (frozen); an absolute-URL `fetch` from script scope fails (CSP-blocked — `fetch` exists in WorkerGlobalScope, the srcdoc CSP is the network boundary)
- two sandboxes running concurrently do not cross-deliver messages (MessageChannel isolation)

### SW-SANDBOX-HARDENING: Sandbox message-security posture
**Applies to:** frontend-code-mode
**Test category:** manual (inspection + playground; documented in tests/sandbox.manual.test.ts)

Vs the lm-admin implementation the host shall: pin iframe→parent `postMessage` targetOrigin
to the host origin (never `'*'`), require a per-sandbox nonce on window-level
`iframe-ready`/`spawn-error` messages, carry all call/result/done/error traffic on a
transferred `MessagePort` (not window broadcast), include a CSP `<meta>` in the srcdoc
(`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:`),
deep-freeze the context object before binding, and cap each transcript entry's serialized
size before posting.

### SW-LOOP: Multi-turn code-mode loop
**Applies to:** frontend-code-mode
**Test category:** unit (fake AgentClient + stub sandbox)

The loop shall, per iteration: `startNewRun()`; `runAgent(conversation, [], subscriber,
forwardedProps)` with an EMPTY native tool list and `forwardedProps.codeMode === true`;
append returned messages to the loop-local conversation; obtain code (SW-CODE-CHANNEL);
stop when there is none (final answer); otherwise run the script and append the transcript
message (role `user`) to the loop-local conversation ONLY — never to any shared store.
The loop stops at `maxIterations` (default 8) or on abort (checked between turns; abort
also terminates the in-flight worker).

**Acceptance criteria:**
- turn N+1 receives [prior messages, assistant(code), transcript] in exact order
- prose-only reply ends the loop with reason `final-answer`
- iteration cap → reason `max-iterations`; abort → reason `aborted`
- loop deps expose no shared-store writer

### SW-CODE-CHANNEL: Code delivery channel
**Applies to:** frontend-code-mode
**Test category:** unit

The loop shall take the iteration's code from an AG-UI CUSTOM event named
`code_mode.script` (value `{ code: string }`) when one arrived during the run, else from
`extractCode` over the run's final assistant text. The custom event takes precedence.

**Acceptance criteria:**
- custom event present → its code executes even if the text also contains a ```js block
- no custom event → fenced block executes; neither → loop ends

### SW-CONTEXT: Read-only context binding
**Applies to:** frontend-code-mode
**Test category:** unit (binding name plumbed) + e2e (frozen enforcement, via SW-SANDBOX)

`context()` shall be re-invoked per iteration (so the snapshot reflects prior edits) and its
value bound in script scope under `contextName` (default `appContext`), deep-frozen. The
same consumer callback that serializes app context into the prompt should feed the binding
so the model reads exactly what it was shown.

**Acceptance criteria:**
- context() called once per script-running iteration
- custom contextName reaches the worker start message

### SW-EVENTS: Session event stream
**Applies to:** frontend-code-mode
**Test category:** unit

`createCodeModeSession(...).send(text)` shall emit, in order per iteration:
`iteration-start`, `text-delta` (per streamed chunk), `assistant-message` (with extracted
code or null), then when code runs: `script-start`, per bridged call `tool-call` +
`tool-result`, `script-end` (transcript + feedback), and finally exactly one `final` event
with reason `final-answer` | `max-iterations` | `aborted`. `send` resolves with
`{ text, reason, iterations }` where `text` is the final prose.

**Acceptance criteria:**
- two-iteration run (code then prose) → events in documented order, one `final`
- session.history grows across sends (multi-turn) and contains transcript user messages

### SW-REMOTE-TOOL: Remote (server-executed) tools
**Applies to:** frontend-code-mode
**Test category:** unit (injected fetch)

`remoteTool({ name, description, parameters, endpoint, headers?, fetchImpl? })` shall
produce a tool whose handler POSTs `{ tool, args }` as JSON (plus resolved headers) and
returns the parsed response body. A non-2xx response resolves (not throws) to
`{ ok: false, error: "Remote tool <name> failed (<status>): <body>" }` so the loop can
resubmit a useful error. Remote tools render into the prompt under a
`// Remote tools (run server-side — may take longer):` group header.

**Acceptance criteria:**
- handler POSTs to endpoint with JSON body { tool, args } and awaited headers
- 500 + body → { ok:false, error: contains status and body }; 2xx → parsed body
- buildJsApi output groups remote tools under the group header (via session prompt assembly)

### SW-BACKEND-GATE: Backend native-tool gate (integration contract)
**Applies to:** frontend-code-mode (documented), consumer backends (enforced)
**Test category:** manual (documented contract; enforced per-backend)

Every loop run shall send `forwardedProps.codeMode = true`. AG-UI backends SHOULD clear
all native tools from the run when this flag is present so the model cannot emit native
tool calls and must write JS. (lm-python-functions `_prepare_agent` already implements
this; `@sandwichts/server`'s backend never forwards tools to the LLM.)
