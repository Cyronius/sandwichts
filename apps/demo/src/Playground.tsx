/**
 * Sandbox playground — the manual verification surface for SW-SANDBOX /
 * SW-SANDBOX-HARDENING / SW-CONTEXT (see specs/core/tests/sandbox.manual.test.ts).
 * Runs canned scripts against console-backed tools; no LLM involved.
 */
import { useMemo, useRef, useState } from 'react';
import { createSandbox, type RunScriptResult, type Sandbox, type SandboxHandlers } from '@sandwichts/core';

interface Item { id: string; label: string; done: boolean }

function makeHandlers(store: { items: Item[] }, log: (line: string) => void): SandboxHandlers {
    return {
        get_items: () => {
            log('get_items()');
            return { ok: true, items: store.items };
        },
        add_item: (args: { label: string }) => {
            const item = { id: `i${store.items.length + 1}`, label: String(args?.label ?? ''), done: false };
            store.items = [...store.items, item];
            log(`add_item(${item.label})`);
            return { ok: true, item };
        },
        set_done: (args: { id: string; done: boolean }) => {
            const item = store.items.find((i) => i.id === args?.id);
            if (!item) return { ok: false, error: `No item ${args?.id}` };
            item.done = !!args?.done;
            log(`set_done(${item.id}, ${item.done})`);
            return { ok: true, item };
        },
    };
}

const SCRIPTS: Record<string, { label: string; code: string; timeoutMs?: number }> = {
    happy: {
        label: 'Run happy script',
        code: [
            'const res = await get_items({});',
            'await Promise.all([',
            '  add_item({ label: `First "quoted" item` }),',
            '  add_item({ label: "Second item" }),',
            ']);',
            'const after = await get_items({});',
            'await set_done({ id: after.items[0].id, done: true });',
        ].join('\n'),
    },
    loop: { label: 'Run infinite loop (watchdog)', code: 'while (true) {}', timeoutMs: 3000 },
    unknown: { label: 'Run unknown fn', code: 'await set_mood({ mood: "great" });' },
    frozen: { label: 'Mutate context (frozen)', code: 'appContext.items.push("hacked"); await get_items({});' },
    fetchProbe: {
        label: 'Probe fetch (no network)',
        code: 'try { await fetch("https://example.com/"); throw new Error("NETWORK ESCAPED THE SANDBOX"); } catch (e) { if (String(e.message).includes("ESCAPED")) throw e; throw new Error("fetch blocked: " + e.message); }',
    },
};

export function Playground() {
    const storeRef = useRef<{ items: Item[] }>({ items: [{ id: 'i0', label: 'Seed item', done: false }] });
    const sandboxRef = useRef<Sandbox | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const [result, setResult] = useState<RunScriptResult | null>(null);
    const [running, setRunning] = useState(false);

    const appendLog = (line: string) => setLog((prev) => [...prev, line]);
    const handlers = useMemo(() => makeHandlers(storeRef.current, appendLog), []);

    const getSandbox = () => {
        sandboxRef.current ??= createSandbox();
        return sandboxRef.current;
    };

    const run = async (key: keyof typeof SCRIPTS) => {
        const script = SCRIPTS[key];
        setRunning(true);
        setResult(null);
        appendLog(`▶ ${script.label}`);
        const out = await getSandbox().runScript(
            script.code,
            handlers,
            { items: storeRef.current.items },
            { timeoutMs: script.timeoutMs ?? 8000 },
        );
        setResult(out);
        setRunning(false);
        appendLog(out.error ? `✖ ${out.error}` : `✔ ${out.transcript.length} call(s)`);
    };

    const runTwoSandboxes = async () => {
        setRunning(true);
        setResult(null);
        appendLog('▶ Run two sandboxes concurrently');
        const a = createSandbox();
        const b = createSandbox();
        try {
            const [ra, rb] = await Promise.all([
                a.runScript('await mark({ who: "A" }); await mark({ who: "A" });', {
                    mark: (args: any) => ({ ok: true, sandbox: 'A', args }),
                }),
                b.runScript('await mark({ who: "B" });', {
                    mark: (args: any) => ({ ok: true, sandbox: 'B', args }),
                }),
            ]);
            const aOk = ra.transcript.length === 2
                && ra.transcript.every((t: { result?: unknown }) => (t.result as any)?.sandbox === 'A');
            const bOk = rb.transcript.length === 1 && (rb.transcript[0].result as any)?.sandbox === 'B';
            setResult({
                transcript: [...ra.transcript, ...rb.transcript],
                error: aOk && bOk ? undefined : 'CROSSTALK DETECTED — transcripts mixed between sandboxes',
            });
            appendLog(aOk && bOk ? '✔ isolation held (A saw 2 A-calls, B saw 1 B-call)' : '✖ crosstalk!');
        } finally {
            a.dispose();
            b.dispose();
            setRunning(false);
        }
    };

    return (
        <div className="shell playground">
            <header className="topbar">
                <h1>SandwichTS sandbox playground</h1>
                <span className="tag">SW-SANDBOX manual verification</span>
            </header>
            <div className="playground-grid">
                <section>
                    <h2>Scenarios</h2>
                    {Object.entries(SCRIPTS).map(([key, s]) => (
                        <button key={key} disabled={running} onClick={() => run(key as keyof typeof SCRIPTS)}>
                            {s.label}
                        </button>
                    ))}
                    <button disabled={running} onClick={runTwoSandboxes}>Run two sandboxes (isolation)</button>
                    <h2>Store</h2>
                    <ul>
                        {storeRef.current.items.map((i) => (
                            <li key={i.id}>{i.done ? '☑' : '☐'} {i.label}</li>
                        ))}
                    </ul>
                </section>
                <section>
                    <h2>Result</h2>
                    <pre data-testid="result">{result ? JSON.stringify(result, null, 2) : running ? 'running…' : '—'}</pre>
                    <h2>Log</h2>
                    <pre data-testid="log">{log.join('\n')}</pre>
                </section>
            </div>
        </div>
    );
}
