/**
 * runLoop — the agentic code-mode loop (SW-LOOP, SW-CODE-CHANNEL).
 *
 * Layered over an lm-ag-ui-shaped `agentClient.runAgent` with an EMPTY tool
 * list, so the model emits plain assistant text (a ```js block) instead of
 * native JSON tool calls. Per iteration:
 *   1. runAgent(conversation, []) → assistant text
 *   2. take the iteration's code: a `code_mode.script` CUSTOM event when the
 *      backend emitted one, else extractCode() over the assistant text;
 *      none → final answer, stop
 *   3. runScript() the code in the iframe+worker sandbox against the
 *      whitelisted handlers
 *   4. format the execution transcript as a user message, append it to the
 *      loop-local `conversation` (the wire history) + resubmit
 * Stops at the first iteration with no code, on the iteration cap, or on
 * abort. Transcript messages live ONLY in the loop-local conversation — they
 * are never pushed into any shared display store (that raced the streamed
 * assistant commit in lm-admin; display state is built from events instead).
 *
 * `AgentClientLike` is structural — `@itkennel/lm-ag-ui`'s `AgentClient`
 * satisfies it, and tests inject a scripted fake.
 */
import type { AgentSubscriber, Message } from '@ag-ui/client';
import { extractCode } from './extractCode';
import { extractFinalAssistantText } from './messageText';
import { logCodeEmission } from '../logCode';
import { buildTranscriptMessage } from './transcript';
import type { CodeModeEvent, FinalReason, Sandbox, SandboxHandlers } from '../types';

// Bound how many code→execute→resubmit round-trips one user request can
// drive before we force a stop. A code-mode turn collapses many JSON
// round-trips into one script, so it needs far fewer iterations than a
// native-tool-calling turn budget.
export const MAX_CODE_MODE_ITERATIONS = 8;

export interface AgentClientLike {
    runAgent: (
        messages: Message[],
        tools: unknown[],
        subscriber: AgentSubscriber,
        forwardedProps?: Record<string, unknown>,
    ) => Promise<{ newMessages: Message[] }>;
    startNewRun: () => unknown;
}

export interface CodeModeLoopDeps {
    agentClient: AgentClientLike;
    subscriber: AgentSubscriber;
    /** The whitelisted tool handlers exposed to the sandbox. */
    handlers: SandboxHandlers;
    /** Owns the sandbox for this loop run (created once, reused per iteration). */
    sandbox: Sandbox;
    getForwardedProps?: () => Record<string, unknown>;
    /**
     * Returns the turn's context object, bound read-only in script scope.
     * Called per iteration so the snapshot reflects edits the previous
     * iteration applied (SW-CONTEXT).
     */
    getContext?: () => unknown;
    contextName?: string;
    /**
     * Re-derives the system message at the head of the wire conversation per
     * iteration (fresh app context after edits). Receives the conversation
     * WITHOUT any previous system message and returns the message to prepend,
     * or null for none.
     */
    getSystemMessage?: () => Message | null;
    maxIterations?: number;
    timeoutMs?: number;
    maxResultChars?: number;
    /** Returns true once the user has stopped the run; checked between steps. */
    isAborted?: () => boolean;
    /**
     * Take-and-clear the code delivered via a `code_mode.script` CUSTOM event
     * during the last runAgent (SW-CODE-CHANNEL). Wired by the session's
     * subscriber; takes precedence over fenced-block extraction.
     */
    takeCustomCode?: () => string | null;
    onEvent?: (e: CodeModeEvent) => void;
}

export interface LoopResult {
    /** The full wire history after the loop (incl. transcript user-turns). */
    conversation: Message[];
    /** The final assistant prose (empty when aborted before any reply). */
    text: string;
    reason: FinalReason;
    iterations: number;
}

const SYSTEM_MESSAGE_ID = 'sandwich_system';

/** Build the (possibly refreshed) wire conversation for the next turn. */
function withSystemMessage(conversation: Message[], getSystemMessage?: () => Message | null): Message[] {
    if (!getSystemMessage) return conversation;
    const rest = conversation.filter((m) => m.id !== SYSTEM_MESSAGE_ID);
    const system = getSystemMessage();
    return system ? [system, ...rest] : rest;
}

export function buildSystemMessage(content: string): Message {
    return { id: SYSTEM_MESSAGE_ID, role: 'system', content } as unknown as Message;
}

/**
 * Drive the code-mode loop to completion. Resolves when the model stops
 * emitting code, the iteration cap is hit, or the run is aborted. Throws only
 * on an unrecoverable runAgent error.
 */
export async function runCodeModeLoop(
    initialMessages: Message[],
    deps: CodeModeLoopDeps,
): Promise<LoopResult> {
    const {
        agentClient,
        subscriber,
        handlers,
        sandbox,
        getForwardedProps,
        getContext,
        contextName,
        getSystemMessage,
        maxIterations = MAX_CODE_MODE_ITERATIONS,
        timeoutMs,
        maxResultChars,
        isAborted,
        takeCustomCode,
        onEvent,
    } = deps;

    let conversation = [...initialMessages];
    let lastText = '';
    let reason: FinalReason = 'max-iterations';
    let iterations = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (isAborted?.()) { reason = 'aborted'; break; }
        iterations = iteration + 1;
        onEvent?.({ type: 'iteration-start', iteration });

        agentClient.startNewRun();
        conversation = withSystemMessage(conversation, getSystemMessage);
        const { newMessages } = await agentClient.runAgent(
            conversation,
            [], // empty native tool list → the model must write JS (SW-BACKEND-GATE)
            subscriber,
            { ...(getForwardedProps?.() ?? {}), codeMode: true },
        );
        conversation = [...conversation, ...newMessages];
        lastText = extractFinalAssistantText(newMessages as Array<{ role?: string; content?: unknown }>);

        // CUSTOM event takes precedence over fenced-text extraction
        // (SW-CODE-CHANNEL); both feed the same execution path.
        const customCode = takeCustomCode?.() || null;
        const code = customCode ?? extractCode(lastText);
        onEvent?.({ type: 'assistant-message', text: lastText, code });
        if (code) logCodeEmission(code, iteration);

        if (isAborted?.()) { reason = 'aborted'; break; }
        if (!code) { reason = 'final-answer'; break; } // prose → final answer

        onEvent?.({ type: 'script-start', iteration, code });
        const { transcript, error } = await sandbox.runScript(code, handlers, getContext?.(), {
            timeoutMs,
            contextName,
            onToolCall: (name, args) => onEvent?.({ type: 'tool-call', name, args }),
            onToolResult: (name, args, result, err) =>
                onEvent?.({ type: 'tool-result', name, args, result, error: err }),
        });

        if (isAborted?.()) { reason = 'aborted'; break; }

        const resultMessage = buildTranscriptMessage(
            transcript,
            error,
            iteration,
            Object.keys(handlers),
            maxResultChars,
        );
        onEvent?.({ type: 'script-end', transcript, error, feedback: resultMessage.content });
        // Wire-only: the transcript rides the loop-local conversation, never a
        // shared display store (SW-LOOP).
        conversation = [...conversation, resultMessage as unknown as Message];
    }

    onEvent?.({ type: 'final', text: lastText, reason });
    return { conversation, text: lastText, reason, iterations };
}
