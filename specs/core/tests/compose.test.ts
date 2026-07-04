// Traces: SW-PROMPT (canonical spec: specs/core/spec.md)
//
// composeSystemPrompt assembles the code-mode system prompt: framework-owned
// driving guide, API signatures, context-binding line, consumer rules, and
// the serialized app context last.
import { describe, it, expect } from 'vitest';
import { composeSystemPrompt, DEFAULT_DRIVING_GUIDE } from '@sandwichts/core';

describe('SW-PROMPT: composeSystemPrompt', () => {
    it('orders guide < signatures < binding line < rules < app context', () => {
        const prompt = composeSystemPrompt({
            signatures: 'async function get_board(args) {}',
            appContext: '{"columns":[]}',
            rules: ['RULE ONE', 'RULE TWO'],
        });
        const idx = (s: string) => prompt.indexOf(s);
        expect(idx('DRIVE THE APP BY WRITING JAVASCRIPT')).toBeGreaterThanOrEqual(0);
        expect(idx('DRIVE THE APP')).toBeLessThan(idx('Available API functions:'));
        expect(idx('Available API functions:')).toBeLessThan(idx('READ-ONLY object'));
        expect(idx('READ-ONLY object')).toBeLessThan(idx('RULE ONE'));
        expect(idx('RULE ONE')).toBeLessThan(idx('RULE TWO'));
        expect(idx('RULE TWO')).toBeLessThan(idx('Current app context:'));
        expect(prompt).toContain('Current app context:\n{"columns":[]}');
    });

    it('uses the default driving guide unless overridden', () => {
        const prompt = composeSystemPrompt({ signatures: 'x' });
        expect(prompt.startsWith(DEFAULT_DRIVING_GUIDE)).toBe(true);
        const custom = composeSystemPrompt({ signatures: 'x', drivingGuide: 'MY GUIDE' });
        expect(custom.startsWith('MY GUIDE')).toBe(true);
        expect(custom).not.toContain('DRIVE THE APP');
    });

    it('omits the binding line and context block when no appContext', () => {
        const prompt = composeSystemPrompt({ signatures: 'x', rules: ['R'] });
        expect(prompt).not.toContain('READ-ONLY object');
        expect(prompt).not.toContain('Current app context:');
        expect(prompt).toContain('R');
    });

    it('names a custom contextName in the binding line', () => {
        const prompt = composeSystemPrompt({
            signatures: 'x',
            appContext: '{}',
            contextName: 'boardContext',
        });
        expect(prompt).toContain('`boardContext` is an in-scope READ-ONLY object');
    });
});
