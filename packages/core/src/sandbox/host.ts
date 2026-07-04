/**
 * host — origin-isolated execution host for code-mode scripts
 * (SW-SANDBOX, SW-SANDBOX-HARDENING).
 *
 * Two nested layers of containment (proven in lm-admin's Mobi code mode):
 *   - a sandboxed `<iframe sandbox="allow-scripts">` with NO `allow-same-origin`
 *     → the model's code runs at an opaque origin with no access to this app's
 *     DOM, cookies, or storage.
 *   - inside that iframe, a Web Worker (see workerSource.ts) actually runs the
 *     generated JS. The worker is the kill-switch: a runaway / infinite-loop
 *     script is killed with `worker.terminate()` (driven by the host watchdog)
 *     without freezing the page.
 *
 * Hardening vs the lm-admin original:
 *   - all call/result/done/error traffic flows over a per-run MessageChannel
 *     port transferred through the iframe into the worker — no window
 *     broadcast, no crosstalk between concurrent sandboxes;
 *   - iframe→parent window messages (`iframe-ready`, `spawn-error`) pin
 *     targetOrigin to the host origin and carry a per-sandbox nonce;
 *     parent→iframe must remain `'*'` (an opaque origin cannot be named);
 *   - the srcdoc carries a CSP meta locking everything but inline script,
 *     eval (AsyncFunction) and blob: workers;
 *   - a new runScript supersedes (fails) an in-flight one instead of leaving
 *     its promise dangling.
 *
 * The host owns the real tool handlers (and therefore any network/DOM work):
 * the worker posts `{ call, id, name, args }` on the port, the host invokes
 * `handlers[name](args)` and posts the result back. The whitelist is exactly
 * `Object.keys(handlers)`.
 */
import { WORKER_RUNTIME_SOURCE } from './workerSource';
import type { RunScriptOptions, RunScriptResult, Sandbox, SandboxHandlers } from '../types';

export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_MAX_ENTRY_CHARS = 100_000;

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function buildSrcDoc(nonce: string, hostOrigin: string): string {
    const workerSrcJson = JSON.stringify(WORKER_RUNTIME_SOURCE);
    const nonceJson = JSON.stringify(nonce);
    const originJson = JSON.stringify(hostOrigin);
    // The iframe relay: spawns a fresh worker per `start` message (clean
    // per-run worker scope) and hands it the run's MessagePort. After that it
    // is out of the message path — only `abort` (kill) and spawn/worker
    // errors go through it.
    return `<!DOCTYPE html><html><head><meta charset="utf-8">`
        + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">`
        + `</head><body><script>
(function () {
  var WORKER_SRC = ${workerSrcJson};
  var NONCE = ${nonceJson};
  var HOST_ORIGIN = ${originJson};
  var worker = null;
  function postUp(data) { data.nonce = NONCE; parent.postMessage(data, HOST_ORIGIN); }
  function killWorker() { if (worker) { try { worker.terminate(); } catch (_) {} worker = null; } }
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var msg = e.data || {};
    if (msg.nonce !== NONCE) return;
    if (msg.type === 'start') {
      killWorker();
      var port = e.ports && e.ports[0];
      if (!port) return;
      try {
        var blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        worker = new Worker(url);
        URL.revokeObjectURL(url);
      } catch (err) {
        postUp({ type: 'spawn-error', message: 'worker-spawn-failed: ' + (err && err.message ? err.message : err) });
        return;
      }
      worker.onerror = function (ev) {
        postUp({ type: 'spawn-error', message: 'worker-error: ' + (ev && ev.message ? ev.message : 'unknown') });
      };
      worker.postMessage({
        type: 'start',
        code: msg.code,
        apiNames: msg.apiNames,
        context: msg.context,
        contextName: msg.contextName,
        maxEntryChars: msg.maxEntryChars
      }, [port]);
      return;
    }
    if (msg.type === 'abort') { killWorker(); return; }
  });
  postUp({ type: 'iframe-ready' });
})();
<\/script></body></html>`;
}

/**
 * Create a reusable sandbox. The iframe is built once; each `runScript`
 * spawns a fresh worker inside it so runs don't share mutable scope. One
 * script runs at a time per sandbox — a new `runScript` supersedes an
 * in-flight one. Call `dispose()` when the session ends.
 */
export function createSandbox(): Sandbox {
    if (typeof document === 'undefined') {
        throw new Error('createSandbox requires a DOM (no document available)');
    }

    const nonce = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    // An app served from an opaque/file origin cannot be named as a
    // targetOrigin; fall back to '*' there (the nonce still gates messages).
    const origin = window.location.origin;
    const hostOrigin = origin && origin !== 'null' ? origin : '*';

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.display = 'none';
    iframe.srcdoc = buildSrcDoc(nonce, hostOrigin);
    document.body.appendChild(iframe);

    let ready = false;
    let readyResolve: (() => void) | null = null;
    const readyPromise = new Promise<void>((resolve) => { readyResolve = resolve; });

    const onReady = (e: MessageEvent) => {
        if (e.source !== iframe.contentWindow) return;
        if (e.data?.type === 'iframe-ready' && e.data?.nonce === nonce) {
            ready = true;
            readyResolve?.();
        }
    };
    window.addEventListener('message', onReady);

    let disposed = false;
    /** Fails the in-flight run (new run started, abort, or dispose). */
    let supersedeCurrent: ((error: string) => void) | null = null;

    const runScript = async (
        code: string,
        handlers: SandboxHandlers,
        context?: unknown,
        options: RunScriptOptions = {},
    ): Promise<RunScriptResult> => {
        if (disposed) return { transcript: [], error: 'sandbox-disposed' };
        const {
            timeoutMs = DEFAULT_TIMEOUT_MS,
            contextName = 'appContext',
            onToolCall,
            onToolResult,
        } = options;
        if (!IDENTIFIER_RE.test(contextName)) {
            return { transcript: [], error: `Invalid contextName "${contextName}" — must be a valid JS identifier.` };
        }
        supersedeCurrent?.('superseded by a new runScript call');
        if (!ready) await readyPromise;
        const target = iframe.contentWindow;
        if (!target) return { transcript: [], error: 'sandbox-window-unavailable' };

        return new Promise<RunScriptResult>((resolve) => {
            const channel = new MessageChannel();
            let settled = false;
            let watchdog: ReturnType<typeof setTimeout> | null = null;

            const killWorker = () => {
                // Parent→iframe targetOrigin must be '*': the sandboxed iframe
                // has an opaque origin that cannot be matched by name. The
                // nonce gates delivery on the iframe side.
                try { target.postMessage({ type: 'abort', nonce }, '*'); } catch { /* iframe gone */ }
            };
            const cleanup = () => {
                window.removeEventListener('message', onWindowMessage);
                channel.port1.close();
                if (watchdog) clearTimeout(watchdog);
                supersedeCurrent = null;
            };
            const finish = (out: RunScriptResult) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(out);
            };
            supersedeCurrent = (error: string) => {
                killWorker();
                finish({ transcript: [], error });
            };

            channel.port1.onmessage = (e: MessageEvent) => {
                const msg = e.data || {};
                if (msg.type === 'call') {
                    const handler = handlers[msg.name];
                    if (!handler) {
                        // Echo the real API names so the model self-corrects
                        // rather than re-guessing the name (SW-UNKNOWN-FN).
                        const available = Object.keys(handlers).sort().join(', ');
                        const error = `Unknown function: ${msg.name}. Available functions: ${available}`;
                        onToolResult?.(msg.name, msg.args, undefined, error);
                        channel.port1.postMessage({ type: 'result', id: msg.id, error });
                        return;
                    }
                    onToolCall?.(msg.name, msg.args);
                    Promise.resolve()
                        .then(() => handler(msg.args))
                        .then((result) => {
                            onToolResult?.(msg.name, msg.args, result, undefined);
                            try {
                                channel.port1.postMessage({ type: 'result', id: msg.id, result });
                            } catch {
                                // Structured clone refused the value (function,
                                // DOM node, …) — surface it as a tool error the
                                // model can react to instead of hanging the call.
                                channel.port1.postMessage({
                                    type: 'result',
                                    id: msg.id,
                                    error: `Tool ${msg.name} returned a non-serializable result.`,
                                });
                            }
                        })
                        .catch((err: any) => {
                            const error = err?.message ? String(err.message) : String(err);
                            onToolResult?.(msg.name, msg.args, undefined, error);
                            channel.port1.postMessage({ type: 'result', id: msg.id, error });
                        });
                    return;
                }
                if (msg.type === 'done') {
                    finish({ transcript: msg.transcript ?? [] });
                    return;
                }
                if (msg.type === 'error') {
                    finish({ transcript: msg.transcript ?? [], error: msg.message ?? 'unknown error' });
                    return;
                }
            };

            // Spawn/worker-level failures can't ride the port (the worker may
            // never have received it) — they arrive on the window channel,
            // gated by source + nonce.
            const onWindowMessage = (e: MessageEvent) => {
                if (e.source !== target) return;
                const msg = e.data || {};
                if (msg.nonce !== nonce) return;
                if (msg.type === 'spawn-error') {
                    finish({ transcript: [], error: msg.message ?? 'worker error' });
                }
            };
            window.addEventListener('message', onWindowMessage);

            watchdog = setTimeout(() => {
                // Runaway / infinite-loop generation: terminate the worker and
                // report. The loop can recover (resubmit the error).
                killWorker();
                finish({ transcript: [], error: `Script timed out after ${timeoutMs}ms and was terminated.` });
            }, timeoutMs);

            target.postMessage(
                {
                    type: 'start',
                    nonce,
                    code,
                    apiNames: Object.keys(handlers),
                    context,
                    contextName,
                    maxEntryChars: DEFAULT_MAX_ENTRY_CHARS,
                },
                '*',
                [channel.port2],
            );
        });
    };

    const abort = () => {
        supersedeCurrent?.('aborted');
    };

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        supersedeCurrent?.('sandbox-disposed');
        window.removeEventListener('message', onReady);
        iframe.remove();
    };

    return { runScript, abort, dispose };
}
