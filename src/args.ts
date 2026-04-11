/**
 * Reconstruct the positional args array from flat MCP tool input.
 *
 * MCP tools receive a flat { key: value } object. The PMXT REST API
 * expects a positional args array: POST body { args: [...] }.
 *
 * This module bridges the two using the ArgSpec metadata embedded in
 * each generated tool definition.
 */

import type { ArgSpec } from "./generated/tools.js";

/**
 * Given a flat input object (with exchange and credentials already
 * removed) and the arg spec for the method, produce the positional
 * args array the sidecar expects.
 */
export function reconstructArgs(
    input: Record<string, unknown>,
    argSpec: readonly ArgSpec[],
): unknown[] {
    const args: unknown[] = [];
    // Names of non-flattened args so we can exclude them when collecting
    // properties for a flattened object arg.
    const namedArgs = new Set(
        argSpec.filter((s) => !s.flatten).map((s) => s.name),
    );

    for (const spec of argSpec) {
        if (spec.flatten) {
            // This arg's properties were spread into the top-level input.
            // Collect everything that isn't a named primitive arg.
            const obj: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(input)) {
                if (!namedArgs.has(key) && value !== undefined) {
                    obj[key] = value;
                }
            }
            args.push(Object.keys(obj).length > 0 ? obj : undefined);
        } else {
            const value = input[spec.name];
            args.push(value !== undefined ? value : undefined);
        }
    }

    // Trim trailing undefineds so optional tail params stay optional.
    while (args.length > 0 && args[args.length - 1] === undefined) {
        args.pop();
    }

    return args;
}
