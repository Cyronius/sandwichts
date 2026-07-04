/**
 * extractCode — pull the first JavaScript code block out of an assistant
 * message (SW-EXTRACT).
 *
 * In the code-mode loop the model either (a) emits a ```js … ``` block of
 * `await` calls to drive the app, or (b) writes a plain prose answer with
 * no code block, which signals the run is finished. This is the pure parser
 * that distinguishes the two: it returns the code to execute, or `null` when
 * there is none (→ stop the loop, the message is the final answer).
 *
 * Only ```js / ```javascript fences are recognized — a bare ``` block is NOT
 * treated as executable code, so the model can include illustrative non-JS
 * snippets in a final summary without re-triggering execution.
 */

// First fenced block tagged js/javascript. Non-greedy body so the FIRST block
// wins when several are present. The language tag may be followed by trailing
// text on the same line (e.g. ```js copy) before the newline.
const JS_BLOCK = /```(?:js|javascript)\b[^\n]*\n([\s\S]*?)```/i;

/**
 * Return the trimmed source of the first js/javascript fenced block, or `null`
 * when the text contains none (or only an empty block).
 */
export function extractCode(text: string | null | undefined): string | null {
    if (!text) return null;
    const match = JS_BLOCK.exec(text);
    if (!match) return null;
    const code = match[1].trim();
    return code.length > 0 ? code : null;
}
