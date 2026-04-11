# @pmxt/mcp

MCP server that exposes the [PMXT](https://pmxt.dev) unified prediction market API as tools for Claude and other AI agents.

One tool per API method. Same interface regardless of venue -- Polymarket, Kalshi, Limitless, Probable, Baozi, Myriad, Opinion, Metaculus, Smarkets, and more.

## Quick start

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "pmxt": {
      "command": "npx",
      "args": ["-y", "@pmxt/mcp"],
      "env": {
        "PMXT_API_KEY": "pmxt_live_..."
      }
    }
  }
}
```

Or run directly:

```sh
PMXT_API_KEY=pmxt_live_... npx @pmxt/mcp
```

Get an API key at [pmxt.dev/dashboard](https://pmxt.dev/dashboard).

## Modes

The MCP server doesn't run prediction market logic itself -- it forwards every tool call to a PMXT API server over HTTP. Where that server lives depends on the mode:

**Hosted** -- Set `PMXT_API_KEY` and the server calls `https://api.pmxt.dev`. No local setup required; the hosted service manages exchange connections, caching, and rate limits for you.

**Local (sidecar)** -- If no API key is set, the server assumes you're running the PMXT core server locally on `http://localhost:3847`. This is useful for development, self-hosting, or when you want full control over the runtime. See the [pmxt core repo](https://github.com/pmxt-dev/pmxt) for how to run the server.

You can point at any PMXT-compatible server by setting `PMXT_API_URL` explicitly.

## Environment variables

| Variable | Description |
|----------|-------------|
| `PMXT_API_KEY` | API key for the hosted PMXT service |
| `PMXT_API_URL` | Override the API base URL (defaults based on mode) |

## Tools

Every tool requires an `exchange` parameter (e.g. `polymarket`, `kalshi`, `limitless`). Read-only tools are safe to call freely. Order-related tools (`createOrder`, `submitOrder`, `cancelOrder`) require explicit user confirmation -- they spend real money.

**Market discovery:** `fetchMarkets`, `fetchMarketsPaginated`, `fetchEvents`, `fetchEvent`, `fetchMarket`

**Order book & pricing:** `fetchOrderBook`, `fetchTrades`, `fetchOHLCV`, `getExecutionPrice`, `getExecutionPriceDetailed`

**Trading:** `buildOrder`, `createOrder`, `submitOrder`, `cancelOrder`

**Account:** `fetchBalance`, `fetchPositions`, `fetchOpenOrders`, `fetchClosedOrders`, `fetchAllOrders`, `fetchOrder`, `fetchMyTrades`, `loadMarkets`

## How it works

The server translates MCP tool calls into HTTP requests to the PMXT REST API:

1. Agent calls a tool (e.g. `fetchMarkets`) with flat `{ exchange, limit, query }` input
2. The server reconstructs positional arguments from the flat input using embedded arg specs
3. Sends `POST /api/{exchange}/{method}` with `{ args: [...] }` to the PMXT API
4. Returns the JSON response to the agent

## Auto-generation pipeline

The tool definitions in `src/generated/tools.ts` are **not hand-written**. They are generated from the PMXT core OpenAPI spec by `scripts/generate-tools.cjs`.

The full pipeline runs automatically on every PMXT release:

1. A new version tag (`v*`) is pushed to the [pmxt core repo](https://github.com/pmxt-dev/pmxt)
2. The [`sync-mcp.yml`](https://github.com/pmxt-dev/pmxt/blob/main/.github/workflows/sync-mcp.yml) GitHub Actions workflow triggers
3. It clones this repo, copies the latest spec files from core into `spec/`:
   - [`core/src/server/openapi.yaml`](https://github.com/pmxt-dev/pmxt/blob/main/core/src/server/openapi.yaml) -- full API spec (endpoints, parameters, response schemas)
   - [`core/src/server/method-verbs.json`](https://github.com/pmxt-dev/pmxt/blob/main/core/src/server/method-verbs.json) -- HTTP verb and positional argument metadata per method
4. Runs `node scripts/generate-tools.cjs` to regenerate `src/generated/tools.ts`
5. Bumps `package.json` to match the core version
6. Commits, tags, and pushes to this repo
7. Publishes to npm with `npm publish --provenance --access public`

**What the generator does:**
- Reads both spec files
- Skips streaming/internal methods (`watchOrderBook`, `close`, `healthCheck`, etc.)
- Flattens complex parameters into flat MCP tool input schemas
- Embeds `ArgSpec` metadata so the server can reconstruct positional args at runtime
- Adds annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) per tool
- Marks order-related tools with a `credentials` input property

To regenerate locally:

```sh
npm run generate
```

## Development

```sh
npm install
npm run generate   # regenerate tools from spec/
npm run build      # compile TypeScript
```

## License

MIT
