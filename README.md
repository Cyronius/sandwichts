# SandwichTS

**Give an in-app copilot real, mutating access to your app's live client-side state — safely.**

Most tool-calling is built for stateless, server-side actions: one call, one round trip, one JSON result.
That breaks down for copilots embedded in editors, dashboards, and boards, where the "tools" are direct
mutations of state that only exists in the browser, and a single user request can need dozens of them
chained together. Native tool-calling pays a model round trip for every one — and every intermediate result,
even ones the model never needs to reason about, flows back through the model's context.

SandwichTS has the model write one JS script that calls your tools directly and returns only the final
transcript. The idea of a model writing code instead of calling tools one at a time isn't new (see CodeAct) —
what's different here is the threat model: this isn't about containing generated code in a server-side
VM, it's about letting generated code invoke functions with full application privilege against live,
mutating client state, while the code itself can't touch anything else — no DOM, no storage, no network,
no shared origin. Three layers do that: the **iframe** (opaque origin), the **host** (your app, owning the
real tool handlers), and the **Web Worker** (kill-switch executing the generated code) — the layers of the
sandwich. An execution transcript feeds back to the model until it answers in prose.

```
┌─ your app (host) ──────────────────────────────────────────────┐
│  tools: { get_board, add_card, … }   ← full app privilege      │
│  session ──► lm-ag-ui AgentClient ──► your AG-UI backend ─► LLM│
│     │  ```js block (or code_mode.script CUSTOM event)          │
│     ▼                                                          │
│  ┌─ iframe sandbox="allow-scripts" (opaque origin, CSP) ─────┐ │
│  │   └─ Worker (blob URL, fresh per run)                     │ │
│  │       new AsyncFunction(code)(frozenContext, …stubs)      │ │
│  │       stub(args) ─ MessagePort RPC ─► host handler        │ │
│  └───────────────────── worker.terminate() on watchdog ──────┘ │
└────────────────────────────────────────────────────────────────┘
```

## Why

- **One script, not N round trips.** A task touching a dozen cards/cells/nodes is one generated script and
  one execution — not a dozen model turns. Lower latency, lower cost, and the intermediate values between
  "read current state" and "compute the change" never re-enter the model's context.
- **Works with your existing backend, unmodified.** The client sends an empty native tool list and a
  `codeMode` flag. If your AG-UI backend ignores that, the model's ```js block still gets extracted from its
  prose reply and executed — no backend change required. A backend that wants a faster path can instead emit
  a `code_mode.script` CUSTOM event; same client either way.
- **Self-correcting, not just self-executing.** An undefined tool name, a bad argument, or a failed remote
  tool doesn't throw and abort the run — it comes back as a transcript entry the model sees on its next turn
  (`Unknown function: X. Available functions: ...`), so most mistakes get fixed inside the same run instead
  of surfacing to the user.
- **No agent framework, no vendor lock-in.** `@sandwichts/core` has zero runtime dependencies
  (`@ag-ui/client` is types-only); `@sandwichts/server` is a couple of WHATWG handlers over any
  OpenAI-compatible Chat Completions API (OpenAI, Ollama, LM Studio, vLLM, OpenRouter).
- **Code is an implementation detail.** The default chat UI hides the generated script; a dev-only "code
  peek" flag reveals it. Users see a copilot, not a code interpreter.

## Packages

| Package | What it is |
|---|---|
| `@sandwichts/core` | The engine: sandbox host + worker runtime, agentic loop, prompt rendering (`buildJsApi`, driving guide), session + events, `remoteTool`. Zero runtime deps; `@ag-ui/client` types only. |
| `@sandwichts/react` | `useCodeModeChat` — event-driven chat state, code hiding, dev code peek. |
| `@sandwichts/server` | WHATWG handlers: `createToolEndpoint` (remote-tool RPC) and `createAguiBackend` (minimal AG-UI SSE backend over any OpenAI-compatible Chat Completions API — OpenAI, Ollama, LM Studio, vLLM, OpenRouter — for demos/quick starts). |
| `apps/demo` | TaskBoard — a kanban board driven end-to-end by code mode. The e2e verification artifact. |

## Quick start

```powershell
pnpm install
pnpm build
pnpm test                 # 80+ unit tests over specs/**/tests
pnpm dev                  # demo at http://localhost:5173
```

Demo modes: `?mock=1` (scripted model, offline, deterministic), default (live model —
copy `apps/demo/.env.example` to `.env` and point it at OpenAI or a local LM via
`SANDWICH_BASE_URL`/`SANDWICH_MODEL`/`OPENAI_API_KEY`), `?customEvent=1` (backend emits
`code_mode.script` CUSTOM events), `?playground=1` (raw sandbox scenarios).

## Usage

```ts
import { createCodeModeSession, remoteTool } from '@sandwichts/core';
import { AgentClient } from '@itkennel/lm-ag-ui';

const session = createCodeModeSession({
    agentClient: new AgentClient(baseUrl, agentId, { sendFullHistory: true }),
    tools: {
        add_card: {
            definition: { name: 'add_card', description: 'Add a card.', parameters: { /* JSON schema */ } },
            handler: (args) => store.addCard(args),      // runs with app privilege
        },
        search_kb: remoteTool({ name: 'search_kb', /* … */ }),  // server round-trip
    },
    prompt: {
        appContext: () => JSON.stringify(buildContext()), // re-rendered per iteration
        contextName: 'appContext',                        // in-scope binding name
        rules: ['domain guidance blocks…'],
    },
    context: buildContext,                                // frozen, bound in script scope
    onEvent: (e) => { /* text-delta | tool-call | script-end | final … */ },
});

const { text, reason } = await session.send('Add three pastel cards to Doing');
```

React: `useCodeModeChat({ ...sameConfig })` → `{ messages, streamingText, status, running, send, abort, lastTranscript }`.

## Backend contract (SW-BACKEND-GATE)

Every run is sent with an **empty native tool list** and `forwardedProps.codeMode = true`.
Your AG-UI backend SHOULD clear any native tools when it sees that flag so the model must
write JS (lm-python-functions already does this). Optionally, a backend may extract the
```js block server-side and emit an AG-UI `CUSTOM` event `code_mode.script` with
`{ code }` — the client prefers it over text extraction, but text extraction always works
with an unmodified backend.

## Security model

The sandbox's job is to give the *generated code* as close to zero privilege as possible —
it can only call the whitelisted stub functions you hand it. The *handlers* those stubs call
run with full app privilege against real, live state, so validate their arguments (core adds
a shallow schema check) and scope the tool surface deliberately.

Guarantees: opaque-origin iframe (`sandbox="allow-scripts"`, no `allow-same-origin`) — no
app DOM/cookies/storage; per-run blob-URL worker killed by a watchdog; per-run
`MessageChannel` (no window broadcast, no cross-sandbox crosstalk); pinned targetOrigin +
per-sandbox nonce on the window channel; deep-frozen context; transcript size caps; and a
srcdoc CSP (`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:;
worker-src blob:`). **The CSP is the network boundary** — `fetch` exists in worker scope
and only the CSP blocks it (verified in the playground; lm-admin's original had no CSP).

**Consumer CSP caveat:** srcdoc iframes inherit the embedding page's CSP. If your app
ships a strict CSP, the sandbox needs `script-src 'unsafe-eval' blob:` and
`worker-src blob:` to run (`AsyncFunction` + blob workers). Without that, host the
sandbox document on a separate origin (future work).

## Specs & tests

Spec-driven: every behavior traces to an `SW-*` requirement in `specs/*/spec.md`, verified
by a unit test (`specs/*/tests/*.test.ts`, Vitest) or a documented e2e procedure
(`sandbox.manual.test.ts`, `specs/demo/spec.md`; `specs/demo/tests/taskboard.e2e.py` is a
Playwright script for the deterministic `?mock=1` flows).


