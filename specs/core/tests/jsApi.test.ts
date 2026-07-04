// Traces: SW-JSAPI (canonical spec: specs/core/spec.md)
//
// buildJsApi turns tool definitions into the JS API surface the code-mode
// system prompt advertises (JSDoc + async function signatures) plus the
// worker's capability whitelist (apiNames). These assert the schema →
// signature mapping.
// Ported from lm-admin specs/mobi/tests/codeModeBuildJsApi.test.ts.
import { describe, it, expect } from 'vitest';
import { buildJsApi, type ToolSchema } from '@sandwichts/core';

function tool(name: string, description: string, parameters: ToolSchema) {
    return {
        definition: { name, description, parameters },
        handler: () => ({ ok: true }),
    };
}

describe('SW-JSAPI: buildJsApi', () => {
    it('lists apiNames in definition order', () => {
        const map = {
            get_board: tool('get_board', 'read', { type: 'object', properties: {}, required: [] }),
            add_card: tool('add_card', 'add', { type: 'object', properties: {}, required: [] }),
        };
        expect(buildJsApi(map).apiNames).toEqual(['get_board', 'add_card']);
    });

    it('renders a JSDoc block with the description, params, and an async signature', () => {
        const map = {
            add_card: tool('add_card', 'Add a new card.', {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Card title' },
                    props: { type: 'object', description: 'Initial properties' },
                },
                required: ['title'],
            }),
        };
        const { signatures } = buildJsApi(map);
        expect(signatures).toContain('* Add a new card.');
        expect(signatures).toContain('@param {Object} args');
        expect(signatures).toContain('@param {string} args.title - Card title');
        expect(signatures).toContain('async function add_card(args)');
    });

    it('marks optional params with bracket notation and required without', () => {
        const map = {
            add_card: tool('add_card', 'Add.', {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'required one' },
                    position: { type: 'string', description: 'optional one' },
                },
                required: ['title'],
            }),
        };
        const { signatures } = buildJsApi(map);
        expect(signatures).toContain('@param {string} args.title - required one');
        expect(signatures).toContain('@param {string} [args.position] - optional one');
    });

    it('maps enum schemas to a union type', () => {
        const map = {
            set_mode: tool('set_mode', 'Set mode.', {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['light', 'dark'], description: 'color mode' },
                },
                required: ['mode'],
            }),
        };
        expect(buildJsApi(map).signatures).toContain('@param {"light" | "dark"} args.mode - color mode');
    });

    it('maps array schemas to Array<itemType>', () => {
        const map = {
            batch_update_cards: tool('batch_update_cards', 'Batch.', {
                type: 'object',
                properties: {
                    updates: { type: 'array', items: { type: 'object' }, description: 'the updates' },
                },
                required: ['updates'],
            }),
        };
        expect(buildJsApi(map).signatures).toContain('@param {Array<Object>} args.updates - the updates');
    });

    it('handles a tool with no parameters', () => {
        const map = {
            get_board: tool('get_board', 'Read the board.', { type: 'object', properties: {}, required: [] }),
        };
        const { signatures } = buildJsApi(map);
        expect(signatures).toContain('async function get_board(args)');
        expect(signatures).toContain('@returns {Promise<Object>}');
    });

    it('returns an empty surface for an empty map', () => {
        expect(buildJsApi({})).toEqual({ signatures: '', apiNames: [] });
    });
});
