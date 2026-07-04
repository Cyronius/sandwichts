// Traces: SW-AGUI-BACKEND (canonical spec: specs/server/spec.md)
//
// createAguiBackend implements the AG-UI HttpAgent SSE slice over the
// Anthropic Messages API, with the upstream fetch mocked.
import { describe, it, expect, vi } from 'vitest';
import { createAguiBackend, mapMessages } from '@sandwichts/server';

function anthropicSse(deltas: string[]): Response {
    const events = [
        '{"type":"message_start"}',
        ...deltas.map((d) => JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: d } })),
        '{"type":"message_stop"}',
    ];
    const body = events.map((e) => `data: ${e}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

async function readAguiEvents(res: Response): Promise<any[]> {
    const text = await res.text();
    return text
        .split('\n\n')
        .filter((b) => b.startsWith('data: '))
        .map((b) => JSON.parse(b.slice(6)));
}

const runInput = (messages: any[]) => new Request('http://x/agent/demo', {
    method: 'POST',
    body: JSON.stringify({ threadId: 't1', runId: 'r1', messages, tools: [], forwardedProps: { codeMode: true } }),
});

describe('SW-AGUI-BACKEND: createAguiBackend', () => {
    it('maps system+history to the Anthropic body with NO tools, streams AG-UI events', async () => {
        const upstream = vi.fn(async () => anthropicSse(['Hello ', 'world']));
        const handler = createAguiBackend({ apiKey: 'k', model: 'claude-sonnet-5', fetchImpl: upstream as any });

        const res = await handler(runInput([
            { id: 's', role: 'system', content: 'You are helpful.' },
            { id: 'u', role: 'user', content: 'hi' },
        ]));
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');

        const events = await readAguiEvents(res);
        expect(events.map((e) => e.type)).toEqual([
            'RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CONTENT',
            'TEXT_MESSAGE_END', 'RUN_FINISHED',
        ]);
        expect(events[0]).toMatchObject({ threadId: 't1', runId: 'r1' });
        expect(events[2].delta + events[3].delta).toBe('Hello world');

        const [url, init] = upstream.mock.calls[0] as any;
        expect(url).toContain('anthropic.com');
        const body = JSON.parse(init.body);
        expect(body.model).toBe('claude-sonnet-5');
        expect(body.system).toBe('You are helpful.');
        expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
        expect(body.tools).toBeUndefined(); // SW-BACKEND-GATE by construction
        expect(init.headers['x-api-key']).toBe('k');
    });

    it('emits a CUSTOM code_mode.script event when enabled and the reply has a js block', async () => {
        const reply = 'On it.\n```js\nawait add_card({ title: "X" });\n```';
        const upstream = vi.fn(async () => anthropicSse([reply]));
        const handler = createAguiBackend({ apiKey: 'k', emitScriptEvents: true, fetchImpl: upstream as any });

        const events = await readAguiEvents(await handler(runInput([{ id: 'u', role: 'user', content: 'go' }])));
        const custom = events.find((e) => e.type === 'CUSTOM');
        expect(custom).toMatchObject({ name: 'code_mode.script', value: { code: 'await add_card({ title: "X" });' } });
        // CUSTOM rides between TEXT_MESSAGE_END and RUN_FINISHED.
        expect(events.map((e) => e.type).slice(-3)).toEqual(['TEXT_MESSAGE_END', 'CUSTOM', 'RUN_FINISHED']);
    });

    it('emits RUN_ERROR carrying upstream failure text', async () => {
        const upstream = vi.fn(async () => new Response('rate limited', { status: 429, statusText: 'Too Many' }));
        const handler = createAguiBackend({ apiKey: 'k', fetchImpl: upstream as any });
        const events = await readAguiEvents(await handler(runInput([{ id: 'u', role: 'user', content: 'go' }])));
        expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
        expect(events[1].message).toContain('429');
        expect(events[1].message).toContain('rate limited');
    });

    it('mapMessages merges consecutive same-role turns and drops empty/tool roles', () => {
        const { system, messages } = mapMessages([
            { role: 'system', content: 'S1' },
            { role: 'user', content: 'ask' },
            { role: 'assistant', content: 'code turn' },
            { role: 'user', content: 'transcript feedback' },
            { role: 'user', content: 'second user turn' },
            { role: 'tool', content: 'dropped' },
            { role: 'assistant', content: [{ text: 'rich ' }, { text: 'parts' }] },
        ]);
        expect(system).toBe('S1');
        expect(messages).toEqual([
            { role: 'user', content: 'ask' },
            { role: 'assistant', content: 'code turn' },
            { role: 'user', content: 'transcript feedback\n\nsecond user turn' },
            { role: 'assistant', content: 'rich parts' },
        ]);
    });
});
