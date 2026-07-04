// Traces: SW-EXTRACT (canonical spec: specs/core/spec.md)
//
// extractCode is the parser that distinguishes a code-mode turn (the model
// emitted a ```js block of await calls to execute) from a final answer (plain
// prose, no block → stop the loop). These assert the fence-parsing contract.
// Ported from lm-admin specs/mobi/tests/codeModeExtractCode.test.ts.
import { describe, it, expect } from 'vitest';
import { extractCode } from '@sandwichts/core';

describe('SW-EXTRACT: extractCode', () => {
    it('extracts the body of a ```js block', () => {
        const text = 'Here you go:\n```js\nawait add_card({ title: "Intro" });\n```\nDone.';
        expect(extractCode(text)).toBe('await add_card({ title: "Intro" });');
    });

    it('recognizes the ```javascript fence too', () => {
        const text = '```javascript\nconst x = await get_board({});\n```';
        expect(extractCode(text)).toBe('const x = await get_board({});');
    });

    it('is case-insensitive on the language tag', () => {
        expect(extractCode('```JS\nawait foo();\n```')).toBe('await foo();');
    });

    it('tolerates trailing text on the fence line', () => {
        expect(extractCode('```js copy\nawait foo();\n```')).toBe('await foo();');
    });

    it('returns null when there is no code block (final answer)', () => {
        expect(extractCode('All three cards have been added.')).toBeNull();
    });

    it('returns null for an empty js block', () => {
        expect(extractCode('```js\n\n```')).toBeNull();
    });

    it('ignores a bare ``` block with no language tag', () => {
        expect(extractCode('```\nnot executable\n```')).toBeNull();
    });

    it('returns the FIRST js block when several are present', () => {
        const text = '```js\nawait first();\n```\nthen\n```js\nawait second();\n```';
        expect(extractCode(text)).toBe('await first();');
    });

    it('preserves backtick template literals in the body (no escaping needed)', () => {
        const body = 'await update_card({ title: `<p class="fancy">Hi "x"</p>` });';
        expect(extractCode('```js\n' + body + '\n```')).toBe(body);
    });

    it('returns null for empty / nullish input', () => {
        expect(extractCode('')).toBeNull();
        expect(extractCode(null)).toBeNull();
        expect(extractCode(undefined)).toBeNull();
    });
});
