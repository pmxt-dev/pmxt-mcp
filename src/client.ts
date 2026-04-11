/**
 * HTTP client for the PMXT REST API.
 *
 * Every MCP tool call becomes a POST to /api/{exchange}/{method} with
 * the standard { args, credentials? } body shape. POST works for all
 * endpoints (reads and writes) on both the hosted API and the sidecar.
 */

import type { Config } from "./config.js";

export interface CallOptions {
    readonly exchange: string;
    readonly method: string;
    readonly args: unknown[];
    readonly credentials?: Record<string, unknown>;
}

export async function callPmxtApi(
    config: Config,
    options: CallOptions,
): Promise<unknown> {
    const url = `${config.apiUrl}/api/${encodeURIComponent(options.exchange)}/${encodeURIComponent(options.method)}`;

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const body: Record<string, unknown> = { args: options.args };
    if (options.credentials && Object.keys(options.credentials).length > 0) {
        body.credentials = options.credentials;
    }

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });

    const json = (await response.json()) as Record<string, unknown>;

    if (!response.ok || json.success === false) {
        const err = json.error as Record<string, unknown> | string | undefined;
        const message =
            typeof err === "string"
                ? err
                : typeof err === "object" && err !== null
                  ? (err.message as string) || JSON.stringify(err)
                  : response.statusText;
        throw new Error(message);
    }

    return json.data;
}
