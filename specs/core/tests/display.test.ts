// Traces: SW-HIDE (canonical spec: specs/core/spec.md)
//
// hasVisibleProse decides whether an assistant message is worth showing as a
// chat bubble once fenced code is removed. In code mode the model's ```js
// action blocks are hidden; a message that is nothing but such a block
// (including one still streaming, with no closing fence yet) must read as
// having no visible prose so the empty bubble is suppressed.
// Ported from lm-admin specs/mobi/tests/mobiDisplayContent.test.ts.
import { describe, it, expect } from 'vitest';
import { hasVisibleProse, stripFencedCode, extractFencedBlocks } from '@sandwichts/core';

describe('SW-HIDE: hasVisibleProse', () => {
    it('is false for a message that is only a ```js block', () => {
        expect(hasVisibleProse('```js\nawait add_card({ title: "Intro" });\n```')).toBe(false);
    });

    it('is true for a plain-prose final answer', () => {
        expect(hasVisibleProse('Done! Updated the card.')).toBe(true);
    });

    it('is true when prose precedes a trailing code block (prose survives)', () => {
        expect(hasVisibleProse('Here you go:\n```js\nawait foo();\n```')).toBe(true);
    });

    it('is false for a mid-stream unclosed js block (no closing fence yet)', () => {
        expect(hasVisibleProse('```js\nawait update_card({ id, ')).toBe(false);
    });

    it('is true for inline code inside prose', () => {
        expect(hasVisibleProse('Set the `title` prop and you are done.')).toBe(true);
    });

    it('is false for empty / whitespace / nullish input', () => {
        expect(hasVisibleProse('')).toBe(false);
        expect(hasVisibleProse('   \n  ')).toBe(false);
        expect(hasVisibleProse(null)).toBe(false);
        expect(hasVisibleProse(undefined)).toBe(false);
    });

    it('strips fenced code of any language, leaving surrounding prose', () => {
        expect(stripFencedCode('a\n```py\nx=1\n```\nb')).toBe('a\n\nb');
    });
});

describe('SW-HIDE: extractFencedBlocks (developer code peek)', () => {
    it('returns the single block for a js-only message (with fences)', () => {
        const blocks = extractFencedBlocks('```js\nawait foo();\n```');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toBe('```js\nawait foo();\n```');
    });

    it('returns the block when prose precedes a trailing block', () => {
        expect(extractFencedBlocks('Here you go:\n```js\nawait foo();\n```')).toHaveLength(1);
    });

    it('returns every block when several are present', () => {
        expect(extractFencedBlocks('```js\nawait a();\n```\nthen\n```js\nawait b();\n```')).toHaveLength(2);
    });

    it('returns [] when there is no fenced code', () => {
        expect(extractFencedBlocks('Done! Updated the card.')).toEqual([]);
    });

    it('captures a mid-stream unclosed block (no closing fence yet)', () => {
        const blocks = extractFencedBlocks('```js\nawait update_card({ ');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toBe('```js\nawait update_card({ ');
    });

    it('returns [] for nullish input', () => {
        expect(extractFencedBlocks(null)).toEqual([]);
        expect(extractFencedBlocks(undefined)).toEqual([]);
    });
});
