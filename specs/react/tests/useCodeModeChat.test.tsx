// @vitest-environment happy-dom
// Traces: SW-REACT-CHAT, SW-REACT-HIDE, SW-REACT-ABORT (canonical spec: specs/react/spec.md)
//
// useCodeModeChat derives all chat state from session events over a fake
// agent client + stub sandbox (the real sandbox needs browser primitives that
// happy-dom lacks).
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCodeModeChat } from '@sandwichts/react';
import type { RunScriptResult, Sandbox, ToolMap } from '@sandwichts/core';

type Msg = { id: string; role: string; content: string };
const asst = (id: string, content: string): Msg => ({ id, role: 'assistant', content });
const CODE_REPLY = (code: string) => '```js\n' + code + '\n```';

const TOOLS: ToolMap = {
    add_card: {
        definition: {
            name: 'add_card',
            description: 'Add a card.',
            parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
        handler: (args: any) => ({ ok: true, title: args.title }),
    },
};

function makeFakeClient(responses: Msg[][]) {
    let call = 0;
    return {
        startNewRun: vi.fn(),
        abortRun: vi.fn(),
        runAgent: vi.fn(async () => {
            const newMessages = responses[call] ?? [];
            call += 1;
            return { newMessages };
        }),
    };
}

function makeStubSandbox(results: RunScriptResult[] = [], gate?: Promise<void>) {
    let call = 0;
    const dispose = vi.fn();
    const sandbox: Sandbox = {
        runScript: async () => {
            if (gate) await gate;
            const result = results[call] ?? { transcript: [] };
            call += 1;
            return result;
        },
        abort: vi.fn(),
        dispose,
    };
    return { sandbox, dispose };
}

describe('SW-REACT-CHAT: useCodeModeChat', () => {
    it('appends the user message immediately, streams the loop, and lands the prose answer', async () => {
        const client = makeFakeClient([
            [asst('a0', CODE_REPLY('await add_card({ title: "One" });'))],
            [asst('a1', 'Card added!')],
        ]);
        const { sandbox } = makeStubSandbox([
            { transcript: [{ name: 'add_card', args: { title: 'One' }, result: { ok: true } }] },
        ]);

        const { result } = renderHook(() => useCodeModeChat({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        }));

        let sendPromise: Promise<void>;
        act(() => { sendPromise = result.current.send('add a card'); });

        // User message committed synchronously; loop running.
        expect(result.current.messages[0]).toMatchObject({ role: 'user', text: 'add a card' });
        expect(result.current.running).toBe(true);

        await act(async () => { await sendPromise!; });

        expect(result.current.running).toBe(false);
        expect(result.current.status).toBe('idle');

        // SW-REACT-HIDE: the code turn has no prose and one code block; the
        // final prose turn renders; NO transcript user-turns leak into chat.
        const roles = result.current.messages.map((m) => `${m.role}:${m.hasProse}`);
        expect(roles).toEqual(['user:true', 'assistant:false', 'assistant:true']);
        expect(result.current.messages[1].codeBlocks).toHaveLength(1);
        expect(result.current.messages[2].text).toBe('Card added!');
        expect(result.current.messages).toHaveLength(3);
        expect(result.current.lastTranscript).toHaveLength(1);
    });

    it("is 'executing' while a script runs, back to streaming/idle after", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const client = makeFakeClient([
            [asst('a0', CODE_REPLY('await add_card({ title: "x" });'))],
            [asst('a1', 'done')],
        ]);
        const { sandbox } = makeStubSandbox([{ transcript: [] }], gate);

        const { result } = renderHook(() => useCodeModeChat({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        }));

        let sendPromise: Promise<void>;
        act(() => { sendPromise = result.current.send('go'); });

        await waitFor(() => expect(result.current.status).toBe('executing'));
        act(() => release());
        await act(async () => { await sendPromise!; });
        expect(result.current.status).toBe('idle');
    });

    it('disposes the session (and sandbox) on unmount', async () => {
        const client = makeFakeClient([[asst('a0', 'hi')]]);
        const { sandbox, dispose } = makeStubSandbox();
        const { result, unmount } = renderHook(() => useCodeModeChat({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        }));
        await act(async () => { await result.current.send('hello'); });
        unmount();
        expect(dispose).toHaveBeenCalled();
    });

    it('surfaces send failures as error status without dropping messages', async () => {
        const client = {
            startNewRun: vi.fn(),
            abortRun: vi.fn(),
            runAgent: vi.fn(async () => { throw new Error('network down'); }),
        };
        const { sandbox } = makeStubSandbox();
        const { result } = renderHook(() => useCodeModeChat({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        }));
        await act(async () => { await result.current.send('hello'); });
        expect(result.current.status).toBe('error');
        expect(String(result.current.error)).toContain('network down');
        expect(result.current.messages).toHaveLength(1); // the user message survives
        expect(result.current.running).toBe(false);
    });
});

describe('SW-REACT-ABORT: abort control', () => {
    it('stops the loop, resets running, keeps committed messages', async () => {
        let hookRef: any;
        const client = {
            startNewRun: vi.fn(),
            abortRun: vi.fn(),
            runAgent: vi.fn(async () => {
                hookRef.abort(); // user presses Stop mid-run
                return { newMessages: [asst('a0', CODE_REPLY('await add_card({ title: "x" });'))] };
            }),
        };
        const { sandbox } = makeStubSandbox([{ transcript: [] }]);
        const { result } = renderHook(() => useCodeModeChat({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        }));
        hookRef = result.current;

        await act(async () => { await result.current.send('go'); });

        expect(client.runAgent).toHaveBeenCalledTimes(1); // no second turn
        expect(result.current.running).toBe(false);
        expect(result.current.messages[0].role).toBe('user'); // intact
        expect(client.abortRun).toHaveBeenCalled();
    });
});
