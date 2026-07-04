// Traces: SW-REMOTE-TOOL (canonical spec: specs/core/spec.md)
//
// remoteTool bridges server-executed tools into code-mode JS via a
// deterministic HTTP RPC (generalized from lm-admin's backendInvoker).
// Injected fetch keeps these pure.
import { describe, it, expect, vi } from 'vitest';
import { remoteTool, DEFAULT_REMOTE_TOOL_ENDPOINT } from '@sandwichts/core';

function fakeFetch(status: number, body: string) {
    return vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 500 ? 'Internal Server Error' : 'OK',
        text: async () => body,
    })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('SW-REMOTE-TOOL: remoteTool', () => {
    const OPTS = {
        name: 'get_quote',
        description: 'Fetch a quote.',
        parameters: { type: 'object' as const, properties: {}, required: [] },
    };

    it('POSTs { tool, args } as JSON with resolved headers', async () => {
        const doFetch = fakeFetch(200, '{"ok":true,"quote":"Ship it."}');
        const tool = remoteTool({
            ...OPTS,
            endpoint: '/api/x',
            headers: async () => ({ Authorization: 'Bearer t0k' }),
            fetchImpl: doFetch,
        });

        const result = await tool.handler({ topic: 'launch' });
        expect(result).toEqual({ ok: true, quote: 'Ship it.' });

        const [url, init] = (doFetch as any).mock.calls[0];
        expect(url).toBe('/api/x');
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.headers.Authorization).toBe('Bearer t0k');
        expect(JSON.parse(init.body)).toEqual({ tool: 'get_quote', args: { topic: 'launch' } });
    });

    it('defaults the endpoint and normalizes missing args to {}', async () => {
        const doFetch = fakeFetch(200, '{"ok":true}');
        const tool = remoteTool({ ...OPTS, fetchImpl: doFetch });
        await tool.handler(undefined);
        const [url, init] = (doFetch as any).mock.calls[0];
        expect(url).toBe(DEFAULT_REMOTE_TOOL_ENDPOINT);
        expect(JSON.parse(init.body).args).toEqual({});
    });

    it('resolves (not throws) a non-2xx into an ok:false envelope with status and body', async () => {
        const tool = remoteTool({ ...OPTS, fetchImpl: fakeFetch(500, 'kaboom') });
        const result: any = await tool.handler({});
        expect(result.ok).toBe(false);
        expect(result.error).toContain('get_quote failed (500)');
        expect(result.error).toContain('kaboom');
    });

    it('is marked remote and carries the prompt definition', () => {
        const tool = remoteTool({ ...OPTS, fetchImpl: fakeFetch(200, '{}') });
        expect(tool.remote).toBe(true);
        expect(tool.definition).toEqual({
            name: 'get_quote',
            description: 'Fetch a quote.',
            parameters: { type: 'object', properties: {}, required: [] },
        });
    });
});
