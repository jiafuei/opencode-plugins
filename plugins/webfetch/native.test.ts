import { afterAll, expect, test } from "bun:test";
import { request } from "./native.ts";

const files: string[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/redirect") return new Response("Intermediate redirect body", { status: 302, headers: { location: "/page", "set-cookie": "step=2; Path=/" } });
    if (url.pathname === "/ftp-redirect") return new Response(null, { status: 302, headers: { location: `ftp://127.0.0.1:${server.port}/file` } });
    if (url.pathname === "/slow") return new Promise<Response>(() => {});
    const body = JSON.stringify(Object.fromEntries(req.headers));
    return new Response(Bun.gzipSync(body), { headers: { "content-encoding": "gzip", "content-type": "application/json" } });
  },
});
afterAll(async () => {
  server.stop(true);
  for (const file of files) await Bun.file(file).delete();
});

test("follows HTTP redirects with the profile's headers and the cookie file", async () => {
  const cookies = `/tmp/opencode/webfetch-native-${crypto.randomUUID()}.txt`;
  files.push(cookies);
  await Bun.write(
    cookies,
    ["#HttpOnly_127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\tsecret", "other.example\tTRUE\t/\tFALSE\t0\tleak\tno", ""].join("\n"),
  );
  const headers = new Headers({ Accept: "text/markdown", "Cache-Control": "no-cache" });
  const response = await request(new URL(`http://127.0.0.1:${server.port}/redirect`), headers, AbortSignal.timeout(10_000), "chrome152", cookies);

  expect(response.status).toBe(200);
  expect(response.url).toBe(`http://127.0.0.1:${server.port}/page`);
  const sent = await response.json();
  expect(sent["user-agent"]).toContain("Chrome/152");
  expect(sent.accept).not.toBe("text/markdown");
  expect(sent["accept-encoding"]).toBe("gzip, deflate, br, zstd");
  expect(sent["cache-control"]).toBe("no-cache");
  expect(sent.cookie.split("; ").sort()).toEqual(["session=secret", "step=2"]);
  await expect(request(new URL(`http://127.0.0.1:${server.port}/ftp-redirect`), new Headers(), AbortSignal.timeout(1_000)))
    .rejects.toThrow("Unsupported protocol");
});

test("aborts an in-flight transfer", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const pending = request(new URL(`http://127.0.0.1:${server.port}/slow`), new Headers(), controller.signal);
  await expect(pending).rejects.toHaveProperty("name", "AbortError");
});
