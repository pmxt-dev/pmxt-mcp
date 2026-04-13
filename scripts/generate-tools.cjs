'use strict';

/**
 * Generates MCP tool definitions from the PMXT OpenAPI spec.
 *
 * Reads:
 *   - spec/openapi.yaml       (endpoint descriptions, parameter schemas)
 *   - spec/method-verbs.json   (positional arg specs for runtime reconstruction)
 *
 * Writes:
 *   - src/generated/tools.ts
 *
 * Run: node scripts/generate-tools.cjs
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const OPENAPI_PATH = path.join(__dirname, '../spec/openapi.yaml');
const METHOD_VERBS_PATH = path.join(__dirname, '../spec/method-verbs.json');
const OUTPUT_PATH = path.join(__dirname, '../src/generated/tools.ts');

// Methods excluded from MCP (streaming, local-only, test)
const SKIP = new Set([
    'watchOrderBook', 'unwatchOrderBook',
    'watchTrades',
    'watchAddress', 'unwatchAddress',
    'close',
    'filterMarkets', 'filterEvents',
    'testDummyMethod',
    'healthCheck',
]);

// Methods that mutate state (order placement, cancellation)
const DESTRUCTIVE = new Set(['createOrder', 'submitOrder', 'cancelOrder']);

// Methods that are safe to retry (no side effects)
const IDEMPOTENT = new Set(['loadMarkets', 'buildOrder', 'getExecutionPrice', 'getExecutionPriceDetailed']);

// Methods that require venue credentials in the request body
const NEEDS_CREDENTIALS = new Set([
    'createOrder', 'buildOrder', 'submitOrder', 'cancelOrder',
    'fetchOrder', 'fetchOpenOrders', 'fetchMyTrades',
    'fetchClosedOrders', 'fetchAllOrders', 'fetchPositions', 'fetchBalance',
    'loadMarkets',
]);

// POST methods where the single object arg should be flattened into top-level
// properties. Maps operationId -> OpenAPI component schema name.
const FLATTEN_SCHEMAS = {
    createOrder: 'CreateOrderParams',
    buildOrder: 'CreateOrderParams',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRef(ref, spec) {
    // '#/components/schemas/Foo' -> spec.components.schemas.Foo
    const parts = ref.replace('#/', '').split('/');
    let obj = spec;
    for (const p of parts) obj = obj[p];
    return obj;
}

function kindToJsonType(kind) {
    switch (kind) {
        case 'string': return 'string';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'object': return 'object';
        default: return undefined; // omit type for 'unknown'
    }
}

function cleanSchemaForMcp(schema) {
    // Strip OpenAPI-specific fields that aren't valid JSON Schema
    const cleaned = { ...schema };
    delete cleaned.xml;
    delete cleaned.example;
    delete cleaned.nullable;
    // Recursively clean nested
    if (cleaned.properties) {
        const props = {};
        for (const [k, v] of Object.entries(cleaned.properties)) {
            props[k] = cleanSchemaForMcp(v);
        }
        cleaned.properties = props;
    }
    if (cleaned.items) {
        cleaned.items = cleanSchemaForMcp(cleaned.items);
    }
    if (cleaned.allOf) {
        cleaned.allOf = cleaned.allOf.map(cleanSchemaForMcp);
    }
    return cleaned;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const spec = yaml.load(fs.readFileSync(OPENAPI_PATH, 'utf8'));
    const methodVerbs = JSON.parse(fs.readFileSync(METHOD_VERBS_PATH, 'utf8'));

    // Extract exchange enum
    const exchangeParam = spec.components.parameters.ExchangeParam;
    const exchanges = exchangeParam.schema.enum;

    // Credentials schema (simplified for tool input)
    const credSchema = {
        type: 'object',
        description: 'Venue credentials (privateKey, apiKey, etc.). Only needed for authenticated operations like trading.',
        properties: {
            apiKey: { type: 'string' },
            apiSecret: { type: 'string' },
            passphrase: { type: 'string' },
            apiToken: { type: 'string' },
            privateKey: { type: 'string' },
            signatureType: { type: 'string' },
            funderAddress: { type: 'string' },
        },
    };

    const tools = [];

    for (const [pathStr, pathItem] of Object.entries(spec.paths)) {
        // Match /api/{exchange}/<method>
        const match = pathStr.match(/^\/api\/\{exchange\}\/(\w+)$/);
        if (!match) continue;

        const methodName = match[1];
        if (SKIP.has(methodName)) continue;

        // Pick the operation (GET or POST)
        const httpMethod = pathItem.get ? 'get' : 'post';
        const operation = pathItem.get || pathItem.post;
        if (!operation) continue;

        const operationId = operation.operationId || methodName;
        const verb = methodVerbs[methodName];
        if (!verb) {
            console.warn(`  SKIP: ${methodName} not in method-verbs.json`);
            continue;
        }

        // Build description
        const description = (operation.description || operation.summary || methodName).trim();

        // Build input schema
        const properties = {
            exchange: {
                type: 'string',
                enum: exchanges,
                description: 'The prediction market exchange to target.',
            },
        };
        const required = ['exchange'];

        // Track which arg indices are "flattened" for runtime reconstruction
        let flattenArgIndex = -1;

        if (httpMethod === 'get') {
            // Use OpenAPI query parameters
            const params = (operation.parameters || []).filter(p => {
                if (p.$ref) return false; // ExchangeParam
                return p.in === 'query';
            });
            for (const param of params) {
                const prop = { ...param.schema };
                if (param.description) prop.description = param.description;
                properties[param.name] = prop;
                if (param.required) required.push(param.name);
            }
            // GET methods expose query params as flat top-level properties.
            // If the runtime arg is a single object, mark it as flattened so
            // reconstructArgs collects the flat properties back into it.
            if (verb.args.length === 1 && verb.args[0].kind === 'object') {
                flattenArgIndex = 0;
            }
        } else {
            // POST - use method-verbs.json args
            const args = verb.args;

            if (args.length === 1 && args[0].kind === 'object' && FLATTEN_SCHEMAS[methodName]) {
                // Flatten the component schema's properties into top-level
                const schemaName = FLATTEN_SCHEMAS[methodName];
                const componentSchema = spec.components.schemas[schemaName];
                if (componentSchema && componentSchema.properties) {
                    for (const [name, prop] of Object.entries(componentSchema.properties)) {
                        properties[name] = cleanSchemaForMcp(prop);
                    }
                    for (const req of componentSchema.required || []) {
                        required.push(req);
                    }
                }
                flattenArgIndex = 0;
            } else if (args.length === 1 && args[0].kind === 'object' && methodName === 'submitOrder') {
                // submitOrder takes a BuiltOrder - keep as nested object
                const schemaName = 'BuiltOrder';
                const componentSchema = spec.components.schemas[schemaName];
                if (componentSchema) {
                    properties[args[0].name] = {
                        ...cleanSchemaForMcp(componentSchema),
                        description: componentSchema.description || 'The built order object from buildOrder.',
                    };
                } else {
                    properties[args[0].name] = { type: 'object', description: 'The built order object from buildOrder.' };
                }
                if (!args[0].optional) required.push(args[0].name);
            } else {
                // Multiple args or primitive args - add each by name
                for (const arg of args) {
                    const jsonType = kindToJsonType(arg.kind);
                    const prop = {};
                    if (jsonType) prop.type = jsonType;
                    // Add enum hints for known args
                    if (arg.name === 'side') {
                        prop.type = 'string';
                        prop.enum = ['buy', 'sell'];
                    }
                    if (arg.name === 'orderBook') {
                        prop.type = 'object';
                        prop.description = 'Order book with bids and asks arrays. Each level has price and size.';
                        prop.properties = {
                            bids: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, size: { type: 'number' } } } },
                            asks: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, size: { type: 'number' } } } },
                        };
                    }
                    properties[arg.name] = prop;
                    if (!arg.optional) required.push(arg.name);
                }
            }
        }

        // Add credentials for methods that need them
        if (NEEDS_CREDENTIALS.has(methodName)) {
            properties.credentials = credSchema;
        }

        // Add verbose flag to all tools (compact output by default)
        properties.verbose = {
            type: 'boolean',
            description: 'Return full uncompacted response. Default false returns a compact, agent-friendly summary.',
        };

        const inputSchema = {
            type: 'object',
            properties,
            required,
        };

        // Annotations
        const annotations = {};
        if (DESTRUCTIVE.has(methodName)) {
            annotations.destructiveHint = true;
        } else if (IDEMPOTENT.has(methodName)) {
            annotations.idempotentHint = true;
            annotations.readOnlyHint = false;
        } else {
            annotations.readOnlyHint = true;
        }

        tools.push({
            name: methodName,
            description,
            inputSchema,
            annotations,
            // Runtime metadata
            method: methodName,
            args: verb.args.map((a, i) => ({
                ...a,
                flatten: i === flattenArgIndex,
            })),
        });
    }

    // Sort alphabetically for stable output
    tools.sort((a, b) => a.name.localeCompare(b.name));

    // Generate TypeScript
    const lines = [
        '// AUTO-GENERATED by mcp/scripts/generate-tools.js -- DO NOT EDIT',
        `// Generated from core/src/server/openapi.yaml (${new Date().toISOString().split('T')[0]})`,
        '',
        'export interface ArgSpec {',
        '    name: string;',
        '    kind: string;',
        '    optional: boolean;',
        '    flatten: boolean;',
        '}',
        '',
        'export interface ToolDef {',
        '    name: string;',
        '    description: string;',
        '    inputSchema: Record<string, unknown>;',
        '    annotations: Record<string, boolean>;',
        '    method: string;',
        '    args: ArgSpec[];',
        '}',
        '',
        `export const TOOLS: ToolDef[] = ${JSON.stringify(tools, null, 2)};`,
        '',
    ];

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf8');

    console.log(`Generated ${tools.length} MCP tool definitions:`);
    for (const t of tools) {
        const flags = [];
        if (t.annotations.destructiveHint) flags.push('DESTRUCTIVE');
        if (t.annotations.readOnlyHint) flags.push('read-only');
        if (t.annotations.idempotentHint) flags.push('idempotent');
        console.log(`  + ${t.name} [${flags.join(', ')}]`);
    }
}

main();
