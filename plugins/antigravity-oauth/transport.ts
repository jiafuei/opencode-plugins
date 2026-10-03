/**
 * Fetch-compatible clients for the calls this plugin makes itself, framed like
 * the native Antigravity clients. Bun's fetch sorts header names and adds
 * `Accept` and `Connection`; node:https and node:http2 send headers exactly as
 * given. They take plain-object headers and string or URLSearchParams bodies,
 * and buffer the (decompressed) response.
 */

import http2 from "node:http2";
import https from "node:https";
import zlib from "node:zlib";

type ResponseHeaders = Record<string, string | string[] | number | undefined>;

function toResponse(status: number, headers: ResponseHeaders, chunks: Buffer[]): Response {
  const raw = Buffer.concat(chunks);
  const encoding = headers["content-encoding"];
  const body =
    encoding === "gzip"
      ? zlib.gunzipSync(raw)
      : encoding === "deflate"
        ? zlib.inflateSync(raw)
        : encoding === "br"
          ? zlib.brotliDecompressSync(raw)
          : raw;
  const out = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(":") || name === "content-encoding" || name === "content-length" || value === undefined) continue;
    for (const entry of [value].flat()) out.append(name, String(entry));
  }
  return new Response(body, { status, headers: out });
}

function http1(url: string, init: RequestInit, body: string | undefined, headers: Record<string, string>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: init.method ?? "GET", headers, signal: init.signal ?? undefined }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve(toResponse(response.statusCode!, response.headers, chunks)));
      response.on("error", reject);
    });
    // Without an explicit Connection header, send none (the Go client's framing).
    if (!("Connection" in headers)) request.removeHeader("Connection");
    request.on("error", reject);
    request.end(body);
  });
}

/**
 * The language server's Go HTTP/1.1 client: Host, User-Agent, Content-Length,
 * then the remaining headers in the given order, and no Connection header.
 */
export const goFetch = ((url: string, init: RequestInit = {}) => {
  const { "User-Agent": userAgent, ...rest } = init.headers as Record<string, string>;
  const body = init.body == null ? undefined : String(init.body);
  return http1(url, init, body, {
    Host: new URL(url).host,
    "User-Agent": userAgent!,
    ...(body === undefined ? {} : { "Content-Length": String(Buffer.byteLength(body)) }),
    ...rest,
  });
}) as typeof fetch;

/**
 * The IDE's Node client (google-api-nodejs-client over gaxios): lowercase
 * header names sorted with `accept` and `content-length`, then Host and
 * `Connection: close`.
 */
export const nodeFetch = ((url: string, init: RequestInit = {}) => {
  const body = init.body == null ? undefined : String(init.body);
  const headers: Record<string, string> = { accept: "*/*" };
  for (const [name, value] of Object.entries(init.headers as Record<string, string>)) headers[name.toLowerCase()] = value;
  if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
  const sorted = Object.entries(headers).sort(([a], [b]) => (a < b ? -1 : 1));
  return http1(url, init, body, { ...Object.fromEntries(sorted), Host: new URL(url).host, Connection: "close" });
}) as typeof fetch;

/**
 * The language server's Go HTTP/2 client (token refresh): pseudo-headers,
 * the given headers, then content-length, accept-encoding, and user-agent.
 */
export const go2Fetch = ((url: string, init: RequestInit = {}) => {
  const target = new URL(url);
  const { "User-Agent": userAgent, "Accept-Encoding": acceptEncoding, ...rest } = init.headers as Record<string, string>;
  const body = String(init.body);
  return new Promise((resolve, reject) => {
    const session = http2.connect(target.origin);
    const fail = (error: unknown) => {
      session.destroy();
      reject(error);
    };
    session.on("error", fail);
    const stream = session.request(
      {
        ":authority": target.host,
        ":method": init.method ?? "GET",
        ":path": `${target.pathname}${target.search}`,
        ":scheme": "https",
        ...Object.fromEntries(Object.entries(rest).map(([name, value]) => [name.toLowerCase(), value])),
        "content-length": String(Buffer.byteLength(body)),
        "accept-encoding": acceptEncoding!,
        "user-agent": userAgent!,
      },
      { signal: init.signal ?? undefined },
    );
    let headers: ResponseHeaders = {};
    const chunks: Buffer[] = [];
    stream.on("response", (received) => (headers = received));
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      session.close();
      resolve(toResponse(Number(headers[":status"]), headers, chunks));
    });
    stream.on("error", fail);
    stream.end(body);
  });
}) as typeof fetch;
