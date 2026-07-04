// Traces: SW-TOOL-ENDPOINT (canonical spec: specs/server/spec.md)
//
// createToolEndpoint executes registered tools server-side for remoteTool
// clients — WHATWG Request/Response, no framework.
import { describe, it, expect } from 'vitest';
import { createToolEndpoint } from '@sandwichts/server';
import type { ToolMap } from '@sandwichts/core';

const TOOLS: ToolMap = {
    get_quote: {
        definition: {
            name: 'get_quote',
            description: 'Fetch a quote.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
        handler: async (args: any) => ({ ok: true, quote: `About ${args?.topic ?? 'life'}: ship it.` }),
        remote: true,
    },
    explode: {
        definition: {
            name: 'explode',
            description: 'Always throws.',
            parameters: { type: 'object', properties: {}, required: [] },
        },
        handler: async () => { throw new Error('kaboom'); },
        remote: true,
    },
};

const post = (body: unknown) => new Request('http://x/api/sandwich/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

describe('SW-TOOL-ENDPOINT: createToolEndpoint', () => {
    const handler = createToolEndpoint(TOOLS);

    it('runs a known tool and returns its result as JSON', async () => {
        const res = await handler(post({ tool: 'get_quote', args: { topic: 'launch' } }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, quote: 'About launch: ship it.' });
    });

    it('404s an unknown tool with an ok:false envelope', async () => {
        const res = await handler(post({ tool: 'nope', args: {} }));
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ ok: false, error: 'Unknown tool: nope' });
    });

    it('500s a throwing handler with the error message', async () => {
        const res = await handler(post({ tool: 'explode', args: {} }));
        expect(res.status).toBe(500);
        expect(await res.json()).toMatchObject({ ok: false, error: 'kaboom' });
    });

    it('405s non-POST and 400s malformed JSON', async () => {
        const get = await handler(new Request('http://x/', { method: 'GET' }));
        expect(get.status).toBe(405);
        const bad = await handler(new Request('http://x/', { method: 'POST', body: 'not json' }));
        expect(bad.status).toBe(400);
    });
});
