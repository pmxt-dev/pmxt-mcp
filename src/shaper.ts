/**
 * Compacts MCP tool responses for agent consumption.
 * When verbose=false (default), strips fields that bloat context windows
 * without adding decision-relevant information.
 */

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: unknown, maxLen: number): string {
    if (typeof s !== "string") return "";
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + "...";
}

// Flatten outcomes into compact {marketId, outcomes: [{label, price}]}
function compactMarket(m: unknown): Rec {
    const src = m as Rec;
    const outcomes = Array.isArray(src.outcomes)
        ? (src.outcomes as Rec[]).map((o) => ({
              label: o.label,
              price: o.price,
          }))
        : [];

    return {
        marketId: src.marketId,
        title: src.title,
        outcomes,
        ...(src.volume24h != null && { volume24h: src.volume24h }),
        ...(src.liquidity != null && { liquidity: src.liquidity }),
        ...(src.status != null && src.status !== "active" && { status: src.status }),
    };
}

// Standalone market (fetchMarket) -- slightly more detail since agent asked for one specific market
function compactSingleMarket(m: unknown): Rec {
    const src = m as Rec;
    const outcomes = Array.isArray(src.outcomes)
        ? (src.outcomes as Rec[]).map((o) => ({
              outcomeId: o.outcomeId,
              label: o.label,
              price: o.price,
          }))
        : [];

    return {
        marketId: src.marketId,
        eventId: src.eventId,
        title: src.title,
        description: truncate(src.description, 200),
        outcomes,
        ...(src.resolutionDate != null && { resolutionDate: src.resolutionDate }),
        ...(src.volume24h != null && { volume24h: src.volume24h }),
        ...(src.liquidity != null && { liquidity: src.liquidity }),
        ...(src.openInterest != null && { openInterest: src.openInterest }),
        ...(src.status != null && { status: src.status }),
        ...(src.tickSize != null && { tickSize: src.tickSize }),
    };
}

const NESTED_MARKETS_LIMIT = 5;

function compactEvent(e: unknown): Rec {
    const src = e as Rec;
    const allMarkets = Array.isArray(src.markets)
        ? (src.markets as unknown[]).map(compactMarket)
        : [];

    const markets =
        allMarkets.length > NESTED_MARKETS_LIMIT
            ? allMarkets.slice(0, NESTED_MARKETS_LIMIT)
            : allMarkets;

    return {
        id: src.id,
        title: src.title,
        description: truncate(src.description, 200),
        markets,
        ...(allMarkets.length > NESTED_MARKETS_LIMIT && {
            _totalMarkets: allMarkets.length,
        }),
        ...(src.volume24h != null && { volume24h: src.volume24h }),
    };
}

function compactBuildOrder(data: unknown): Rec {
    const src = data as Rec;
    const { raw: _raw, signedOrder: _signed, ...rest } = src;
    return rest;
}

const ORDER_BOOK_DEPTH = 10;

function compactOrderBook(data: unknown): Rec {
    const src = data as Rec;
    const bids = Array.isArray(src.bids) ? src.bids.slice(0, ORDER_BOOK_DEPTH) : [];
    const asks = Array.isArray(src.asks) ? src.asks.slice(0, ORDER_BOOK_DEPTH) : [];
    return {
        bids,
        asks,
        ...(Array.isArray(src.bids) && src.bids.length > ORDER_BOOK_DEPTH && {
            _totalBids: src.bids.length,
        }),
        ...(Array.isArray(src.asks) && src.asks.length > ORDER_BOOK_DEPTH && {
            _totalAsks: src.asks.length,
        }),
    };
}

const TRADES_LIMIT = 20;

function compactTrades(data: unknown): unknown {
    if (!Array.isArray(data)) return data;
    const trades = data.slice(0, TRADES_LIMIT).map((t) => {
        const src = t as Rec;
        return {
            price: src.price,
            amount: src.amount,
            side: src.side,
            timestamp: src.timestamp,
        };
    });
    return trades;
}

const OHLCV_LIMIT = 50;

function compactOHLCV(data: unknown): unknown {
    if (!Array.isArray(data)) return data;
    return data.slice(0, OHLCV_LIMIT);
}

function compactOrder(o: unknown): Rec {
    const src = o as Rec;
    return {
        id: src.id,
        marketId: src.marketId,
        outcomeId: src.outcomeId,
        side: src.side,
        price: src.price,
        amount: src.amount,
        filled: src.filled,
        remaining: src.remaining,
        status: src.status,
    };
}

function compactOrders(data: unknown): unknown {
    if (!Array.isArray(data)) return data;
    return data.map(compactOrder);
}

// ---------------------------------------------------------------------------
// Per-tool dispatch
// ---------------------------------------------------------------------------

const COMPACTORS: Record<string, (data: unknown) => unknown> = {
    fetchEvents: (data) =>
        Array.isArray(data) ? data.map(compactEvent) : data,

    fetchEvent: (data) => compactEvent(data),

    fetchMarkets: (data) =>
        Array.isArray(data) ? data.map(compactSingleMarket) : data,

    fetchMarket: (data) => compactSingleMarket(data),

    fetchMarketsPaginated: (data) => {
        const src = data as Rec;
        return {
            data: Array.isArray(src.data)
                ? src.data.map(compactSingleMarket)
                : src.data,
            total: src.total,
            nextCursor: src.nextCursor,
        };
    },

    buildOrder: (data) => compactBuildOrder(data),

    fetchOrderBook: (data) => compactOrderBook(data),

    fetchTrades: (data) => compactTrades(data),
    fetchMyTrades: (data) => compactTrades(data),

    fetchOHLCV: (data) => compactOHLCV(data),

    fetchOrder: (data) => compactOrder(data),
    fetchOpenOrders: (data) => compactOrders(data),
    fetchClosedOrders: (data) => compactOrders(data),
    fetchAllOrders: (data) => compactOrders(data),

    createOrder: (data) => compactOrder(data),
    cancelOrder: (data) => compactOrder(data),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compactResult(
    toolName: string,
    data: unknown,
    verbose: boolean,
): unknown {
    if (verbose) return data;

    const compactor = COMPACTORS[toolName];
    if (!compactor) return data;

    return compactor(data);
}
