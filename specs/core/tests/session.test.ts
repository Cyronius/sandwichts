// Traces: SW-EVENTS, SW-CODE-CHANNEL, SW-CONTEXT, SW-PROMPT (canonical spec: specs/core/spec.md)
//
// createCodeModeSession is the public entry point: event stream order, custom
// event precedence, per-iteration context/prompt refresh, multi-turn history,
// abort, and validated handler wrapping.
import { describe, it, expect, vi } from 'vitest';
import {
    createCodeModeSession,
    buildApiSignatures,
    buildValidatedHandlers,
    type CodeModeEvent,
    type ToolMap,
} from '@sandwichts/core';
import { makeFakeClient, makeStubSandbox, asst, CODE_REPLY } from './helpers';

const TOOLS: ToolMap = {
    add_card: {
        definition: {
            name: 'add_card',
            description: 'Add a card.',
            parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
        handler: (args: any) => ({ ok: true, id: 'c1', title: args.title }),
    },
};

describe('SW-EVENTS: session event stream', () => {
    it('emits the documented order across a code iteration then a prose finish', async () => {
        const events: CodeModeEvent[] = [];
        const { client } = makeFakeClient([
            [asst('a0', CODE_REPLY('await add_card({ title: "Hi" });'))],
            [asst('a1', 'All done!')],
        ]);
        const { sandbox } = makeStubSandbox([
            { transcript: [{ name: 'add_card', args: { title: 'Hi' }, result: { ok: true } }] },
        ]);

        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
            onEvent: (e) => events.push(e),
        });

        const result = await session.send('add a card');
        expect(result).toEqual({ text: 'All done!', reason: 'final-answer', iterations: 2 });

        const types = events.map((e) => e.type);
        expect(types).toEqual([
            'iteration-start',      // 0
            'assistant-message',    // code
            'script-start',
            'script-end',
            'iteration-start',      // 1
            'assistant-message',    // prose
            'final',
        ]);
        const finals = events.filter((e) => e.type === 'final');
        expect(finals).toHaveLength(1);
        expect((finals[0] as any).reason).toBe('final-answer');

        const scriptEnd = events.find((e) => e.type === 'script-end') as any;
        expect(scriptEnd.transcript).toHaveLength(1);
        expect(scriptEnd.feedback).toContain('Executed 1 tool call(s):');
        expect(session.lastTranscript).toHaveLength(1);
    });

    it('grows history across sends and keeps transcript user-turns in it (multi-turn)', async () => {
        const { client, received } = makeFakeClient([
            [asst('a0', CODE_REPLY('await add_card({ title: "One" });'))],
            [asst('a1', 'Added.')],
            [asst('a2', 'Nothing else to do.')],
        ]);
        const { sandbox } = makeStubSandbox([{ transcript: [] }]);

        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        });

        await session.send('add one card');
        const afterFirst = session.history.map((m: any) => m.role);
        // user, assistant(code), transcript-user, assistant(prose)
        expect(afterFirst).toEqual(['user', 'assistant', 'user', 'assistant']);

        await session.send('anything else?');
        // Second send's first turn shipped the whole prior history + new user
        // message, with the (refreshed) system message at the head.
        const lastReceived = received[received.length - 1];
        expect(lastReceived[0].role).toBe('system');
        expect(lastReceived.length).toBe(1 + 4 + 1);
        expect(session.history).toHaveLength(6);
    });

    it('injects a refreshed system prompt per iteration with fresh appContext (SW-PROMPT/SW-CONTEXT)', async () => {
        let snapshot = 0;
        const { client, received } = makeFakeClient([
            [asst('a0', CODE_REPLY('await add_card({ title: "x" });'))],
            [asst('a1', 'done')],
        ]);
        const { sandbox, runs } = makeStubSandbox([{ transcript: [] }]);

        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
            prompt: {
                appContext: () => `snapshot ${++snapshot}`,
                rules: ['HOUSE RULE'],
                contextName: 'boardContext',
            },
            context: () => ({ snapshot }),
        });

        await session.send('go');

        const sys0 = received[0][0] as any;
        const sys1 = received[1][0] as any;
        expect(sys0.role).toBe('system');
        expect(sys0.content).toContain('DRIVE THE APP BY WRITING JAVASCRIPT');
        expect(sys0.content).toContain('async function add_card(args)');
        expect(sys0.content).toContain('HOUSE RULE');
        expect(sys0.content).toContain('`boardContext` is an in-scope READ-ONLY object');
        expect(sys0.content).toContain('snapshot 1');
        expect(sys1.content).toContain('snapshot 2'); // refreshed per iteration

        // The context object and binding name reached the sandbox run.
        expect(runs[0].options.contextName).toBe('boardContext');
        expect(runs[0].context).toEqual({ snapshot: 1 });
    });

    it('can leave system injection to lm-ag-ui (injectSystemMessage: false)', async () => {
        const { client, received } = makeFakeClient([[asst('a0', 'plain answer')]]);
        const { sandbox } = makeStubSandbox();
        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
            injectSystemMessage: false,
        });
        await session.send('hi');
        expect(received[0].some((m) => m.role === 'system')).toBe(false);
    });

    it('abort() surfaces reason aborted and stops further turns (SW-LOOP abort)', async () => {
        const events: CodeModeEvent[] = [];
        let sessionRef: any;
        const { client } = makeFakeClient(
            [
                [asst('a0', CODE_REPLY('await add_card({ title: "x" });'))],
                [asst('a1', 'should never be reached')],
            ],
            {
                onRun: () => { sessionRef?.abort(); }, // user hits stop mid-run
            },
        );
        const { sandbox } = makeStubSandbox([{ transcript: [] }]);

        sessionRef = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
            onEvent: (e) => events.push(e),
        });

        const result = await sessionRef.send('go');
        expect(result.reason).toBe('aborted');
        expect(client.runAgent).toHaveBeenCalledTimes(1);
        expect(client.abortRun).toHaveBeenCalled();
        expect((sandbox.abort as any)).toHaveBeenCalled();
        expect(events.filter((e) => e.type === 'final')).toHaveLength(1);
    });
});

describe('SW-CODE-CHANNEL: custom event precedence', () => {
    it('executes code from a code_mode.script CUSTOM event over the fenced text block', async () => {
        const { client } = makeFakeClient(
            [
                [asst('a0', CODE_REPLY('await add_card({ title: "FROM TEXT" });'))],
                [asst('a1', 'done')],
            ],
            {
                onRun: (_m, _t, subscriber, _f, call) => {
                    if (call === 0) {
                        subscriber.onCustomEvent?.({
                            event: { name: 'code_mode.script', value: { code: 'await add_card({ title: "FROM EVENT" });' } },
                        });
                    }
                },
            },
        );
        const { sandbox, runs } = makeStubSandbox([{ transcript: [] }]);

        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        });
        await session.send('go');

        expect(runs).toHaveLength(1);
        expect(runs[0].code).toContain('FROM EVENT');
        expect(runs[0].code).not.toContain('FROM TEXT');
    });

    it('falls back to fenced-text extraction when no custom event arrived', async () => {
        const { client } = makeFakeClient([
            [asst('a0', CODE_REPLY('await add_card({ title: "FROM TEXT" });'))],
            [asst('a1', 'done')],
        ]);
        const { sandbox, runs } = makeStubSandbox([{ transcript: [] }]);
        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
        });
        await session.send('go');
        expect(runs[0].code).toContain('FROM TEXT');
    });

    it('forwards deltas and custom events to the consumer subscriber too', async () => {
        const consumerDeltas: string[] = [];
        const consumerCustom = vi.fn();
        const deltas: string[] = [];
        const { client } = makeFakeClient(
            [[asst('a0', 'plain answer')]],
            {
                onRun: (_m, _t, subscriber) => {
                    subscriber.onTextMessageContentEvent?.({ event: { delta: 'plain ' } });
                    subscriber.onTextMessageContentEvent?.({ event: { delta: 'answer' } });
                    subscriber.onCustomEvent?.({ event: { name: 'other.event', value: 1 } });
                },
            },
        );
        const { sandbox } = makeStubSandbox();
        const session = createCodeModeSession({
            agentClient: client as any,
            tools: TOOLS,
            sandboxFactory: () => sandbox,
            subscriber: {
                onTextMessageContentEvent: (p: any) => { consumerDeltas.push(p.event.delta); },
                onCustomEvent: consumerCustom,
            } as any,
            onEvent: (e) => { if (e.type === 'text-delta') deltas.push(e.delta); },
        });
        await session.send('hi');
        expect(deltas).toEqual(['plain ', 'answer']);
        expect(consumerDeltas).toEqual(['plain ', 'answer']);
        expect(consumerCustom).toHaveBeenCalledTimes(1);
    });
});

describe('SW-JSAPI/SW-REMOTE-TOOL: session tool assembly', () => {
    it('groups remote tools under the remote header in the signatures', () => {
        const tools: ToolMap = {
            ...TOOLS,
            get_quote: {
                definition: {
                    name: 'get_quote',
                    description: 'Fetch a quote.',
                    parameters: { type: 'object', properties: {}, required: [] },
                },
                handler: async () => ({ ok: true }),
                remote: true,
            },
        };
        const signatures = buildApiSignatures(tools);
        const remoteHeaderIdx = signatures.indexOf('// Remote tools (run server-side');
        expect(remoteHeaderIdx).toBeGreaterThan(-1);
        expect(signatures.indexOf('async function add_card')).toBeLessThan(remoteHeaderIdx);
        expect(signatures.indexOf('async function get_quote')).toBeGreaterThan(remoteHeaderIdx);
    });

    it('wraps handlers with shallow arg validation returning an ok:false envelope', async () => {
        const handlers = buildValidatedHandlers(TOOLS);
        const bad = await handlers.add_card({});
        expect(bad).toMatchObject({ ok: false });
        expect((bad as any).error).toContain('missing required "title"');

        const good = await handlers.add_card({ title: 'Hello' });
        expect(good).toMatchObject({ ok: true, title: 'Hello' });

        const wrongType = await handlers.add_card({ title: 42 });
        expect((wrongType as any).error).toContain('"title" should be string');
    });
});
