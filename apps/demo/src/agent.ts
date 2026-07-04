/**
 * Agent client wiring. Three modes (SW-DEMO-E2E):
 *   default        → lm-ag-ui AgentClient against the vite dev middleware
 *                    (/api/agent/taskboard, Anthropic key server-side)
 *   ?customEvent=1 → same, backend also emits code_mode.script CUSTOM events
 *   ?mock=1        → scripted fake client, deterministic + offline
 */
import { AgentClient } from '@itkennel/lm-ag-ui';
import type { AgentClientLike } from '@sandwichts/core';

export type DemoAgentClient = AgentClientLike & { abortRun?: () => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOCK_FLOWS: string[][] = [
    // Send 1: read board → add three pastel cards → prose summary.
    [
        'Adding three launch-prep cards now.\n'
        + '```js\n'
        + 'const res = await get_board({});\n'
        + 'const doing = res.board.columns.find(c => c.title === "Doing");\n'
        + 'await Promise.all([\n'
        + '  add_card({ columnId: doing.id, title: "Draft launch checklist", color: "#f9d5e5" }),\n'
        + '  add_card({ columnId: doing.id, title: "Rehearse the demo", color: "#d5f9e5" }),\n'
        + '  add_card({ columnId: doing.id, title: "Prep social posts", color: "#d5e5f9" }),\n'
        + ']);\n'
        + '```',
        'Done! I added three pastel launch-prep cards to the Doing column.',
    ],
    // Send 2: a runaway script — exercises the watchdog (SW-SANDBOX B).
    [
        '```js\nwhile (true) {}\n```',
        'That script timed out — the sandbox watchdog terminated it, so I stopped there.',
    ],
];

function createMockClient(): DemoAgentClient {
    let send = -1;
    let turn = 0;
    let aborted = false;
    return {
        startNewRun() {
            return undefined;
        },
        abortRun() {
            aborted = true;
        },
        async runAgent(messages, _tools, subscriber) {
            aborted = false;
            // A new user turn (not a transcript resubmission) advances the flow.
            const last = messages[messages.length - 1] as { id?: string };
            if (!String(last?.id ?? '').startsWith('code_result_')) {
                send = Math.min(send + 1, MOCK_FLOWS.length - 1);
                turn = 0;
            }
            const flow = MOCK_FLOWS[send] ?? ['Nothing scripted for this turn.'];
            const content = flow[Math.min(turn, flow.length - 1)];
            turn += 1;

            // Simulate streaming so the UI's typing/streaming states light up.
            for (let i = 0; i < content.length && !aborted; i += 24) {
                (subscriber as any).onTextMessageContentEvent?.({ event: { delta: content.slice(i, i + 24) } });
                await sleep(12);
            }
            return {
                newMessages: [
                    { id: `mock_a_${send}_${turn}`, role: 'assistant', content },
                ] as never[],
            };
        },
    };
}

export function createDemoAgentClient(params: URLSearchParams): DemoAgentClient {
    if (params.has('mock')) return createMockClient();
    return new AgentClient('/api', 'taskboard', {
        sendFullHistory: true, // client-owned history — the session ships it whole
        ...(params.has('customEvent') ? { configParams: { customEvent: '1' } } : {}),
    }) as unknown as DemoAgentClient;
}
