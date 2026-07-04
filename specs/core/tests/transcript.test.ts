// Traces: SW-TRANSCRIPT, SW-UNKNOWN-FN (canonical spec: specs/core/spec.md)
//
// buildTranscriptMessage renders a script's execution transcript as the next
// user-turn wire message. When the script error is a missing-function call
// (hallucinated name), the real API names are echoed back so the model
// self-corrects in one turn instead of re-guessing.
// Ported from lm-admin specs/mobi/tests/codeModeUnknownFunction.test.ts,
// extended with the SW-TRANSCRIPT format assertions.
import { describe, it, expect } from 'vitest';
import { buildTranscriptMessage, CODE_RESULT_ID_PREFIX } from '@sandwichts/core';

const API = ['get_board', 'add_card', 'batch_update_cards'];

describe('SW-TRANSCRIPT: buildTranscriptMessage format', () => {
    it('renders each completed call as await name(args) => result', () => {
        const msg = buildTranscriptMessage(
            [{ name: 'add_card', args: { title: 'Hi' }, result: { ok: true, id: 'c1' } }],
            undefined,
            0,
            API,
        );
        expect(msg.role).toBe('user');
        expect(msg.id.startsWith(CODE_RESULT_ID_PREFIX)).toBe(true);
        expect(msg.content).toContain('Executed 1 tool call(s):');
        expect(msg.content).toContain('- await add_card({"title":"Hi"}) => {"ok":true,"id":"c1"}');
        expect(msg.content).toContain('Write another ```js block to continue');
    });

    it('renders an unresolved entry as (did not complete)', () => {
        const msg = buildTranscriptMessage(
            [{ name: 'add_card', args: {} }],
            'boom',
            0,
            API,
        );
        expect(msg.content).toContain('- await add_card({}) => (did not complete)');
        expect(msg.content).toContain('Script error: boom');
        expect(msg.content).toContain('Fix the problem and write a corrected ```js block');
    });

    it('reports an empty transcript explicitly', () => {
        const msg = buildTranscriptMessage([], undefined, 0, API);
        expect(msg.content).toContain('No tool calls were executed.');
    });

    it('truncates oversized results with a marker', () => {
        const big = 'x'.repeat(7000);
        const msg = buildTranscriptMessage(
            [{ name: 'get_board', args: {}, result: big }],
            undefined,
            0,
            API,
        );
        expect(msg.content).toContain('… [truncated');
        expect(msg.content.length).toBeLessThan(big.length);
    });
});

describe('SW-UNKNOWN-FN: available-function hint', () => {
    it('lists available functions on a "is not defined" ReferenceError', () => {
        const msg = buildTranscriptMessage([], 'set_board_mood is not defined', 0, API);
        expect(msg.content).toContain('Script error: set_board_mood is not defined');
        // sorted, comma-joined
        expect(msg.content).toContain('Available functions: add_card, batch_update_cards, get_board');
    });

    it('lists available functions on the host\'s "Unknown function:" error', () => {
        const msg = buildTranscriptMessage([], 'Unknown function: set_board_mood', 0, API);
        expect(msg.content).toContain('Available functions: ');
    });

    it('does NOT list functions for unrelated runtime errors', () => {
        const msg = buildTranscriptMessage([], "Cannot read properties of undefined (reading 'ok')", 0, API);
        expect(msg.content).not.toContain('Available functions:');
    });

    it('adds no hint when there is no error (success transcript)', () => {
        const msg = buildTranscriptMessage(
            [{ name: 'add_card', args: {}, result: { ok: true } }],
            undefined,
            0,
            API,
        );
        expect(msg.content).not.toContain('Available functions:');
        expect(msg.content).not.toContain('Script error:');
    });

    it('adds no hint when the available-function list is empty', () => {
        const msg = buildTranscriptMessage([], 'foo is not defined', 0, []);
        expect(msg.content).not.toContain('Available functions:');
    });
});
