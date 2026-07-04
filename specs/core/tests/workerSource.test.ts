// Traces: SW-SANDBOX (canonical spec: specs/core/spec.md)
//
// The worker runtime ships as a plain string (so minifiers can never rewrite
// it), which means no compiler guards it. This drift guard parses it and pins
// the protocol markers the host + iframe relay depend on.
import { describe, it, expect } from 'vitest';
import { WORKER_RUNTIME_SOURCE } from '@sandwichts/core';

describe('SW-SANDBOX: worker source drift guard', () => {
    it('is syntactically valid JavaScript', () => {
        // new Function parses (throws SyntaxError on drift) without executing.
        expect(() => new Function(WORKER_RUNTIME_SOURCE)).not.toThrow();
    });

    it('keeps the wire-protocol markers the host relies on', () => {
        for (const marker of [
            "type: 'call'",       // worker → host tool RPC
            "type: 'done'",       // worker → host success
            "type: 'error'",      // worker → host failure
            "msg.type === 'result'", // host → worker resolution
            "msg.type !== 'start'",  // relay → worker kickoff (early return guard)
            'e.ports && e.ports[0]', // MessagePort transfer (SW-SANDBOX-HARDENING)
            'deepFreeze',            // SW-CONTEXT read-only enforcement
            'AsyncFunction',         // execution mechanism
            'maxEntryChars',         // transcript size caps
        ]) {
            expect(WORKER_RUNTIME_SOURCE).toContain(marker);
        }
    });
});
