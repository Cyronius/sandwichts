// @vitest-environment happy-dom
//
// Traces: SW-CODE-LOG (canonical spec: specs/core/spec.md)
//
// logCodeEmission is the only place emitted code reaches the browser console.
// It must stay silent by default (SandwichTS hides its internal mechanics,
// per SW-HIDE) and only log when the developer opts in via the
// `sandwichLogCode` localStorage flag. Runs under happy-dom (rather than the
// suite's default node environment) since it needs a real `localStorage`.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { isDevCodeLogEnabled, logCodeEmission } from '@sandwichts/core';

describe('SW-CODE-LOG: isDevCodeLogEnabled', () => {
    afterEach(() => {
        localStorage.removeItem('sandwichLogCode');
    });

    it('is false by default', () => {
        expect(isDevCodeLogEnabled()).toBe(false);
    });

    it('is true once the flag is set', () => {
        localStorage.setItem('sandwichLogCode', '1');
        expect(isDevCodeLogEnabled()).toBe(true);
    });

    it('is false when localStorage throws', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('unavailable');
        });
        expect(isDevCodeLogEnabled()).toBe(false);
        spy.mockRestore();
    });
});

describe('SW-CODE-LOG: logCodeEmission', () => {
    let groupSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let groupEndSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        groupSpy = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        groupEndSpy = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    });

    afterEach(() => {
        localStorage.removeItem('sandwichLogCode');
        groupSpy.mockRestore();
        logSpy.mockRestore();
        groupEndSpy.mockRestore();
    });

    it('does not log when the flag is off', () => {
        logCodeEmission('await foo();', 0);
        expect(groupSpy).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
        expect(groupEndSpy).not.toHaveBeenCalled();
    });

    it('logs the code grouped by iteration when the flag is on', () => {
        localStorage.setItem('sandwichLogCode', '1');
        logCodeEmission('await foo();', 2);
        expect(groupSpy).toHaveBeenCalledTimes(1);
        expect(groupSpy).toHaveBeenCalledWith(expect.stringContaining('iteration 2'));
        expect(logSpy).toHaveBeenCalledWith('await foo();');
        expect(groupEndSpy).toHaveBeenCalledTimes(1);
    });
});
