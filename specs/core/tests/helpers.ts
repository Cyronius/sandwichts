// Shared fakes for loop/session tests: a scripted lm-ag-ui-shaped agent
// client and a stub sandbox (the real one needs browser primitives).
import { vi } from 'vitest';
import type { RunScriptResult, Sandbox } from '@sandwichts/core';

export type Msg = { id: string; role: string; content: string };

export interface FakeClientOptions {
    /** Called during each runAgent with (messages, tools, subscriber, forwardedProps). */
    onRun?: (messages: Msg[], tools: unknown[], subscriber: any, forwardedProps: any, call: number) => void;
}

export function makeFakeClient(responses: Msg[][], opts: FakeClientOptions = {}) {
    const received: Msg[][] = [];
    const forwarded: any[] = [];
    let call = 0;
    const client = {
        startNewRun: vi.fn(),
        abortRun: vi.fn(),
        runAgent: vi.fn(async (messages: Msg[], tools: unknown[], subscriber: any, forwardedProps: any) => {
            received.push(messages.map((m) => ({ ...m })));
            forwarded.push(forwardedProps);
            opts.onRun?.(messages, tools, subscriber, forwardedProps, call);
            const newMessages = responses[call] ?? [];
            call += 1;
            return { newMessages };
        }),
    };
    return { client, received, forwarded };
}

export function makeStubSandbox(results: RunScriptResult[] = []) {
    const runs: Array<{ code: string; handlers: Record<string, unknown>; context: unknown; options: any }> = [];
    let call = 0;
    const sandbox: Sandbox = {
        runScript: async (code, handlers, context, options) => {
            runs.push({ code, handlers, context, options });
            const result = results[call] ?? { transcript: [], error: undefined };
            call += 1;
            // Surface tool events the way the real host does when asked.
            return result;
        },
        abort: vi.fn(),
        dispose: vi.fn(),
    };
    return { sandbox, runs };
}

export const asst = (id: string, content: string): Msg => ({ id, role: 'assistant', content });
export const user = (id: string, content: string): Msg => ({ id, role: 'user', content });

export const CODE_REPLY = (code: string) => 'On it.\n```js\n' + code + '\n```';
