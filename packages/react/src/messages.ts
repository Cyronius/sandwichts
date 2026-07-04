/**
 * Display-message shapes for code-mode chat (SW-REACT-HIDE). Pure — computed
 * from core's display helpers so non-React consumers can reuse the logic.
 */
import { extractFencedBlocks, hasVisibleProse } from '@sandwichts/core';

export interface DisplayMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    /** Raw fenced blocks (with fences) — feeds the dev code-peek disclosure. */
    codeBlocks: string[];
    /** False → the bubble is code-only and should be suppressed (SW-REACT-HIDE). */
    hasProse: boolean;
}

export function toDisplayMessage(id: string, role: 'user' | 'assistant', text: string): DisplayMessage {
    return {
        id,
        role,
        text,
        codeBlocks: role === 'assistant' ? extractFencedBlocks(text) : [],
        hasProse: role === 'assistant' ? hasVisibleProse(text) : text.trim().length > 0,
    };
}
