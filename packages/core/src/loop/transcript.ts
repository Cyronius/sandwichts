/**
 * transcript — render a script's execution transcript as the next user-turn
 * message (SW-TRANSCRIPT, SW-UNKNOWN-FN).
 *
 * Each bridged call is shown as `await name(args) => result`, so the model
 * sees exactly what ran and what came back. On error, the failing tail and
 * the thrown message are included so the model can correct on the next turn.
 * When the error is a missing-function call, the available API names are
 * appended so the model stops re-guessing.
 */
import type { TranscriptEntry, TranscriptMessage } from '../types';

// Id prefix for the inter-iteration execution-transcript messages built below.
// These live ONLY in the loop-local conversation (the wire history) so the
// model sees what its script did — they are never pushed into any shared
// display state (SW-LOOP).
export const CODE_RESULT_ID_PREFIX = 'code_result_';

// Per-result truncation so a fat read resubmitted as text doesn't blow the
// context window. The full result still reached the model's script live; this
// only bounds what we echo back as the next turn's prompt.
export const MAX_RESULT_CHARS = 6000;

function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}… [truncated ${text.length - maxChars} chars]`;
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * A `ReferenceError: foo is not defined` (the model called a function not in
 * the API) or the host's own `Unknown function: foo`. On these, echoing the
 * real API names back lets the model self-correct in one turn instead of
 * re-guessing (SW-UNKNOWN-FN).
 */
export function looksLikeMissingFunction(error: string): boolean {
    return / is not defined\b/.test(error) || /^Unknown function:/.test(error);
}

/** Render the transcript + error as the feedback text for the next user turn. */
export function buildTranscriptFeedback(
    transcript: TranscriptEntry[],
    error: string | undefined,
    availableFunctions: string[] = [],
    maxResultChars: number = MAX_RESULT_CHARS,
): string {
    const lines: string[] = [];
    if (transcript.length === 0) {
        lines.push('No tool calls were executed.');
    } else {
        lines.push(`Executed ${transcript.length} tool call(s):`);
        for (const entry of transcript) {
            const args = truncate(safeJson(entry.args), maxResultChars);
            if ('result' in entry) {
                lines.push(`- await ${entry.name}(${args}) => ${truncate(safeJson(entry.result), maxResultChars)}`);
            } else {
                // Recorded but never resolved — the script threw mid-call.
                lines.push(`- await ${entry.name}(${args}) => (did not complete)`);
            }
        }
    }

    if (error) {
        lines.push('');
        lines.push(`Script error: ${error}`);
        if (availableFunctions.length > 0 && looksLikeMissingFunction(error)) {
            lines.push(
                `Available functions: ${[...availableFunctions].sort().join(', ')}. `
                + 'Call only these — do not invent function names.',
            );
        }
        lines.push('Fix the problem and write a corrected ```js block, or explain the issue if it cannot be resolved.');
    } else {
        lines.push('');
        lines.push('Write another ```js block to continue, or a plain-text summary if the task is complete.');
    }

    return lines.join('\n');
}

/**
 * Wrap the feedback as the next user-turn wire message. Lives only in the
 * loop-local conversation — never in shared display state.
 */
export function buildTranscriptMessage(
    transcript: TranscriptEntry[],
    error: string | undefined,
    iteration: number,
    availableFunctions: string[] = [],
    maxResultChars: number = MAX_RESULT_CHARS,
): TranscriptMessage {
    return {
        id: `${CODE_RESULT_ID_PREFIX}${iteration}_${transcript.length}`,
        role: 'user',
        content: buildTranscriptFeedback(transcript, error, availableFunctions, maxResultChars),
    };
}
