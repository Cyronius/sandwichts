/**
 * Shared types for the SandwichTS core. Tool shapes are STRUCTURAL mirrors of
 * `@itkennel/lm-ag-ui`'s `StandardTool` so lm-ag-ui tool definitions plug in
 * without importing that package here — core has no runtime dependencies.
 */

/** OpenAI-compatible JSON-schema parameter block (the lm-ag-ui wire shape). */
export interface ToolSchema {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
}

/** One tool's prompt-facing definition (mirrors lm-ag-ui `StandardTool`). */
export interface ToolSpec {
    name: string;
    description: string;
    parameters: ToolSchema;
}

/**
 * A sandbox tool handler. Runs in the HOST (with full app privilege) when the
 * model's script calls the stub of the same name. The return value crosses to
 * the worker via structured clone — return plain JSON-serializable data.
 * lm-ag-ui `ToolHandler`s take extra state args; wrap them:
 * `(args) => handler(args, noopUpdate, noopGet)`.
 */
export type ToolHandler = (args: any) => unknown | Promise<unknown>;

/** One registered code-mode tool: prompt definition + host-side handler. */
export interface CodeModeTool {
    definition: ToolSpec;
    handler: ToolHandler;
    /** True for server-executed tools (rendered under the remote group header). */
    remote?: boolean;
}

/** The full tool registry a session exposes to generated code. */
export type ToolMap = Record<string, CodeModeTool>;

/** Handler map keyed by function name — the sandbox whitelist IS these keys. */
export type SandboxHandlers = Record<string, ToolHandler>;

/** A single bridged tool call recorded by the worker. */
export interface TranscriptEntry {
    name: string;
    args: unknown;
    /** The handler result; absent if the script threw before it resolved. */
    result?: unknown;
}

export interface RunScriptResult {
    transcript: TranscriptEntry[];
    /** Present when the script threw, the worker failed to spawn, or the watchdog fired. */
    error?: string;
}

export interface RunScriptOptions {
    /** Watchdog for this run; default 8000 ms (raise when remote tools are exposed). */
    timeoutMs?: number;
    /** Name of the read-only context binding in script scope; default 'appContext'. */
    contextName?: string;
    onToolCall?: (name: string, args: unknown) => void;
    onToolResult?: (name: string, args: unknown, result?: unknown, error?: string) => void;
}

export interface Sandbox {
    runScript: (
        code: string,
        handlers: SandboxHandlers,
        context?: unknown,
        options?: RunScriptOptions,
    ) => Promise<RunScriptResult>;
    dispose: () => void;
}

/** Loop-produced wire message (assignable to ag-ui `Message` at the call site). */
export interface TranscriptMessage {
    id: string;
    role: 'user';
    content: string;
}

export type FinalReason = 'final-answer' | 'max-iterations' | 'aborted';

export type CodeModeEvent =
    | { type: 'iteration-start'; iteration: number }
    | { type: 'text-delta'; delta: string }
    | { type: 'assistant-message'; text: string; code: string | null }
    | { type: 'script-start'; iteration: number; code: string }
    | { type: 'tool-call'; name: string; args: unknown }
    | { type: 'tool-result'; name: string; args: unknown; result?: unknown; error?: string }
    | { type: 'script-end'; transcript: TranscriptEntry[]; error?: string; feedback: string }
    | { type: 'final'; text: string; reason: FinalReason };

export interface SendResult {
    /** The final prose answer (last assistant text with no code block). */
    text: string;
    reason: FinalReason;
    iterations: number;
}
