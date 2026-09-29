import { randomUUID } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate, createZstdDecompress } from "node:zlib";

/** Own the last hop so Effect cannot add trace headers or reorder our headers. */
export function createCliRelay() {
  const shutdown = new AbortController();
  const agent = new https.Agent({ keepAlive: true });
  const pending = new Map<string, { url: URL; headers: Record<string, string>; body: string; timer: ReturnType<typeof setTimeout> }>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const key = new URL(request.url).pathname;
      const prepared = pending.get(key);
      if (request.method !== "POST" || !prepared) return new Response(null, { status: 404 });
      pending.delete(key);
      clearTimeout(prepared.timer);
      // The capability selects an immutable prepared request; local callers
      // cannot supply an upstream URL, credentials, headers, or replacement body.
      const { url, headers, body } = prepared;
      const signal = AbortSignal.any([request.signal, shutdown.signal]);
      return new Promise<Response>((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        const upstream = transport.request(url, {
          method: "POST",
          ...(url.protocol === "https:" ? { agent } : {}),
          signal,
          headers: {
            ...headers,
            Connection: "keep-alive",
            Host: url.host,
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "Content-Length": String(Buffer.byteLength(body)),
          },
        }, (response) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const encoding = responseHeaders.get("content-encoding");
          const decompress = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate()
            : encoding === "br" ? createBrotliDecompress() : encoding === "zstd" ? createZstdDecompress() : undefined;
          if (decompress) {
            response.on("error", (error) => decompress.destroy(error));
            decompress.on("close", () => response.destroy());
            responseHeaders.delete("content-encoding");
            responseHeaders.delete("content-length");
          }
          responseHeaders.delete("connection");
          responseHeaders.delete("transfer-encoding");
          const stream = Readable.toWeb(decompress ? response.pipe(decompress) : response) as ReadableStream<Uint8Array>;
          resolve(new Response([204, 205, 304].includes(response.statusCode!) ? null : stream, {
            status: response.statusCode!, headers: responseHeaders,
          }));
        });
        upstream.on("error", reject);
        upstream.end(body);
      });
    },
    error() {
      // Let OpenCode's retry policy handle transport failures. Never return
      // runtime error pages containing request internals to the model.
      return Response.json({ type: "error", error: { type: "api_error", message: "Claude CLI upstream transport failed" } }, { status: 502 });
    },
  });
  return {
    forward(url: URL, headers: Record<string, string>, body: string, signal: AbortSignal): Request {
      const key = `/${randomUUID()}/v1/messages`;
      const timer = setTimeout(() => pending.delete(key), 60_000);
      timer.unref();
      pending.set(key, { url, headers, body, timer });
      return new Request(`http://127.0.0.1:${server.port}${key}`, { method: "POST", signal });
    },
    close() {
      shutdown.abort();
      server.stop(true);
      agent.destroy();
      for (const request of pending.values()) clearTimeout(request.timer);
      pending.clear();
    },
  };
}
