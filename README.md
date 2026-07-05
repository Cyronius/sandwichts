# SandwichTS

**Browser-native CodeAct for web-app copilots.** Instead of native LLM tool calling, the
model writes one ```js block that executes in an origin-isolated browser sandbox — the
layers of the sandwich: the **iframe** (opaque origin), the **host** (your app, owning the
real tool handlers), and the **Web Worker** (kill-switch executing the generated code).
An execution transcript feeds back to the model until it answers in prose.

SandwichTS targets the case they don't: **copilots whose tools mutate
client-side state** — editors, dashboards, boards — where one generated script replaces
dozens of tool-call round trips and intermediate data never transits the model.

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

The sandbox constrains **which functions run** and **that arbitrary JS can't touch the
app** — it does not constrain what your whitelisted handlers do; they run with full app
privilege, so validate arguments (core adds a shallow schema check) and scope the tool
surface deliberately.

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


