// Traces: SW-LOOP (canonical spec: specs/core/spec.md)
//
// Message-order regression, ported from lm-admin's codeModeLoopOrder.test.ts.
// The loop drives several runAgent turns per user request and, between turns,
// builds an execution-transcript message. That transcript must live ONLY in
// the loop-local conversation (the wire history) — each subsequent runAgent
// receives the prior messages in strict generation order [user,
// assistant(code), result], and the loop exposes no shared-store writer.
// Also pins the SW-BACKEND-GATE wire contract: empty native tool list +
// forwardedProps.codeMode === true on every turn.
import { describe, it, expect } from 'vitest';
import { runCodeModeLoop, CODE_RESULT_ID_PREFIX } from '@sandwichts/core';
import { makeFakeClient, makeStubSandbox, asst, user, CODE_REPLY } from './helpers';

describe('SW-LOOP: code-mode loop message ordering', () => {
    it('sends each turn the prior messages in [user, assistant(code), result] order', async () => {
        const u = user('user_1', 'rewrite the first heading');
        const a0 = asst('asst_0', CODE_REPLY('await noop({});'));
        const a1 = asst('asst_1', 'Done — heading updated.');

        const { client, received } = makeFakeClient([[a0], [a1]]);
        const { sandbox } = makeStubSandbox();

        const result = await runCodeModeLoop([u] as any, {
            agentClient: client as any,
            subscriber: {} as any,
            handlers: { noop: () => ({ ok: true }) },
            sandbox,
        });

        // Two runAgent turns: the code turn, then the closing prose turn.
        expect(client.runAgent).toHaveBeenCalledTimes(2);

        // Turn 0 saw only the user message.
        expect(received[0].map((m) => m.id)).toEqual(['user_1']);

        // Turn 1 saw the user message, the assistant's code turn, then the
        // execution transcript — in that exact order (the regression).
        expect(received[1].map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
        expect(received[1][0].id).toBe('user_1');
        expect(received[1][1].id).toBe('asst_0');

        const transcript = received[1][2];
        expect(transcript.role).toBe('user');
        expect(transcript.id.startsWith(CODE_RESULT_ID_PREFIX)).toBe(true);

        expect(result.reason).toBe('final-answer');
        expect(result.text).toBe('Done — heading updated.');
        expect(result.iterations).toBe(2);
    });

    it('sends an EMPTY native tool list and codeMode:true forwardedProps on every turn (SW-BACKEND-GATE)', async () => {
        const { client, forwarded } = makeFakeClient([
            [asst('a0', CODE_REPLY('await noop({});'))],
            [asst('a1', 'done')],
        ]);
        const { sandbox } = makeStubSandbox();

        await runCodeModeLoop([user('u', 'go')] as any, {
            agentClient: client as any,
            subscriber: {} as any,
            handlers: { noop: () => ({ ok: true }) },
            sandbox,
            getForwardedProps: () => ({ threadTag: 'x' }),
        });

        for (const call of client.runAgent.mock.calls) {
            expect(call[1]).toEqual([]); // empty tools
        }
        expect(forwarded).toHaveLength(2);
        for (const props of forwarded) {
            expect(props.codeMode).toBe(true);
            expect(props.threadTag).toBe('x');
        }
    });

    it('stops at the iteration cap with reason max-iterations', async () => {
        // Every reply contains code — the loop must cut off at maxIterations.
        const replies = Array.from({ length: 5 }, (_, i) => [asst(`a${i}`, CODE_REPLY('await noop({});'))]);
        const { client } = makeFakeClient(replies);
        const { sandbox } = makeStubSandbox();

        const result = await runCodeModeLoop([user('u', 'go')] as any, {
            agentClient: client as any,
            subscriber: {} as any,
            handlers: { noop: () => ({ ok: true }) },
            sandbox,
            maxIterations: 3,
        });

        expect(client.runAgent).toHaveBeenCalledTimes(3);
        expect(result.reason).toBe('max-iterations');
    });

    it('re-derives the system message at the head of each turn (SW-CONTEXT freshness)', async () => {
        let version = 0;
        const { client, received } = makeFakeClient([
            [asst('a0', CODE_REPLY('await noop({});'))],
            [asst('a1', 'done')],
        ]);
        const { sandbox } = makeStubSandbox();

        await runCodeModeLoop([user('u', 'go')] as any, {
            agentClient: client as any,
            subscriber: {} as any,
            handlers: { noop: () => ({ ok: true }) },
            sandbox,
            getSystemMessage: () => ({
                id: 'sandwich_system',
                role: 'system',
                content: `context v${++version}`,
            }) as any,
        });

        // One system message per turn, refreshed, always at the head.
        expect(received[0][0]).toMatchObject({ role: 'system', content: 'context v1' });
        expect(received[1][0]).toMatchObject({ role: 'system', content: 'context v2' });
        expect(received[1].filter((m) => m.role === 'system')).toHaveLength(1);
    });

    it('exposes no shared-store writer on the loop deps (transcripts stay loop-local)', () => {
        // The loop deps intentionally carry no addMessage/store-writer hook:
        // execution transcripts are wire-only. Guards against re-introducing
        // the racey store write lm-admin hit.
        const { sandbox } = makeStubSandbox();
        const deps = {
            agentClient: makeFakeClient([]).client as any,
            subscriber: {} as any,
            handlers: {},
            sandbox,
        };
        expect('addMessage' in deps).toBe(false);
    });
});
