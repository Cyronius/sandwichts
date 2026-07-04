/**
 * remoteTool — reach server-executed tools from code-mode JS (SW-REMOTE-TOOL).
 *
 * Server-only tools (KB search, image generation, …) can't run in the browser
 * sandbox, so they are bridged through a deterministic HTTP RPC: the handler
 * POSTs `{ tool, args }` to an endpoint (see `@sandwichts/server`'s
 * `createToolEndpoint`) and returns the parsed response body. Generalized
 * from lm-admin's backendInvoker (which encoded the lm-python
 * `/agent/{id}/invoke-tool` contract).
 *
 * Kept free of DOM imports and injectable-fetch so it is unit-testable.
 */
import type { CodeModeTool, ToolSchema } from '../types';

export const DEFAULT_REMOTE_TOOL_ENDPOINT = '/api/sandwich/tools';

export interface RemoteToolOptions {
    name: string;
    description: string;
    parameters: ToolSchema;
    /** Defaults to '/api/sandwich/tools'. */
    endpoint?: string;
    /** Auth hook — resolved per call, spread into the request headers. */
    headers?: () => Promise<Record<string, string>> | Record<string, string>;
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

/**
 * Build a code-mode tool whose handler round-trips to the server. Non-2xx
 * responses resolve (not throw) to `{ ok: false, error }` so the loop can
 * resubmit a useful error rather than killing the script opaquely.
 */
export function remoteTool(opts: RemoteToolOptions): CodeModeTool {
    const {
        name,
        description,
        parameters,
        endpoint = DEFAULT_REMOTE_TOOL_ENDPOINT,
        headers,
        fetchImpl,
    } = opts;

    const handler = async (args: unknown): Promise<unknown> => {
        const doFetch = fetchImpl ?? fetch;
        const resolvedHeaders = headers ? await headers() : {};
        const res = await doFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...resolvedHeaders },
            body: JSON.stringify({ tool: name, args: args ?? {} }),
        });
        const text = await res.text();
        if (!res.ok) {
            return {
                ok: false,
                error: `Remote tool ${name} failed (${res.status}): ${text || res.statusText}`,
            };
        }
        try {
            return JSON.parse(text);
        } catch {
            return { ok: true, result: text };
        }
    };

    return {
        definition: { name, description, parameters },
        handler,
        remote: true,
    };
}
