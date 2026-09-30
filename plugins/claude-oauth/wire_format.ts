import { CLI_PROFILE, SDK_CLI_PROFILE, type CliProfile } from "./cli_wire.ts";

// Wire pieces shared by the CLI profiles: profile resolution and bounded
// response uncloaking. Request rewriting lives in cli_wire.ts.

const SPOOFING_PROFILES: Record<string, CliProfile> = {
  cli: CLI_PROFILE,
  "sdk-cli": SDK_CLI_PROFILE,
};

/** Resolve the plugin's spoofingProfile option once at the boundary. Undefined selects SDK CLI. */
export function resolveSpoofingProfile(value: string | undefined): CliProfile {
  const profile = SPOOFING_PROFILES[value ?? "sdk-cli"];
  if (!profile) {
    throw new Error(`claude-oauth: unsupported spoofingProfile "${value}" — expected "cli" or "sdk-cli"`);
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Bounded response uncloaking (incremental SSE)
// ---------------------------------------------------------------------------

/**
 * Incremental SSE transformer that strips exactly one cloaking prefix from
 * tool_use names inside content_block_start events and in any
 * message_start.message.content tool_use blocks. Complete SSE event records
 * are parsed across arbitrary chunk boundaries (CRLF/LF), joining multiple
 * `data:` lines per the SSE rules before JSON parsing. Events that need no
 * rewrite pass through byte-for-byte, and only the current partial event is
 * ever buffered — never the full stream.
 */
export function createSseToolNameTransform(
  prefix: string,
  completion?: { event(value: any): void; end(): void },
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const strip = (name: string) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);
  let pending = "";
  // Lines of the event being assembled: text without its terminator, plus the
  // exact terminator bytes that followed it ("\n" or "\r\n"). The terminating
  // blank line is included, so re-emitting the list reproduces the raw bytes.
  let eventLines: Array<{ text: string; eol: string }> = [];

  function uncloak(event: any): any | undefined {
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      return { ...event, content_block: { ...event.content_block, name: strip(event.content_block.name) } };
    }
    if (event.type === "message_start" && event.message.content?.some((block: any) => block.type === "tool_use")) {
      const content = event.message.content.map((block: any) =>
        block.type === "tool_use" ? { ...block, name: strip(block.name) } : block,
      );
      return { ...event, message: { ...event.message, content } };
    }
    return undefined;
  }

  /** Emit one completed event: rewritten only when its data payload carried a cloaked name. */
  function dispatch(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (eventLines.length === 0) return;
    const lines = eventLines;
    eventLines = [];
    const data = lines
      .filter((line) => line.text.startsWith("data:"))
      .map((line) => line.text.slice(line.text.startsWith("data: ") ? 6 : 5));
    let next: unknown;
    if (data.length > 0) {
      const parsed = JSON.parse(data.join("\n"));
      completion?.event(parsed);
      next = uncloak(parsed);
    }
    // Re-emit the event verbatim except for its data lines: the first carries
    // the rewritten JSON, any additional ones are folded into it.
    let output = "";
    let replaced = false;
    for (const line of lines) {
      if (next === undefined || !line.text.startsWith("data:")) output += `${line.text}${line.eol}`;
      else if (!replaced) {
        output += `data: ${JSON.stringify(next)}${line.eol}`;
        replaced = true;
      }
    }
    controller.enqueue(encoder.encode(output));
  }

  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      for (let newline = pending.indexOf("\n"); newline >= 0; newline = pending.indexOf("\n")) {
        const raw = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        eventLines.push({ text, eol: text === raw ? "\n" : "\r\n" });
        // A blank line terminates the SSE event record.
        if (text === "") dispatch(controller);
      }
    },
    flush(controller) {
      pending += decoder.decode();
      // A final line without a terminator completes the last event.
      if (pending) eventLines.push({ text: pending, eol: "" });
      dispatch(controller);
      completion?.end();
    },
  });
}

/**
 * Headers for a rewritten Response: cloned from the upstream response with
 * stale entity headers removed — they describe bytes we replaced, not the
 * transformed body. Status/statusText/content-type are preserved by the caller.
 */
export function uncloakedResponseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    if (["content-length", "content-encoding", "etag", "content-md5"].includes(key) || key.includes("checksum")) {
      headers.delete(key);
    }
  }
  return headers;
}
