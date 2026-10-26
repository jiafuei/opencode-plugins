import koffi from "koffi";
import { rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { rootCertificates } from "node:tls";
import { CURL_VERSION, type NativeProfile } from "./profiles.ts";

// Official libcurl-impersonate release assets and their GitHub-published SHA-256 digests.
const ASSETS: Record<string, [target: string, sha256: string]> = {
  "linux-x64-gnu": ["x86_64-linux-gnu", "2cee4e85a7e0ac713642fdbb1be87b0d40e60aca46db8a77335cba7e1b3828cd"],
  "linux-x64-musl": ["x86_64-linux-musl", "83524540f6691becc12094f152c2e1b80045d0f4d65e854cedc3ca29bc169ef8"],
  "linux-arm64-gnu": ["aarch64-linux-gnu", "b8450a30288106260c3bd034ccb35d36ae72d6ec23e435bc84eef5a1c6b0cebf"],
  "linux-arm64-musl": ["aarch64-linux-musl", "30179d3e138b4d4a44a9e7f9fc32cbb8b930b045df74050664b40a1a9159ae56"],
  "darwin-x64": ["x86_64-macos", "4aa8827563cf1d3b04293cc8944555b41b0a7e5608832e8c0891ccba495d801e"],
  "darwin-arm64": ["arm64-macos", "dc0b272b75a6f16b1e6f36be18609d12f800d63ec6f9125027db49938360937e"],
  "win32-x64": ["x86_64-win32", "22753b8eaeb2d69fa4272e0b8282106e6d411195e6515399a21767c26750a64c"],
  "win32-arm64": ["arm64-win32", "e3d549b9036c824b785e670bedb04a772f8930e34468fa604dd925ca7c3f1f8f"],
};
const LIBRARY_FILES: Record<string, string> = {
  linux: "libcurl-impersonate.so.4.8.0",
  darwin: "libcurl-impersonate.4.8.0.dylib",
  win32: "lib/libcurl-impersonate.dll",
};

const CURLOPT_URL = 10002;
const CURLOPT_WRITEFUNCTION = 20011;
const CURLOPT_HTTPHEADER = 10023;
const CURLOPT_COOKIEFILE = 10031;
const CURLOPT_NOPROGRESS = 43;
const CURLOPT_FOLLOWLOCATION = 52;
const CURLOPT_MAXREDIRS = 68;
const CURLOPT_HEADERFUNCTION = 20079;
const CURLOPT_NOSIGNAL = 99;
const CURLOPT_ACCEPT_ENCODING = 10102;
const CURLOPT_TIMEOUT_MS = 155;
const CURLOPT_XFERINFOFUNCTION = 20219;
const CURLOPT_CAINFO_BLOB = 40309;
const CURLOPT_PROTOCOLS_STR = 10318;
const CURLINFO_EFFECTIVE_URL = 0x100001;
const CURLINFO_RESPONSE_CODE = 0x200002;

let library: ReturnType<typeof load> | undefined;

async function install() {
  const libc = process.platform === "linux" ? ((process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime ? "-gnu" : "-musl") : "";
  const key = `${process.platform}-${process.arch}${libc}`;
  const asset = ASSETS[key];
  if (!asset) throw new Error(`libcurl-impersonate ${CURL_VERSION} has no release build for ${key}`);
  const entry = LIBRARY_FILES[process.platform]!;
  const root =
    process.env.XDG_CACHE_HOME ??
    (process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches")
        : join(homedir(), ".cache"));
  const file = join(root, "opencode", "webfetch", `curl-v${CURL_VERSION}`, basename(entry));
  if (await Bun.file(file).exists()) return file;

  const name = `libcurl-impersonate-v${CURL_VERSION}.${asset[0]}.tar.gz`;
  const response = await fetch(`https://github.com/lexiforest/curl-impersonate/releases/download/v${CURL_VERSION}/${name}`);
  if (!response.ok) throw new Error(`Downloading ${name} failed: HTTP ${response.status}`);
  const bytes = await response.bytes();
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== asset[1]) throw new Error(`${name} does not match its published SHA-256 digest`);
  const extracted = (await new Bun.Archive(bytes).files(entry)).get(entry);
  if (!extracted) throw new Error(`${name} does not contain ${entry}`);
  const temp = `${file}.${process.pid}.tmp`;
  await Bun.write(temp, extracted);
  await rename(temp, file);
  return file;
}

async function load() {
  const lib = koffi.load(await install());
  return {
    init: lib.func("void *curl_easy_init()"),
    cleanup: lib.func("void curl_easy_cleanup(void *)"),
    setopt: lib.func("int curl_easy_setopt(void *, int, ...)"),
    getinfo: lib.func("int curl_easy_getinfo(void *, int, ...)"),
    perform: lib.func("int curl_easy_perform(void *)"),
    impersonate: lib.func("int curl_easy_impersonate(void *, const char *, int)"),
    strerror: lib.func("const char *curl_easy_strerror(int)"),
    slistAppend: lib.func("void *curl_slist_append(void *, const char *)"),
    slistFree: lib.func("void curl_slist_free_all(void *)"),
    Write: koffi.pointer(koffi.proto("size_t webfetch_curl_write(void *, size_t, size_t, void *)")),
    Progress: koffi.pointer(koffi.proto("int webfetch_curl_progress(void *, int64, int64, int64, int64)")),
    LongOut: koffi.out(koffi.pointer("long")),
    StringOut: koffi.out(koffi.pointer("str")),
    Blob: koffi.pointer(koffi.struct("webfetch_curl_blob", { data: "void *", len: "size_t", flags: "uint" })),
    // Bun's own fetch trusts this bundle too; curl copies it (CURL_BLOB_COPY).
    ca: Buffer.from(rootCertificates.join("\n")),
  };
}

export async function request(url: URL, headers: Headers, signal: AbortSignal, profile?: NativeProfile, cookies?: string): Promise<Response> {
  signal.throwIfAborted();
  const curl = await (library ??= load().catch((error) => {
    library = undefined;
    throw error;
  }));
  signal.throwIfAborted();
  const check = (code: number) => {
    if (code !== 0) throw new Error(`curl: ${curl.strerror(code)}`);
  };

  const chunks: Uint8Array[] = [];
  let lines: string[] = [];
  let statusText = "";
  const write = koffi.register((data: unknown, size: number, count: number) => {
    chunks.push(new Uint8Array(koffi.view(data, size * count)).slice());
    return size * count;
  }, curl.Write);
  const header = koffi.register((data: unknown, size: number, count: number) => {
    const line = Buffer.from(koffi.view(data, size * count)).toString("latin1").trim();
    if (line.startsWith("HTTP/")) {
      lines = [];
      statusText = line.split(" ").slice(2).join(" ");
    } else if (line) lines.push(line);
    return size * count;
  }, curl.Write);
  const progress = koffi.register(() => (signal.aborted ? 1 : 0), curl.Progress);
  const handle = curl.init();
  let list = null;
  let transfer: Promise<number> | undefined;
  const release = () => {
    curl.cleanup(handle);
    curl.slistFree(list);
    koffi.unregister(write);
    koffi.unregister(header);
    koffi.unregister(progress);
  };
  try {
    const set = (option: number, type: unknown, value: unknown) => check(curl.setopt(handle, option, type, value));
    set(CURLOPT_URL, "str", url.href);
    set(CURLOPT_PROTOCOLS_STR, "str", "http,https");
    set(CURLOPT_FOLLOWLOCATION, "long", 1);
    set(CURLOPT_MAXREDIRS, "long", 20);
    set(CURLOPT_NOSIGNAL, "long", 1);
    set(CURLOPT_TIMEOUT_MS, "long", 30_000);
    set(CURLOPT_NOPROGRESS, "long", 0);
    set(CURLOPT_XFERINFOFUNCTION, curl.Progress, progress);
    set(CURLOPT_WRITEFUNCTION, curl.Write, write);
    set(CURLOPT_HEADERFUNCTION, curl.Write, header);
    set(CURLOPT_CAINFO_BLOB, curl.Blob, { data: curl.ca, len: curl.ca.length, flags: 1 });
    // The profile sets its own Accept, User-Agent, and Accept-Encoding headers.
    if (profile) check(curl.impersonate(handle, profile, 1));
    // Decode response bodies; a profile's Accept-Encoding header still takes precedence.
    set(CURLOPT_ACCEPT_ENCODING, "str", "");
    for (const [name, value] of headers) {
      if (name === "accept-encoding" || (profile && (name === "accept" || name === "user-agent"))) continue;
      list = curl.slistAppend(list, `${name}: ${value}`);
    }
    if (list) set(CURLOPT_HTTPHEADER, "void *", list);
    if (cookies) set(CURLOPT_COOKIEFILE, "str", cookies);

    const performing = new Promise<number>((resolve, reject) =>
      curl.perform.async(handle, (error: unknown, code: number) => (error ? reject(error) : resolve(code))),
    );
    transfer = performing;
    // libcurl does not report progress while connecting, so abort settles immediately
    // and the handle is released once the worker returns (bounded by TIMEOUT_MS).
    const code = await new Promise<number>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      performing.finally(() => signal.removeEventListener("abort", abort)).then(resolve, reject);
    });
    check(code);

    const status = [0];
    check(curl.getinfo(handle, CURLINFO_RESPONSE_CODE, curl.LongOut, status));
    const effective = [""];
    check(curl.getinfo(handle, CURLINFO_EFFECTIVE_URL, curl.StringOut, effective));

    const responseHeaders = new Headers();
    for (const line of lines) {
      const colon = line.indexOf(":");
      responseHeaders.append(line.slice(0, colon), line.slice(colon + 1).trim());
    }
    // libcurl already decoded the body.
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    const response = new Response([204, 205, 304].includes(status[0]!) ? null : Buffer.concat(chunks), {
      status: status[0],
      statusText,
      headers: responseHeaders,
    });
    Object.defineProperty(response, "url", { value: effective[0] });
    return response;
  } finally {
    if (transfer) transfer.then(release, release);
    else release();
  }
}
