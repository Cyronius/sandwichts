/**
 * Shallow JSON-schema argument validation for sandbox tool calls. Checks the
 * top level only — required properties present, primitive types match —
 * which catches the common model mistakes (missing required arg, string for
 * array) without dragging in a full validator. Deep-shape errors still
 * surface from the handler itself.
 */
import type { ToolSchema } from '../types';

function typeOf(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function matches(expected: string, actual: string): boolean {
    if (expected === 'integer' || expected === 'number') return actual === 'number';
    return expected === actual;
}

/** Returns an error string, or null when the args pass the shallow check. */
export function shallowValidateArgs(schema: ToolSchema | undefined, args: unknown): string | null {
    if (!schema) return null;
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return `Expected an args object, got ${typeOf(args)}.`;
    }
    const record = args as Record<string, unknown>;
    const problems: string[] = [];
    for (const name of schema.required ?? []) {
        if (record[name] === undefined) problems.push(`missing required "${name}"`);
    }
    for (const [name, value] of Object.entries(record)) {
        if (value === undefined) continue;
        const prop = (schema.properties ?? {})[name] as { type?: string } | undefined;
        if (!prop?.type) continue;
        const actual = typeOf(value);
        if (!matches(prop.type, actual)) {
            problems.push(`"${name}" should be ${prop.type}, got ${actual}`);
        }
    }
    return problems.length ? `Invalid arguments: ${problems.join('; ')}.` : null;
}
