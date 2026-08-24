// Ordered HTTPS transport, ported from oh-my-pi's
// packages/ai/src/providers/cowork-fetch.ts: stable header order over
// HTTP/1.1 with streaming decompression. Proxied and non-HTTPS requests
// deliberately fall back to global fetch (see the bypass notes below).
import type { ClientRequest, IncomingMessage } from "node:http";
import * as https from "node:https";
import * as stream from "node:stream";
import * as tls from "node:tls";
import * as zlib from "node:zlib";
import type { SpoofingProfile } from "./wire_format.ts";

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type CoworkTlsOptions = {
  ca?: string | string[];
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
  serverName?: string;
  ciphers?: string;
};

type CoworkRequestInit = RequestInit & {
  proxy?: string;
  tls?: CoworkTlsOptions;
};

type RequestBody = string | Uint8Array;

const directAgent = new https.Agent({ keepAlive: true });

/** Resolved at call time, so a proxy wrapper installed after this module loads is honored. */
const fallbackFetch: FetchImpl = (input, init) => globalThis.fetch(input, init as RequestInit);

function isHeaderRecord(headers: RequestInit["headers"]): headers is Record<string, string> {
  return headers !== undefined && !(headers instanceof Headers) && !Array.isArray(headers);
}

function resolveBody(body: RequestInit["body"]): RequestBody | undefined {
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  return undefined;
}

/**
 * Order the final header record for the wire: source order preserved, with the
 * Host header inserted before Accept-Encoding (or appended when absent) and
 * Content-Length computed and appended last. Node emits headers in record
 * order on an HTTP/1.1 request.
 */
export function buildOrderedHeaders(
  url: URL,
  source: Record<string, string>,
  body: RequestBody | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  let hasHost = false;
  let hasContentLength = false;
  for (const name in source) {
    const lowerName = name.toLowerCase();
    if (lowerName === "host") hasHost = true;
    if (lowerName === "content-length") hasContentLength = true;
    if (lowerName === "accept-encoding" && !hasHost) {
      headers.Host = url.host;
      hasHost = true;
    }
    headers[name] = source[name]!;
  }
  if (!hasHost) headers.Host = url.host;
  const length = typeof body === "string" ? Buffer.byteLength(body) : body?.byteLength;
  if (!hasContentLength && length !== undefined) headers["Content-Length"] = String(length);
  return headers;
}

// Headers the plugin enforces itself. Caller-supplied entries for these are
// always dropped when building the ordered record. Non-CLI profiles preserve
// other caller headers in arrival order; CLI rebuilds from this fixed set.
const MANAGED_HEADER_KEYS = new Set(
  [
    "accept",
    "accept-encoding",
    "anthropic-beta",
    "anthropic-dangerous-direct-browser-access",
    "anthropic-version",
    "authorization",
    "connection",
    "content-length",
    "content-type",
    "host",
    "user-agent",
    "x-api-key",
    "x-app",
    "x-client-request-id",
    "x-claude-code-session-id",
    // OpenCode internal session-routing headers.
    "x-session-affinity",
    "x-session-id",
    "x-parent-session-id",
    // Plugin-private transport markers, never sent on the wire.
    "x-claude-oauth-session-id",
    "x-claude-oauth-request-id",
    "x-claude-oauth-prompt-id",
  ].map((key) => key.toLowerCase()),
);

/**
 * Build the enforced header record in the selected client's exact order. CLI
 * uses the order observed in genuine Claude Code captures; Cowork uses OMP's
 * desktop-agent order. Host and Content-Length are inserted by the transport.
 */
export function buildEnforcedHeaders(
  caller: Headers,
  fields: {
    profile: SpoofingProfile["id"];
    userAgent: string;
    sessionId?: string;
    betas?: string;
    authorization: string;
    clientRequestId: string;
    stainless: Record<string, string>;
  },
): Record<string, string> {
  const order = fields.profile === "cowork" ? "cowork" : "cli";
  const managed = new Set(MANAGED_HEADER_KEYS);
  for (const key of Object.keys(fields.stainless)) managed.add(key.toLowerCase());
  const headers: Record<string, string> = {};
  const extras: Record<string, string> = {};
  if (fields.profile !== "cli") {
    caller.forEach((value, key) => {
      if (managed.has(key.toLowerCase())) return;
      extras[key] = value;
    });
  }
  if (order === "cowork") Object.assign(headers, extras);
  headers["Accept"] = "application/json";
  if (order === "cli") headers["Authorization"] = fields.authorization;
  headers["Content-Type"] = "application/json";
  headers["User-Agent"] = fields.userAgent;
  if (fields.sessionId) headers["X-Claude-Code-Session-Id"] = fields.sessionId;
  for (const [key, value] of Object.entries(fields.stainless)) headers[key] = value;
  if (fields.betas) headers["anthropic-beta"] = fields.betas;
  headers["anthropic-dangerous-direct-browser-access"] = "true";
  headers["anthropic-version"] = "2023-06-01";
  if (order === "cowork") headers["Authorization"] = fields.authorization;
  headers["x-app"] = "cli";
  headers["x-client-request-id"] = fields.clientRequestId;
  if (order === "cli") Object.assign(headers, extras);
  headers["Connection"] = "keep-alive";
  headers["Accept-Encoding"] = "gzip, deflate, br, zstd";
  return headers;
}

function resolveTlsOptions(url: URL, options: CoworkTlsOptions | undefined): tls.ConnectionOptions {
  const resolved: tls.ConnectionOptions = {
    ALPNProtocols: ["http/1.1"],
    ciphers: options?.ciphers ?? tls.DEFAULT_CIPHERS,
    rejectUnauthorized: options?.rejectUnauthorized ?? true,
    servername: options?.serverName ?? url.hostname,
  };
  if (options?.ca !== undefined) resolved.ca = options.ca;
  if (options?.cert !== undefined) resolved.cert = options.cert;
  if (options?.key !== undefined) resolved.key = options.key;
  return resolved;
}

function responseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers();
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    headers.append(message.rawHeaders[index]!, message.rawHeaders[index + 1]!);
  }
  return headers;
}

function decodedResponseStream(message: IncomingMessage): stream.Readable {
  const rawEncoding = message.headers["content-encoding"];
  const encoding = (Array.isArray(rawEncoding) ? rawEncoding[0] : rawEncoding)?.trim().toLowerCase();
  switch (encoding) {
    case "gzip":
      return message.pipe(zlib.createGunzip());
    case "deflate":
      return message.pipe(zlib.createInflate());
    case "br":
      return message.pipe(zlib.createBrotliDecompress());
    case "zstd":
      return message.pipe(zlib.createZstdDecompress());
    default:
      return message;
  }
}

function createResponse(message: IncomingMessage, method: string): Response {
  const status = message.statusCode;
  if (status === undefined) throw new Error("Cowork transport received a response without an HTTP status.");
  const hasBody = method !== "HEAD" && status !== 204 && status !== 304;
  const body = hasBody ? stream.Readable.toWeb(decodedResponseStream(message)) : null;
  return new Response(body, {
    status,
    statusText: message.statusMessage,
    headers: responseHeaders(message),
  });
}

async function sendCoworkRequest(
  url: URL,
  init: CoworkRequestInit,
  sourceHeaders: Record<string, string>,
  body: RequestBody | undefined,
): Promise<Response> {
  const method = init.method ?? "GET";
  const signal = init.signal ?? undefined;
  const tlsOptions = resolveTlsOptions(url, init.tls);
  const headers = buildOrderedHeaders(url, sourceHeaders, body);
  const result = Promise.withResolvers<Response>();
  let request: ClientRequest | undefined;
  const release = (): void => {
    signal?.removeEventListener("abort", abort);
  };
  const abort = (): void => {
    const reason = signal?.reason;
    request?.destroy(reason instanceof Error ? reason : new DOMException("The operation was aborted.", "AbortError"));
  };
  if (signal?.aborted) {
    release();
    signal.throwIfAborted();
  }
  signal?.addEventListener("abort", abort, { once: true });
  request = https.request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      agent: directAgent,
      ...tlsOptions,
    },
    (message) => {
      message.once("close", release);
      try {
        result.resolve(createResponse(message, method));
      } catch (error) {
        message.destroy();
        release();
        result.reject(error);
      }
    },
  );
  request.once("error", (error) => {
    release();
    result.reject(error);
  });
  request.end(body);
  return result.promise;
}

/**
 * Sends profiled HTTPS requests with stable header order, HTTP/1.1, and streaming decompression.
 *
 * Proxied requests deliberately leave this transport. It runs on `node:https`,
 * and Bun's shim ignores both `agent.createConnection` and
 * `options.createConnection`: a CONNECT tunnel handed to it is silently
 * discarded and the request dials the provider directly. Bun's own `fetch`
 * honors `init.proxy`, so a configured proxy wins over the Cowork profile.
 */
export const coworkFetch: FetchImpl = async (input, init) => {
  if (
    init === undefined ||
    input instanceof Request ||
    !isHeaderRecord(init.headers) ||
    ("proxy" in init && Boolean(init.proxy))
  ) {
    return fallbackFetch(input, init);
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return fallbackFetch(input, init);
  }
  if (url.protocol !== "https:") {
    return fallbackFetch(input, init);
  }
  const body = resolveBody(init.body);
  if (init.body != null && body === undefined) {
    return fallbackFetch(input, init);
  }
  return sendCoworkRequest(url, init, init.headers, body);
};

/**
 * Minimal injection seam: tests observe or replace the transport without
 * touching production callers, which all dispatch through `impl`.
 */
export const coworkTransport: { impl: FetchImpl } = { impl: coworkFetch };
