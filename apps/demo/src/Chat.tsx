/**
 * Code-mode chat panel (SW-DEMO-E2E): hidden ```js blocks, typing dots for
 * prose-less streaming, dev code-peek disclosure, stop button, transcript
 * dev panel.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useCodeModeChat } from '@sandwichts/react';
import { stripFencedCode, hasVisibleProse } from '@sandwichts/core';
import { createDemoAgentClient } from './agent';
import { boardTools, buildBoardContext } from './tools';

const BOARD_RULES = [
    'Pick card colors that read well against both light and dark backgrounds; prefer soft pastels unless the user asks otherwise.',
    'When changing several cards, use ONE batch_update_cards call instead of many update_card calls.',
];

export function Chat() {
    const params = useMemo(() => new URLSearchParams(window.location.search), []);
    const agentClient = useMemo(() => createDemoAgentClient(params), [params]);
    const [input, setInput] = useState('');
    const [showDev, setShowDev] = useState(false);

    const chat = useCodeModeChat({
        agentClient,
        tools: boardTools,
        prompt: {
            appContext: () => JSON.stringify(buildBoardContext()),
            contextName: 'boardContext',
            rules: BOARD_RULES,
        },
        context: buildBoardContext,
        scriptTimeoutMs: params.has('mock') ? 3000 : 15000,
        devReveal: showDev,
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (chat.running) return;
        const text = input;
        setInput('');
        void chat.send(text);
    };

    const streamingProse = stripFencedCode(chat.streamingText);
    const streamingDots = chat.running && !hasVisibleProse(chat.streamingText);

    return (
        <aside className="chat">
            <header className="chat-header">
                <span>Assistant</span>
                <label className="dev-toggle">
                    <input type="checkbox" checked={showDev} onChange={(e) => setShowDev(e.target.checked)} />
                    dev
                </label>
            </header>

            <div className="chat-messages" data-testid="chat-messages">
                {chat.messages.map((m) => {
                    if (m.role === 'user') {
                        return <div className="bubble user" key={m.id}>{m.text}</div>;
                    }
                    if (!m.hasProse && !showDev) return null; // code-only → suppressed
                    return (
                        <div className="bubble assistant" key={m.id}>
                            {m.hasProse && <div>{stripFencedCode(m.text)}</div>}
                            {showDev && m.codeBlocks.length > 0 && (
                                <details className="code-peek">
                                    <summary>code ({m.codeBlocks.length})</summary>
                                    {m.codeBlocks.map((block, i) => <pre key={i}>{block}</pre>)}
                                </details>
                            )}
                        </div>
                    );
                })}
                {chat.running && (
                    <div className="bubble assistant streaming" data-testid="streaming">
                        {streamingDots
                            ? <span className="dots">{chat.status === 'executing' ? 'running script' : 'thinking'}<i>…</i></span>
                            : <div>{streamingProse}</div>}
                    </div>
                )}
                {chat.error != null && <div className="bubble error">{String(chat.error)}</div>}
            </div>

            {showDev && chat.lastTranscript && (
                <details className="dev-panel" open>
                    <summary>last transcript ({chat.lastTranscript.length} calls)</summary>
                    <pre data-testid="transcript">
                        {chat.lastTranscript.map((t) => `await ${t.name}(${JSON.stringify(t.args)}) => ${JSON.stringify(t.result)}`).join('\n')}
                    </pre>
                </details>
            )}

            <form className="chat-input" onSubmit={submit}>
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder='Try: "Add three pastel launch-prep cards to Doing"'
                    disabled={chat.running}
                    data-testid="chat-input"
                />
                {chat.running
                    ? <button type="button" onClick={chat.abort} className="stop">Stop</button>
                    : <button type="submit" disabled={!input.trim()}>Send</button>}
            </form>
        </aside>
    );
}
