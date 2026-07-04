/**
 * buildJsApi — render the code-mode JavaScript API surface from tool
 * definitions (SW-JSAPI).
 *
 * Code mode drives the app by having the model write a ```js code block that
 * calls the registered tool handlers as `await` functions, instead of emitting
 * native JSON tool calls. The escaping cascade that degrades models on
 * deeply-nested escaped tool arguments disappears when markup lives in
 * backtick template literals inside JS source.
 *
 * This module is PURE and unit-testable: it takes tool definitions and emits
 * (a) an LLM-facing block of JSDoc'd async function signatures for the system
 * prompt, and (b) the list of exposed function names the worker stubs out
 * (the capability whitelist). It only reads `definition.parameters` (a JSON
 * schema) — never the handlers.
 */
import type { ToolSpec } from '../types';

export interface JsApi {
    /** Concatenated JSDoc + `async function name(args)` signature block. */
    signatures: string;
    /** Exposed function names, in definition order — the worker capability whitelist. */
    apiNames: string[];
}

type JsonSchema = {
    type?: string;
    description?: string;
    enum?: unknown[];
    items?: JsonSchema;
    properties?: Record<string, JsonSchema>;
    required?: string[];
};

/**
 * Map a single JSON-schema node to a JSDoc-style type expression. Kept
 * deliberately shallow — nested object/array shapes render as `Object` /
 * `Array<...>` rather than a fully-expanded type, which is enough for the
 * model to call the function correctly (the per-prop descriptions carry the
 * detail).
 */
function jsdocType(schema: JsonSchema | undefined): string {
    if (!schema) return '*';
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
    }
    switch (schema.type) {
        case 'string':
            return 'string';
        case 'integer':
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'array':
            return `Array<${jsdocType(schema.items)}>`;
        case 'object':
            return 'Object';
        default:
            return '*';
    }
}

/** Render the JSDoc + signature for one tool definition. */
function renderSignature(def: ToolSpec): string {
    const params = (def.parameters ?? {}) as JsonSchema;
    const props = params.properties ?? {};
    const required = new Set(params.required ?? []);

    const lines: string[] = ['/**'];
    // The description can be long; keep it on one line — JSDoc tooling and the
    // model both read it fine, and re-wrapping risks mangling embedded markup.
    lines.push(` * ${def.description}`);
    lines.push(' * @param {Object} args');
    for (const [name, schema] of Object.entries(props)) {
        const type = jsdocType(schema);
        const isRequired = required.has(name);
        const argRef = isRequired ? `args.${name}` : `[args.${name}]`;
        const desc = schema.description ? ` - ${schema.description}` : '';
        lines.push(` * @param {${type}} ${argRef}${desc}`);
    }
    lines.push(' * @returns {Promise<Object>} The tool result object.');
    lines.push(' */');
    lines.push(`async function ${def.name}(args) { /* bridged to the app */ }`);
    return lines.join('\n');
}

/**
 * Build the JS API surface from a map of tool-definition carriers (anything
 * with a `definition` — lm-ag-ui `ToolDefinition`s and SandwichTS
 * `CodeModeTool`s both fit). Order follows the map's iteration order.
 */
export function buildJsApi(
    tools: Record<string, { definition?: ToolSpec } | undefined>,
): JsApi {
    const defs = Object.values(tools)
        .map((t) => t?.definition)
        .filter((d): d is ToolSpec => !!d && typeof d.name === 'string');

    return {
        signatures: defs.map(renderSignature).join('\n\n'),
        apiNames: defs.map((d) => d.name),
    };
}
