/**
 * compose — assemble the code-mode system prompt (SW-PROMPT).
 *
 * The driving guide (HOW to operate in code mode) is framework-owned and
 * app-agnostic. Everything domain-specific — app context, style rules, scope
 * policies — is supplied by the consumer as `rules` / `appContext` blocks.
 */

/**
 * The one piece of guidance unique to the code-mode path — how to drive the
 * app by writing JS instead of emitting native JSON tool calls. Ported from
 * the lm-admin driving guide with the domain-specific rules removed.
 */
export const DEFAULT_DRIVING_GUIDE =
    'DRIVE THE APP BY WRITING JAVASCRIPT.\n'
    + 'Instead of calling tools directly, write ONE ```js code block that calls the API functions below as `await` calls. '
    + 'After your block runs you will get a message with each call and its result — then write another ```js block to continue, '
    + 'or a plain-text summary (NO code block) when the task is complete. A reply with no ```js block ends the turn.\n'
    + '- Put markup and other quote-heavy strings in backtick template literals so quotes never need escaping.\n'
    + '- You may read then write in the same block: const res = await get_items({}); await update_item({ id: res.items[0].id, /* … */ });\n'
    + '- Run INDEPENDENT calls in parallel: gather their promises and `await Promise.all([…])` instead of awaiting one-by-one. '
    + 'Only await sequentially when a later call needs an earlier call\'s result.\n'
    + '- Results are plain objects — inspect them (check error fields) and branch instead of assuming success.\n'
    + '- Keep each block focused; do not wrap it in a function or add imports — just top-level `await` statements.';

export interface ComposePromptParts {
    /** Override the framework driving guide (rarely needed). */
    drivingGuide?: string;
    /** The `buildJsApi(...)` signatures block (frontend + remote groups pre-joined). */
    signatures: string;
    /** Name of the read-only context binding in script scope; default 'appContext'. */
    contextName?: string;
    /** Consumer-serialized app state; omit for context-free apps. */
    appContext?: string;
    /** Domain guidance blocks, appended between the binding line and the context. */
    rules?: string[];
}

/**
 * Compose the full code-mode system prompt. Ordering: driving guide, API
 * signatures, context-binding line (when context is present), consumer rules,
 * serialized app context last.
 */
export function composeSystemPrompt(parts: ComposePromptParts): string {
    const contextName = parts.contextName ?? 'appContext';
    const lines: string[] = [
        parts.drivingGuide ?? DEFAULT_DRIVING_GUIDE,
        `Available API functions:\n${parts.signatures}`,
    ];
    if (parts.appContext != null) {
        // The binding is a real in-scope object in the generated code — make
        // that explicit so the model reads it directly instead of fetching.
        lines.push(
            `In your \`\`\`js code, \`${contextName}\` is an in-scope READ-ONLY object — the same payload shown under `
            + `"Current app context" below. Read it directly (no import, no fetch).`,
        );
    }
    lines.push(...(parts.rules ?? []));
    if (parts.appContext != null) {
        lines.push(`Current app context:\n${parts.appContext}`);
    }
    return lines.join('\n\n');
}
