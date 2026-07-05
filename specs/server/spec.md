# SandwichTS Server Helpers — Canonical Spec

Requirement prefix: `SW-`. Package: `@sandwichts/server`. Core spec: [../core/spec.md](../core/spec.md).

### SW-TOOL-ENDPOINT: Remote-tool execution endpoint
**Applies to:** sandwichts
**Test category:** unit

`createToolEndpoint(tools)` shall return a WHATWG `(req: Request) => Promise<Response>`
handler that accepts POST `{ tool, args }`, rejects unknown tool names with
`{ ok:false, error: "Unknown tool: <name>" }` (404), runs the named handler server-side,
and returns its result as JSON. Handler throws → `{ ok:false, error }` (500). Non-POST → 405.

**Acceptance criteria:**
- known tool → 200 with handler result JSON
- unknown tool → 404 envelope; handler throw → 500 envelope; GET → 405

### SW-AGUI-BACKEND: Minimal AG-UI agent backend (OpenAI-compatible upstream)
**Applies to:** sandwichts
**Test category:** integration (mocked upstream fetch) + e2e via demo

`createAguiBackend({ model, baseUrl?, apiKey?, emitScriptEvents? })` shall return a WHATWG
handler implementing the AG-UI HttpAgent contract over any **OpenAI-compatible Chat
Completions API** (the de facto abstraction: OpenAI, Ollama, LM Studio, llama.cpp, vLLM,
OpenRouter): accept a `RunAgentInput` POST (threadId, runId, messages, tools,
forwardedProps), POST `${baseUrl}/chat/completions` with `{ model, messages, stream:true }`
— system messages inline in `messages`, consecutive same-role turns merged, tool/unknown
roles dropped — and emit an SSE stream of AG-UI events: `RUN_STARTED`,
`TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` (per `choices[0].delta.content`) /
`TEXT_MESSAGE_END`, `RUN_FINISHED`; upstream failure → `RUN_ERROR`. `baseUrl` defaults to
`https://api.openai.com/v1`; `apiKey` is OPTIONAL (Bearer header only when present — local
servers need none). Native tools are NEVER forwarded to the LLM (SW-BACKEND-GATE holds by
construction). With `emitScriptEvents: true`, when the completed assistant text contains a
```js block the backend shall also emit a `CUSTOM` event `code_mode.script` with `{ code }`
(SW-CODE-CHANNEL).

**Acceptance criteria:**
- RunAgentInput with system+user messages → upstream body has inline system message, mapped history, `stream:true`, no tools
- upstream `choices[0].delta.content` deltas → TEXT_MESSAGE_CONTENT between START/END, RUN_FINISHED last; `data: [DONE]` tolerated
- no apiKey → no Authorization header; apiKey set → `Authorization: Bearer <key>`
- custom baseUrl (e.g. `http://localhost:11434/v1`) → request goes to `<baseUrl>/chat/completions`
- emitScriptEvents + code in reply → CUSTOM code_mode.script event with the block's body
- upstream 4xx/5xx → RUN_ERROR event carrying the upstream error text
