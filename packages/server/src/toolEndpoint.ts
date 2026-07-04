/**
 * toolEndpoint — server half of the remote-tool bridge (SW-TOOL-ENDPOINT).
 *
 * A framework-agnostic WHATWG `(Request) => Response` handler that executes
 * registered tools server-side for `remoteTool` clients: POST
 * `{ tool, args }` → run the named handler → JSON result. Mount it under any
 * fetch-compatible server (Next route handlers, Hono, a Vite dev-middleware
 * adapter, …).
 */
import type { ToolMap } from '@sandwichts/core';

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export function createToolEndpoint(tools: ToolMap): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
        if (req.method !== 'POST') {
            return json(405, { ok: false, error: 'Method not allowed — POST { tool, args }.' });
        }
        let body: { tool?: unknown; args?: unknown };
        try {
            body = await req.json();
        } catch {
            return json(400, { ok: false, error: 'Invalid JSON body — expected { tool, args }.' });
        }
        const name = typeof body.tool === 'string' ? body.tool : '';
        const tool = name ? tools[name] : undefined;
        if (!tool) {
            return json(404, { ok: false, error: `Unknown tool: ${name || '(missing)'}` });
        }
        try {
            const result = await tool.handler(body.args ?? {});
            return json(200, result ?? { ok: true });
        } catch (err: any) {
            return json(500, { ok: false, error: err?.message ? String(err.message) : String(err) });
        }
    };
}
