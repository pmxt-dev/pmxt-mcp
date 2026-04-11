#!/usr/bin/env node

/**
 * Entry point for the PMXT MCP server.
 *
 * Usage:
 *   npx @pmxt/mcp                          # hosted mode (needs PMXT_API_KEY)
 *   PMXT_API_KEY=pmxt_live_... npx @pmxt/mcp
 *   PMXT_API_URL=http://localhost:3847 npx @pmxt/mcp  # sidecar mode
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig();
const server = createServer(config);
const transport = new StdioServerTransport();
await server.connect(transport);
