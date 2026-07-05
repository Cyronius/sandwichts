# SandwichTS React Bindings — Canonical Spec

Requirement prefix: `SW-`. Package: `@sandwichts/react`. Core spec: [../core/spec.md](../core/spec.md).

### SW-REACT-CHAT: useCodeModeChat hook
**Applies to:** sandwichts
**Test category:** unit (happy-dom + fake AgentClient + stub sandbox)

`useCodeModeChat(config)` shall own one `CodeModeSession` (created lazily, disposed on
unmount) and derive ALL chat state from session events — no loop logic re-implemented:
`messages` (user + assistant DisplayMessages), `streamingText` (current run's raw stream,
'' when idle), `status` ('idle' | 'streaming' | 'executing' | 'error'), `running` (true
across the whole multi-iteration loop), `send`, `abort`, `error`, `lastTranscript`.

**Acceptance criteria:**
- send() appends the user message immediately and sets running=true until `final`
- assistant messages appear per iteration with codeBlocks/hasProse computed
- status is 'executing' between script-start and script-end, 'streaming' during deltas
- unmount disposes the session (sandbox iframe removed)

### SW-REACT-HIDE: Code hiding in chat display
**Applies to:** sandwichts
**Test category:** unit

DisplayMessages shall carry `hasProse` (via `hasVisibleProse`) and `codeBlocks` (via
`extractFencedBlocks`). Consumers render code-only messages as suppressed bubbles (typing
dots while streaming); with `devReveal` (default: localStorage `sandwichShowCode`) the raw
blocks are available for a developer code-peek disclosure. Transcript feedback messages
(wire-only) never appear in `messages`.

**Acceptance criteria:**
- assistant message that is only a ```js block → hasProse=false, codeBlocks.length=1
- transcript user-turns from the loop are absent from messages

### SW-REACT-ABORT: Abort control
**Applies to:** sandwichts
**Test category:** unit

`abort()` shall stop the loop (session reason `aborted`), reset `running` to false, and
leave already-committed messages intact.
