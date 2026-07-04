/**
 * aguiBackend — a minimal AG-UI SSE agent backend over the Anthropic Messages
 * API (SW-AGUI-BACKEND).
 *
 * Implements exactly the slice of the AG-UI HttpAgent contract a code-mode
 * frontend needs: accept a `RunAgentInput` POST, run the conversation against
 * Anthropic (system message → `system` param, user/assistant history →
 * `messages`, streaming), and emit `data: {json}` SSE events —
 * RUN_STARTED, TEXT_MESSAGE_START/CONTENT/END, optional CUSTOM
 * `code_mode.script`, RUN_FINISHED (RUN_ERROR on failure).
 *
 * Native tools are NEVER forwarded to the LLM — SW-BACKEND-GATE holds by
 * construction, matching what lm-python-functions does when it sees
 * `forwardedProps.codeMode`.
 *
 * This is the demo/quick-start backend. Production deployments with existing
 * agent infra (lm-python-functions etc.) keep their own backend and just
 * honor the codeMode flag.
 */
import { extractCode, messageContentToString } from '@sandwichts/core';

export interface AguiBackendOptions {
    /** Anthropic API key — stays server-side. */
    apiKey: string;
    /** Default 'claude-sonnet-5'. */
    model?: string;
    maxTokens?: number;
    /** Emit a CUSTOM code_mode.script event when the reply contains a ```js block (SW-CODE-CHANNEL). */
    emitScriptEvents?: boolean;
    /** Override the Anthropic endpoint (tests, proxies). */
    anthropicUrl?: string;
    /** Injectable for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
}

interface WireMessage { id?: string; role?: string; content?: unknown }
interface RunAgentInput {
    threadId?: string;
    runId?: string;
    messages?: WireMessage[];
    forwardedProps?: Record<string, unknown>;
}

/** Map the AG-UI wire history onto Anthropic's system + messages params. */
export function mapMessages(history: WireMessage[]): {
    system: string | undefined;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
    const systems: string[] = [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of history) {
        const text = messageContentToString(m.content);
        if (!text) continue;
        if (m.role === 'system' || m.role === 'developer') {
            systems.push(text);
        } else if (m.role === 'user' || m.role === 'assistant') {
            // Anthropic requires alternating turns; merge consecutive
            // same-role messages (transcript user-turns follow user turns).
            const prev = messages[messages.length - 1];
            if (prev && prev.role === m.role) prev.content += `\n\n${text}`;
            else messages.push({ role: m.role, content: text });
        }
        // tool/other roles are dropped — code mode never produces them.
    }
    return { system: systems.length ? systems.join('\n\n') : undefined, messages };
}

/** Parse an Anthropic SSE stream, invoking onDelta per text delta. */
async function readAnthropicStream(
    body: ReadableStream<Uint8Array>,
    onDelta: (text: string) => void,
): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
            for (const line of block.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') continue;
                try {
                    const event = JSON.parse(payload);
                    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                        onDelta(String(event.delta.text ?? ''));
                    } else if (event.type === 'error') {
                        throw new Error(event.error?.message ?? 'Anthropic stream error');
                    }
                } catch (err) {
                    if (err instanceof SyntaxError) continue; // partial/keepalive
                    throw err;
                }
            }
        }
    }
}

export function createAguiBackend(opts: AguiBackendOptions): (req: Request) => Promise<Response> {
    const {
        apiKey,
        model = 'claude-sonnet-5',
        maxTokens = 4096,
        emitScriptEvents = false,
        anthropicUrl = 'https://api.anthropic.com/v1/messages',
        fetchImpl,
    } = opts;

    return async (req: Request): Promise<Response> => {
        if (req.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }
        let input: RunAgentInput;
        try {
            input = await req.json();
        } catch {
            return new Response('Invalid RunAgentInput JSON', { status: 400 });
        }
        const threadId = input.threadId ?? 'thread';
        const runId = input.runId ?? 'run';
        const messageId = `msg_${runId}`;
        const { system, messages } = mapMessages(input.messages ?? []);

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const emit = (event: Record<string, unknown>) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                };
                emit({ type: 'RUN_STARTED', threadId, runId });
                let full = '';
                let started = false;
                try {
                    const doFetch = fetchImpl ?? fetch;
                    const upstream = await doFetch(anthropicUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01',
                        },
                        body: JSON.stringify({
                            model,
                            max_tokens: maxTokens,
                            stream: true,
                            ...(system ? { system } : {}),
                            messages,
                            // NO tools — the model must write JS (SW-BACKEND-GATE).
                        }),
                    });
                    if (!upstream.ok || !upstream.body) {
                        const detail = await upstream.text().catch(() => upstream.statusText);
                        throw new Error(`Anthropic request failed (${upstream.status}): ${detail}`);
                    }
                    await readAnthropicStream(upstream.body, (delta) => {
                        if (!delta) return;
                        if (!started) {
                            started = true;
                            emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
                        }
                        full += delta;
                        emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta });
                    });
                    if (started) emit({ type: 'TEXT_MESSAGE_END', messageId });
                    if (emitScriptEvents) {
                        const code = extractCode(full);
                        if (code) emit({ type: 'CUSTOM', name: 'code_mode.script', value: { code } });
                    }
                    emit({ type: 'RUN_FINISHED', threadId, runId });
                } catch (err: any) {
                    emit({ type: 'RUN_ERROR', message: err?.message ? String(err.message) : String(err) });
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    };
}
