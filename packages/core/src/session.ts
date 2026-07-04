/**
 * session — the public SandwichTS entry point (SW-EVENTS, SW-CONTEXT,
 * SW-PROMPT, SW-CODE-CHANNEL).
 *
 * A session owns: the tool registry (prompt signatures + validated sandbox
 * handlers derived from ONE definition), the system-prompt composition
 * (recomposed per iteration so the app context stays fresh), the sandbox
 * lifecycle, the multi-turn wire history across sends, and the event stream
 * consumers build display state from.
 *
 * The LLM transport is an lm-ag-ui-shaped `AgentClient` (structural — see
 * runLoop.AgentClientLike). Construct it with `sendFullHistory: true`
 * (client-owned history): the loop ships the whole conversation, including
 * its system message and transcript turns, on every send.
 */
import type { AgentSubscriber, Message } from '@ag-ui/client';
import { buildJsApi } from './prompt/jsApi';
import { composeSystemPrompt } from './prompt/compose';
import { createSandbox } from './sandbox/host';
import { runCodeModeLoop, buildSystemMessage, MAX_CODE_MODE_ITERATIONS, type AgentClientLike } from './loop/runLoop';
import { shallowValidateArgs } from './tools/validate';
import type {
    CodeModeEvent,
    Sandbox,
    SandboxHandlers,
    SendResult,
    ToolMap,
    TranscriptEntry,
} from './types';

export interface CodeModePromptConfig {
    /** Override the framework driving guide (rarely needed). */
    drivingGuide?: string;
    /** Serialized app state, re-rendered per iteration. */
    appContext?: () => string;
    /** Domain guidance blocks (styling rules, scope policy, …). */
    rules?: string[];
    /** Script-scope binding name for the context object; default 'appContext'. */
    contextName?: string;
}

export interface CodeModeSessionConfig {
    /** lm-ag-ui AgentClient (or anything satisfying AgentClientLike). */
    agentClient: AgentClientLike & { abortRun?: () => void };
    tools: ToolMap;
    prompt?: CodeModePromptConfig;
    /**
     * Prepend/refresh the composed system message at the head of the wire
     * history each iteration. Default true. Set false when the system prompt
     * is delivered another way (e.g. lm-ag-ui's systemContextBuilder — then
     * pass `buildSystemContext(config)` to it).
     */
    injectSystemMessage?: boolean;
    /** The context object bound read-only in script scope, per iteration. */
    context?: () => unknown;
    maxIterations?: number;
    /** Watchdog per script run; default 8000, raise when remote tools are exposed. */
    scriptTimeoutMs?: number;
    /** Per-result truncation in the transcript feedback; default 6000 chars. */
    maxResultChars?: number;
    /** Extra forwardedProps per run (codeMode: true is always added). */
    forwardedProps?: () => Record<string, unknown>;
    /** Consumer subscriber (e.g. lm-ag-ui's store subscriber) — merged, not replaced. */
    subscriber?: AgentSubscriber;
    onEvent?: (e: CodeModeEvent) => void;
    /** Injectable for tests; defaults to the real iframe+worker sandbox. */
    sandboxFactory?: () => Sandbox;
}

export interface CodeModeSession {
    send: (userText: string, opts?: { signal?: AbortSignal }) => Promise<SendResult>;
    /** The multi-turn wire history (system message excluded). */
    readonly history: readonly Message[];
    /** Abort the in-flight run: stops the loop, the LLM call, and the worker. */
    abort: () => void;
    /** Latest script transcript (observability / dev panels). */
    readonly lastTranscript: TranscriptEntry[] | null;
    dispose: () => void;
}

const REMOTE_GROUP_HEADER = '// Remote tools (run server-side — may take longer than the in-app calls above):';

/** Render the full signatures block: frontend tools, then a remote group. */
export function buildApiSignatures(tools: ToolMap): string {
    const frontend: ToolMap = {};
    const remote: ToolMap = {};
    for (const [name, tool] of Object.entries(tools)) {
        (tool.remote ? remote : frontend)[name] = tool;
    }
    const front = buildJsApi(frontend).signatures;
    const back = buildJsApi(remote).signatures;
    if (!back) return front;
    if (!front) return `${REMOTE_GROUP_HEADER}\n\n${back}`;
    return `${front}\n\n${REMOTE_GROUP_HEADER}\n\n${back}`;
}

/** Wrap each tool handler with shallow schema validation (SW-JSAPI/SW-SANDBOX seam). */
export function buildValidatedHandlers(tools: ToolMap): SandboxHandlers {
    const handlers: SandboxHandlers = {};
    for (const [name, tool] of Object.entries(tools)) {
        handlers[name] = (args: unknown) => {
            const problem = shallowValidateArgs(tool.definition?.parameters, args);
            if (problem) return { ok: false, error: `${name}: ${problem}` };
            return tool.handler(args);
        };
    }
    return handlers;
}

/** Compose the current system-context string (for lm-ag-ui systemContextBuilder wiring). */
export function buildSystemContext(
    config: Pick<CodeModeSessionConfig, 'tools' | 'prompt'>,
): string {
    return composeSystemPrompt({
        drivingGuide: config.prompt?.drivingGuide,
        signatures: buildApiSignatures(config.tools),
        contextName: config.prompt?.contextName,
        appContext: config.prompt?.appContext?.(),
        rules: config.prompt?.rules,
    });
}

export function createCodeModeSession(config: CodeModeSessionConfig): CodeModeSession {
    const {
        agentClient,
        tools,
        prompt,
        injectSystemMessage = true,
        context,
        maxIterations = MAX_CODE_MODE_ITERATIONS,
        scriptTimeoutMs,
        maxResultChars,
        forwardedProps,
        subscriber,
        onEvent,
        sandboxFactory = createSandbox,
    } = config;

    const handlers = buildValidatedHandlers(tools);

    let history: Message[] = [];
    let sandbox: Sandbox | null = null;
    let aborted = false;
    let running = false;
    let disposed = false;
    let sendCounter = 0;
    let lastTranscript: TranscriptEntry[] | null = null;

    // SW-CODE-CHANNEL: a backend may push the script via a CUSTOM event
    // instead of (or alongside) the fenced text block. Captured per run,
    // taken-and-cleared per iteration.
    let customCode: string | null = null;
    const sessionSubscriber: AgentSubscriber = {
        ...subscriber,
        onTextMessageContentEvent(params: any) {
            const delta = params?.event?.delta;
            if (typeof delta === 'string' && delta) onEvent?.({ type: 'text-delta', delta });
            return (subscriber as any)?.onTextMessageContentEvent?.(params);
        },
        onCustomEvent(params: any) {
            if (params?.event?.name === 'code_mode.script') {
                const code = params?.event?.value?.code;
                if (typeof code === 'string' && code.trim()) customCode = code;
            }
            return (subscriber as any)?.onCustomEvent?.(params);
        },
    } as AgentSubscriber;

    const getSystemMessage = injectSystemMessage
        ? () => buildSystemMessage(buildSystemContext({ tools, prompt }))
        : undefined;

    const getSandbox = () => {
        sandbox ??= sandboxFactory();
        return sandbox;
    };

    const abort = () => {
        aborted = true;
        (agentClient as { abortRun?: () => void }).abortRun?.();
        sandbox?.abort();
    };

    const send = async (userText: string, opts?: { signal?: AbortSignal }): Promise<SendResult> => {
        if (disposed) throw new Error('Session disposed');
        if (running) throw new Error('A send is already in flight — await it or abort first.');
        running = true;
        aborted = false;
        customCode = null;
        const onSignalAbort = () => abort();
        opts?.signal?.addEventListener('abort', onSignalAbort, { once: true });

        try {
            const userMessage = {
                id: `sandwich_user_${++sendCounter}`,
                role: 'user',
                content: userText,
            } as unknown as Message;

            const result = await runCodeModeLoop([...history, userMessage], {
                agentClient,
                subscriber: sessionSubscriber,
                handlers,
                sandbox: getSandbox(),
                getForwardedProps: forwardedProps,
                getContext: context,
                contextName: prompt?.contextName,
                getSystemMessage,
                maxIterations,
                timeoutMs: scriptTimeoutMs,
                maxResultChars,
                isAborted: () => aborted || !!opts?.signal?.aborted,
                takeCustomCode: () => {
                    const code = customCode;
                    customCode = null;
                    return code;
                },
                onEvent: (e) => {
                    if (e.type === 'script-end') lastTranscript = e.transcript;
                    onEvent?.(e);
                },
            });

            // Persist the multi-turn wire history (system message excluded —
            // it is recomposed fresh on the next send).
            history = result.conversation.filter((m) => m.id !== 'sandwich_system');
            return { text: result.text, reason: result.reason, iterations: result.iterations };
        } finally {
            running = false;
            opts?.signal?.removeEventListener('abort', onSignalAbort);
        }
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        abort();
        sandbox?.dispose();
        sandbox = null;
    };

    return {
        send,
        get history() { return history; },
        abort,
        get lastTranscript() { return lastTranscript; },
        dispose,
    };
}
