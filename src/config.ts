/**
 * Environment-based configuration for the PMXT MCP server.
 *
 * Precedence mirrors the SDK: PMXT_API_URL overrides everything,
 * otherwise default to the hosted endpoint when an API key is present
 * or localhost when running alongside the sidecar.
 */

const HOSTED_URL = "https://api.pmxt.dev";
const LOCAL_URL = "http://localhost:3847";

export interface Config {
    readonly apiUrl: string;
    readonly apiKey: string | undefined;
}

export function loadConfig(): Config {
    const apiKey = process.env.PMXT_API_KEY || undefined;
    const explicit = process.env.PMXT_API_URL;

    let apiUrl: string;
    if (explicit) {
        apiUrl = explicit;
    } else if (apiKey) {
        apiUrl = HOSTED_URL;
    } else {
        apiUrl = LOCAL_URL;
    }

    return Object.freeze({ apiUrl, apiKey });
}
