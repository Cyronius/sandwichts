/**
 * Vite dev middleware mounting the SandwichTS server helpers:
 *   POST /api/agent/taskboard   → createAguiBackend (Anthropic, SSE)
 *   POST /api/sandwich/tools    → createToolEndpoint (remote quote tool)
 *
 * The connect→fetch adapter below is the only glue a consumer needs to run
 * the WHATWG handlers under any Node http server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { createAguiBackend, createToolEndpoint } from '@sandwichts/server';
import type { ToolMap } from '@sandwichts/core';

const QUOTES = [
    'The best way to predict the future is to invent it. — Alan Kay',
    'Simplicity is the soul of efficiency. — Austin Freeman',
    'Make it work, make it right, make it fast. — Kent Beck',
    'The only way to go fast is to go well. — Robert C. Martin',
    'Ship early, ship often.',
];

const REMOTE_TOOLS: ToolMap = {
    get_inspirational_quote: {
        definition: {
            name: 'get_inspirational_quote',
            description: 'Fetch an inspirational quote (server-side).',
            parameters: { type: 'object', properties: {}, required: [] },
        },
        handler: async () => ({ ok: true, quote: QUOTES[Math.floor(Math.random() * QUOTES.length)] }),
        remote: true,
    },
};

async function toWebRequest(req: IncomingMessage): Promise<Request> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return new Request(`http://localhost${req.url ?? '/'}`, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][],
        body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
}

async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    if (!webRes.body) { res.end(); return; }
    const reader = webRes.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value); // flush per chunk — SSE must stream, not buffer
    }
    res.end();
}

export function sandwichBackend(): Plugin {
    return {
        name: 'sandwich-backend',
        configureServer(server) {
            const env = loadEnv(server.config.mode, server.config.envDir ?? process.cwd(), '');
            const apiKey = env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
            const toolHandler = createToolEndpoint(REMOTE_TOOLS);

            server.middlewares.use(async (req, res, next) => {
                const url = req.url ?? '';
                try {
                    if (url.startsWith('/api/agent/') && req.method === 'POST') {
                        if (!apiKey) {
                            res.statusCode = 500;
                            res.end('ANTHROPIC_API_KEY missing — set it in apps/demo/.env or use ?mock=1');
                            return;
                        }
                        const agentHandler = createAguiBackend({
                            apiKey,
                            model: env.SANDWICH_MODEL || 'claude-sonnet-5',
                            // ?customEvent=1 rides in via the client's configParams
                            emitScriptEvents: url.includes('customEvent=1'),
                        });
                        await sendWebResponse(res, await agentHandler(await toWebRequest(req)));
                        return;
                    }
                    if (url.startsWith('/api/sandwich/tools')) {
                        await sendWebResponse(res, await toolHandler(await toWebRequest(req)));
                        return;
                    }
                } catch (err: any) {
                    res.statusCode = 500;
                    res.end(String(err?.message ?? err));
                    return;
                }
                next();
            });
        },
    };
}
