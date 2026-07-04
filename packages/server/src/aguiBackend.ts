/**
 * aguiBackend — a minimal AG-UI SSE agent backend over any OpenAI-compatible
 * Chat Completions API (SW-AGUI-BACKEND).
 *
 * OpenAI-compatible is the de facto abstraction layer: OpenAI/ChatGPT,
 * Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, … all speak it, so one
 * `baseUrl` swap covers hosted and local models alike (`apiKey` is optional —
 * local servers don't need one).
 *
 * Implements exactly the slice of the AG-UI HttpAgent contract a code-mode
 * frontend needs: accept a `RunAgentInput` POST, run the conversation
 * upstream (streaming), and emit `data: {json}` SSE events — RUN_STARTED,
 * TEXT_MESSAGE_START/CONTENT/END, optional CUSTOM `code_mode.script`,
 * RUN_FINISHED (RUN_ERROR on failure).
 *
 * Native tools are NEVER forwarded to the LLM — SW-BACKEND-GATE holds by
 * construction, matching what lm-python-functions does when it sees
 * `forwardedProps.codeMode`.
 *
 * This is the demo/quick-start backend. Production deployments with existing
 * agent infra keep their own backend and just honor the codeMode flag.
 */
import { extractCode, messageContentToString } from '@sandwichts/core';

export interface AguiBackendOptions {
    /** Upstream model name — REQUIRED (OpenAI: gpt-4o-mini, Ollama: llama3.2, …). */
    model: string;
    /** OpenAI-compatible root, default 'https://api.openai.com/v1'. Ollama: 'http://localhost:11434/v1'. */
    baseUrl?: string;
    /** Optional — sent as `Authorization: Bearer` when present; local servers need none. */
    apiKey?: string;
    maxTokens?: number;
    /** Emit a CUSTOM code_mode.script event when the reply contains a ```js block (SW-CODE-CHANNEL). */
    emitScriptEvents?: boolean;
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

type ChatRole = 'system' | 'user' | 'assistant';

/**
 * Map the AG-UI wire history onto Chat Completions messages. System messages
 * stay inline; consecutive same-role turns are merged (harmless on OpenAI,
 * helps strict local chat templates — transcript user-turns follow user
 * turns); tool/unknown roles are dropped (code mode never produces them).
 */
export function mapMessages(history: WireMessage[]): Array<{ role: ChatRole; content: string }> {
    const messages: Array<{ role: ChatRole; content: string }> = [];
    for (const m of history) {
        const text = messageContentToString(m.content);
        if (!text) continue;
        const role: ChatRole | null = m.role === 'system' || m.role === 'developer'
            ? 'system'
            : m.role === 'user' || m.role === 'assistant' ? m.role : null;
        if (!role) continue;
        const prev = messages[messages.length - 1];
        if (prev && prev.role === role) prev.content += `\n\n${text}`;
        else messages.push({ role, content: text });
    }
    return messages;
}

/** Parse an OpenAI-compatible SSE stream, invoking onDelta per content delta. */
async function readSseStream(
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
                    if (event.error) {
                        throw new Error(event.error?.message ?? 'upstream stream error');
                    }
                    const delta = event.choices?.[0]?.delta?.content;
                    if (typeof delta === 'string' && delta) onDelta(delta);
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
        model,
        baseUrl = 'https://api.openai.com/v1',
        apiKey,
        maxTokens,
        emitScriptEvents = false,
        fetchImpl,
    } = opts;
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

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
        const messages = mapMessages(input.messages ?? []);

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
                    const upstream = await doFetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
                        },
                        body: JSON.stringify({
                            model,
                            stream: true,
                            ...(maxTokens ? { max_tokens: maxTokens } : {}),
                            messages,
                            // NO tools — the model must write JS (SW-BACKEND-GATE).
                        }),
                    });
                    if (!upstream.ok || !upstream.body) {
                        const detail = await upstream.text().catch(() => upstream.statusText);
                        throw new Error(`Upstream request failed (${upstream.status}): ${detail}`);
                    }
                    await readSseStream(upstream.body, (delta) => {
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
