# SandwichTS Server Helpers — Canonical Spec

Requirement prefix: `SW-`. Package: `@sandwichts/server`. Core spec: [../core/spec.md](../core/spec.md).

### SW-TOOL-ENDPOINT: Remote-tool execution endpoint
**Applies to:** frontend-code-mode
**Test category:** unit

`createToolEndpoint(tools)` shall return a WHATWG `(req: Request) => Promise<Response>`
handler that accepts POST `{ tool, args }`, rejects unknown tool names with
`{ ok:false, error: "Unknown tool: <name>" }` (404), runs the named handler server-side,
and returns its result as JSON. Handler throws → `{ ok:false, error }` (500). Non-POST → 405.

**Acceptance criteria:**
- known tool → 200 with handler result JSON
- unknown tool → 404 envelope; handler throw → 500 envelope; GET → 405

### SW-AGUI-BACKEND: Minimal AG-UI agent backend
**Applies to:** frontend-code-mode
**Test category:** integration (mocked upstream fetch) + e2e via demo

`createAguiBackend({ apiKey, model?, emitScriptEvents? })` shall return a WHATWG handler
implementing the AG-UI HttpAgent contract: accept a `RunAgentInput` POST (threadId, runId,
messages, tools, forwardedProps), call the Anthropic Messages API (system message mapped to
the `system` param, user/assistant history mapped to `messages`, streaming), and emit an
SSE stream of AG-UI events: `RUN_STARTED`, `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT`
(per upstream delta) / `TEXT_MESSAGE_END`, `RUN_FINISHED`; upstream failure → `RUN_ERROR`.
Native tools are NEVER forwarded to the LLM (SW-BACKEND-GATE holds by construction).
With `emitScriptEvents: true`, when the completed assistant text contains a ```js block the
backend shall also emit a `CUSTOM` event `code_mode.script` with `{ code }` (SW-CODE-CHANNEL).

**Acceptance criteria:**
- RunAgentInput with system+user messages → Anthropic body has system param and mapped messages, no tools
- upstream deltas → TEXT_MESSAGE_CONTENT events between START/END, RUN_FINISHED last
- emitScriptEvents + code in reply → CUSTOM code_mode.script event with the block's body
- upstream 4xx/5xx → RUN_ERROR event carrying the upstream error text
