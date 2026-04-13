/**
 * MCP server for PMXT.
 *
 * Registers one tool per PMXT REST API endpoint. Each tool call is
 * translated into an HTTP POST to the PMXT API (hosted or sidecar).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, type ToolDef } from "./generated/tools.js";
import type { Config } from "./config.js";
import { callPmxtApi } from "./client.js";
import { reconstructArgs } from "./args.js";
import { compactResult } from "./shaper.js";

const INSTRUCTIONS = `PMXT is a unified API for prediction markets (Polymarket, Kalshi, Limitless, and more). \
Same methods, same response shape, regardless of venue.

SETUP: Get an API key at pmxt.dev/dashboard. Set PMXT_API_KEY in your environment.

DATA MODEL (Event -> Market -> Outcome):
- Event: a broad topic, e.g. "Who will win the 2028 presidential election?"
- Market: a specific tradeable question within an event, e.g. "Will Kamala Harris win the 2028 presidential election?"
- Outcome: the side you buy or sell, e.g. "Yes" (she wins) or "No" (she does not win).
When users say "market" they almost always mean an event. Use fetchEvents for discovery and search.

IMPORTANT RULES:
- NEVER place orders (createOrder, submitOrder) without explicit user confirmation. \
These spend real money. Always show the user the order details (venue, market, side, price, amount) and wait for approval.
- cancelOrder also requires user confirmation.
- Read-only tools (fetchMarkets, fetchOrderBook, etc.) are safe to call freely.
- Venue credentials (privateKey, apiKey) are sensitive. Never log or display them.

WORKFLOW:
1. Use fetchEvents to discover and search for topics (use the "query" param). This is the right starting point \
even when the user says "market" -- they almost always mean an event. Each event includes its child markets.
2. Use fetchMarkets only when you need a specific contract by ID/slug, or to list markets within a known event.
3. Use fetchOrderBook to check liquidity and prices.
4. Use getExecutionPrice to quote a trade before placing it.
5. Use buildOrder to preview, then submitOrder to execute (with user approval).

The "exchange" param is required on every call. Options: polymarket, kalshi, limitless, probable, etc.`;

export function createServer(config: Config): Server {
    const server = new Server(
        { name: "@pmxt/mcp", version: "0.1.0" },
        {
            capabilities: { tools: {} },
            instructions: INSTRUCTIONS,
        },
    );

    const toolMap = new Map<string, ToolDef>();
    for (const tool of TOOLS) {
        toolMap.set(tool.name, tool);
    }

    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
        })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: rawArgs } = request.params;
        const def = toolMap.get(name);
        if (!def) {
            return {
                content: [{ type: "text", text: `Unknown tool: ${name}` }],
                isError: true,
            };
        }

        const input = (rawArgs ?? {}) as Record<string, unknown>;
        const exchange = input.exchange as string;
        if (!exchange) {
            return {
                content: [
                    { type: "text", text: "Missing required parameter: exchange" },
                ],
                isError: true,
            };
        }

        // Separate credentials from the rest of the input
        const credentials = input.credentials as
            | Record<string, unknown>
            | undefined;
        const { exchange: _ex, credentials: _cred, verbose: _verbose, ...rest } = input;
        const verbose = input.verbose === true;

        const args = reconstructArgs(rest, def.args);

        try {
            const result = await callPmxtApi(config, {
                exchange,
                method: def.method,
                args,
                credentials,
            });
            const shaped = compactResult(def.method, result, verbose);
            return {
                content: [
                    { type: "text", text: JSON.stringify(shaped, null, 2) },
                ],
            };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `PMXT API error: ${message}` }],
                isError: true,
            };
        }
    });

    return server;
}
