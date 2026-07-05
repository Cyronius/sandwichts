/**
 * logCode — opt-in browser console logging of emitted code (SW-CODE-LOG).
 *
 * Distinct from `display.ts`'s `isDevCodeRevealEnabled` (which reveals hidden
 * code in the chat UI): this logs the raw code to devtools, gated on its own
 * localStorage flag so it stays silent by default.
 */

/** Reads localStorage key `sandwichLogCode`, try/catch-guarded, false by default. */
export function isDevCodeLogEnabled(): boolean {
    try {
        return !!localStorage.getItem('sandwichLogCode');
    } catch {
        return false;
    }
}

/** Logs `code` to the console (grouped by iteration) when the dev flag is on; no-op otherwise. */
export function logCodeEmission(code: string, iteration: number): void {
    if (!isDevCodeLogEnabled()) return;
    console.groupCollapsed(`[sandwich] code emitted (iteration ${iteration})`);
    console.log(code);
    console.groupEnd();
}
