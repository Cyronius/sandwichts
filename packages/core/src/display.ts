/**
 * display — pure helpers deciding what assistant text is worth showing in a
 * code-mode chat (SW-HIDE).
 *
 * The model emits ```js action blocks that drive the app — internal mechanics
 * the end user should never see. Consumers hide all fenced code at render
 * time; these helpers detect when, after removing fenced code, a message has
 * no remaining prose, so the now-empty bubble can be suppressed (and typing
 * dots shown instead while such a message streams).
 *
 * Distinct from `extractCode` (loop/extractCode.ts), which pulls the js source
 * out for execution. These are display-only and language-agnostic.
 */

/**
 * Remove fenced code blocks from `text` and trim. Strips complete fences (any
 * language) and a trailing unclosed fence, so a js block still streaming in
 * (no closing ``` yet) is also treated as code, not prose.
 */
export function stripFencedCode(text: string | null | undefined): string {
    return (text ?? '')
        .replace(/```[\s\S]*?```/g, '') // complete fences (any language)
        .replace(/```[\s\S]*$/g, '')    // trailing unclosed fence (streaming)
        .trim();
}

/**
 * True when `text` has visible prose once fenced code is removed — i.e. the
 * message is worth rendering as a bubble.
 */
export function hasVisibleProse(text: string | null | undefined): boolean {
    return stripFencedCode(text).length > 0;
}

// Full fenced blocks (complete first, then a trailing unclosed one) — the inverse
// of stripFencedCode's removals, kept in sync with it.
const FENCED_BLOCK_RE = /```[\s\S]*?```|```[\s\S]*$/g;

/**
 * Return each fenced code block in `text` verbatim (including its ``` fences),
 * or `[]` when there are none. Used by the developer code peek to show the raw
 * blocks the renderer hides (SW-HIDE).
 */
export function extractFencedBlocks(text: string | null | undefined): string[] {
    return (text ?? '').match(FENCED_BLOCK_RE) ?? [];
}

/**
 * Opt-in developer reveal of the hidden code blocks, gated on a localStorage
 * flag (`sandwichShowCode`). Off by default everywhere. Wrapped in try/catch
 * because localStorage can be unavailable or throw in sandboxed contexts.
 */
export function isDevCodeRevealEnabled(): boolean {
    try {
        return !!localStorage.getItem('sandwichShowCode');
    } catch {
        return false;
    }
}
