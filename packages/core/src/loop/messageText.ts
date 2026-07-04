/**
 * Helpers for collapsing AG-UI message content to plain text. Ported from
 * lm-admin's Mobi/messageText.ts.
 */

/**
 * Collapse an AG-UI message `content` (string | rich-part array | object) to
 * its visible text. Non-text parts are dropped; objects are JSON-stringified
 * as a last resort.
 */
export function messageContentToString(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
            .join('')
            .trim();
    }
    if (content == null) return '';
    try { return JSON.stringify(content); } catch { return String(content); }
}

/**
 * Concatenate every assistant utterance from a run, not just the last —
 * a run can emit findings in one assistant message and close with a trivial
 * "Done" in another.
 */
export function extractFinalAssistantText(messages: Array<{ role?: string; content?: unknown }>): string {
    const parts: string[] = [];
    for (const m of messages) {
        if (m.role !== 'assistant') continue;
        const text = messageContentToString(m.content);
        if (text) parts.push(text);
    }
    return parts.join('\n\n');
}
