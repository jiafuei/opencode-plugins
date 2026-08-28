import { createHash, randomUUID } from "node:crypto";
import { deriveDeviceId } from "./local_storage.ts";

// Beta tokens shared by the profile definitions below.
const CLAUDE_CODE_20250219_BETA = "claude-code-20250219";
const OAUTH_BETA = "oauth-2025-04-20";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const REDACT_THINKING_BETA = "redact-thinking-2026-02-12";
const THINKING_TOKEN_COUNT_BETA = "thinking-token-count-2026-05-13";
const CONTEXT_MANAGEMENT_BETA = "context-management-2025-06-27";
const PROMPT_CACHING_SCOPE_BETA = "prompt-caching-scope-2026-01-05";
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-12-15";
const MID_CONVERSATION_SYSTEM_BETA = "mid-conversation-system-2026-04-07";
const ADVANCED_TOOL_USE_BETA = "advanced-tool-use-2025-11-20";
const EFFORT_BETA = "effort-2025-11-24";
const FALLBACK_CREDIT_BETA = "fallback-credit-2026-06-01";
const TOKEN_COUNTING_BETA = "token-counting-2024-11-01";

// Claude client wire-format behavior: beta profiles, Stainless
// headers, tool-name cloaking, bounded response uncloaking, and /v1/messages
// body rewriting (billing fingerprint, cch attestation, metadata.user_id
// attribution). Nothing here touches OpenCode's plugin API; claude_oauth.ts
// wires these pieces into the OAuth auth fetch.

/**
 * One client identity on the Anthropic wire. `cowork` mirrors oh-my-pi's
 * Cowork desktop-agent profile (packages/ai/src/providers/
 * {claude-code-fingerprint,anthropic,cowork-fetch}.ts); `sdk-cli` mirrors
 * pi-black's Agent SDK CLI profile (src/claude-code-protocol.ts) without any
 * local Claude configuration reads.
 */
export interface SpoofingProfile {
  id: "cowork" | "sdk-cli";
  version: string;
  userAgent: string;
  billingEntrypoint: string;
  systemInstruction: string;
  toolPrefix: string;
  stainlessPackageVersion: string;
  deviceDomainInstall: string;
  deviceDomainAccount: string;
  /**
   * CCH attestation input: "raw" hashes the final serialized body with the
   * placeholder in place; "sdk-normalized" clones the final body, blanks only
   * the top-level model and drops top-level max_tokens (pi-black semantics).
   */
  cchMode: "raw" | "sdk-normalized";
  /** Skip billing + identity injection for claude-3-5-haiku (Cowork gate). */
  skipIdentityForHaiku: boolean;
  /** Advertise fallback credit on every request rather than agent requests only. */
  fallbackOnAllRequests: boolean;
  utilityBetas: readonly string[];
  agentBetas: readonly string[];
}

export const COWORK_PROFILE: SpoofingProfile = {
  id: "cowork",
  version: "2.1.246",
  userAgent: `claude-cli/2.1.246 (external, claude-desktop)`,
  billingEntrypoint: "claude-desktop",
  systemInstruction: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
  toolPrefix: "_",
  stainlessPackageVersion: "0.112.1",
  deviceDomainInstall: "omp-claude-device-id-v1:",
  deviceDomainAccount: "omp-claude-device-id-v2",
  cchMode: "raw",
  skipIdentityForHaiku: true,
  fallbackOnAllRequests: false,
  utilityBetas: [
    OAUTH_BETA,
    INTERLEAVED_THINKING_BETA,
    THINKING_TOKEN_COUNT_BETA,
    CONTEXT_MANAGEMENT_BETA,
    PROMPT_CACHING_SCOPE_BETA,
    STRUCTURED_OUTPUTS_BETA,
  ],
  agentBetas: [
    CLAUDE_CODE_20250219_BETA,
    OAUTH_BETA,
    INTERLEAVED_THINKING_BETA,
    THINKING_TOKEN_COUNT_BETA,
    CONTEXT_MANAGEMENT_BETA,
    PROMPT_CACHING_SCOPE_BETA,
    MID_CONVERSATION_SYSTEM_BETA,
    ADVANCED_TOOL_USE_BETA,
  ],
};

/**
 * pi-black's sdk-cli profile. Version/entrypoint/UA/system instruction mirror
 * src/claude-code-protocol.ts; betas mirror the plugin's former Claude CLI
 * profiles (pi-black's header was `claude-code-20250219,oauth-2025-04-20,…`),
 * and the Stainless baseline stays at the pinned CLI values since pi-black
 * does not pin a distinct package version. Identity is derived from this
 * plugin's install ID plus the OAuth account — never from `.claude.json` or
 * any local Claude configuration.
 */
export const SDK_CLI_PROFILE: SpoofingProfile = {
  id: "sdk-cli",
  version: "2.1.224",
  userAgent: `claude-cli/2.1.224 (external, sdk-cli)`,
  billingEntrypoint: "sdk-cli",
  systemInstruction: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
  toolPrefix: "_",
  stainlessPackageVersion: "0.112.1",
  deviceDomainInstall: "claude-oauth-device-id-v1:",
  deviceDomainAccount: "claude-oauth-device-id-v2",
  cchMode: "sdk-normalized",
  // pi-black injects billing and identity for every model, haiku included.
  skipIdentityForHaiku: false,
  fallbackOnAllRequests: true,
  utilityBetas: [
    CLAUDE_CODE_20250219_BETA,
    OAUTH_BETA,
    INTERLEAVED_THINKING_BETA,
    REDACT_THINKING_BETA,
    THINKING_TOKEN_COUNT_BETA,
    CONTEXT_MANAGEMENT_BETA,
    PROMPT_CACHING_SCOPE_BETA,
    STRUCTURED_OUTPUTS_BETA,
  ],
  agentBetas: [
    CLAUDE_CODE_20250219_BETA,
    OAUTH_BETA,
    INTERLEAVED_THINKING_BETA,
    REDACT_THINKING_BETA,
    THINKING_TOKEN_COUNT_BETA,
    CONTEXT_MANAGEMENT_BETA,
    PROMPT_CACHING_SCOPE_BETA,
    MID_CONVERSATION_SYSTEM_BETA,
  ],
};

const SPOOFING_PROFILES: Record<string, SpoofingProfile> = {
  cowork: COWORK_PROFILE,
  "sdk-cli": SDK_CLI_PROFILE,
};

/** Resolve the plugin's spoofingProfile option once at the boundary. Undefined selects SDK CLI. */
export function resolveSpoofingProfile(value: unknown): SpoofingProfile {
  if (value === undefined) return SDK_CLI_PROFILE;
  const profile = SPOOFING_PROFILES[value as string];
  if (!profile) {
    throw new Error(
      `claude-oauth: unsupported spoofingProfile "${String(value)}" — expected "cowork" or "sdk-cli"`,
    );
  }
  return profile;
}

/** Token-counting beta header for a profile: its utility list plus token counting. */
export function countTokensBetas(profile: SpoofingProfile = SDK_CLI_PROFILE): string {
  return [...profile.utilityBetas, TOKEN_COUNTING_BETA].join(",");
}

// These caller-supplied betas are absent from the supported wire profiles.
// context-1m additionally hard-429s OAuth subscription requests.
const STRIPPED_BETAS = new Set([
  "context-1m-2025-08-07",
  "fine-grained-tool-streaming-2025-05-14",
  "structured-outputs-2025-11-13",
]);

function isActiveThinking(thinking: unknown): boolean {
  const type = (thinking as { type?: unknown } | undefined)?.type;
  return type === "enabled" || type === "adaptive";
}

/**
 * Build the final anthropic-beta header: the profile's betas first, then
 * deduplicated SDK/caller extras (compact, PDF, MCP, skills/files, fast mode,
 * task budgets, ...). `incoming` is the request's existing anthropic-beta
 * header value, if any. Effort/fallback follow each profile's rules: sdk-cli
 * advertises fallback credit on every request; Cowork (matching OMP) adds
 * effort and fallback credit only on agent requests.
 */
export function buildBetas(
  thinking: unknown,
  hasTools: boolean,
  incoming?: string | null,
  profile: SpoofingProfile = SDK_CLI_PROFILE,
): string {
  const agent = hasTools || isActiveThinking(thinking);
  const betas = [...(agent ? profile.agentBetas : profile.utilityBetas)];
  const seen = new Set(betas);
  const push = (beta: string) => {
    if (!seen.has(beta)) {
      seen.add(beta);
      betas.push(beta);
    }
  };
  const incomingBetas = incoming?.split(",").map((beta) => beta.trim()) ?? [];
  if (agent && incomingBetas.includes(ADVANCED_TOOL_USE_BETA)) {
    push(ADVANCED_TOOL_USE_BETA);
  }
  if (agent && isActiveThinking(thinking)) push(EFFORT_BETA);
  // sdk-cli advertises fallback credit on every request; Cowork (matching
  // OMP) only on agent requests.
  if (agent || profile.fallbackOnAllRequests) push(FALLBACK_CREDIT_BETA);
  if (incomingBetas.length > 0) {
    for (const beta of incomingBetas) {
      if (!beta || seen.has(beta) || STRIPPED_BETAS.has(beta)) continue;
      push(beta);
    }
  }
  return betas.join(",");
}

export function mapStainlessArch(arch: string): "x64" | "arm64" | "x86" | `other::${string}` {
  switch (arch.toLowerCase()) {
    case "amd64":
    case "x64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    case "386":
    case "x86":
    case "ia32":
      return "x86";
    default:
      return `other::${arch.toLowerCase()}`;
  }
}

// Static Stainless headers emitted by the Claude runtime.
export const STAINLESS_HEADERS: Record<string, string> = {
  "X-Stainless-Arch": mapStainlessArch(process.arch),
  "X-Stainless-Lang": "js",
  "X-Stainless-OS": "Linux",
  "X-Stainless-Package-Version": "0.112.1",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Runtime-Version": "v26.3.0",
  "X-Stainless-Timeout": "600",
};

/** Stainless header set for a profile; only the package version varies. */
export function stainlessHeaders(profile: SpoofingProfile): Record<string, string> {
  return { ...STAINLESS_HEADERS, "X-Stainless-Package-Version": profile.stainlessPackageVersion };
}

// ---------------------------------------------------------------------------
// Custom tool name cloaking
// ---------------------------------------------------------------------------

// Cowork and SDK CLI cloak custom tool names under a single leading
// underscore. Anthropic built-ins are exempt.
const TOOL_PREFIX = "_";

// Anthropic built-in tool names are never prefixed or stripped. Server tools
// from the pinned @ai-sdk/anthropic additionally carry versioned `type` fields
// (web_search_20250305, text_editor_20250429, computer_20250124,
// code_execution_20250522, ...) on their definitions; any tool definition with
// a string `type` is a provider tool and is left untouched.
const BUILTIN_TOOL_NAMES = new Set(["web_search", "code_execution", "text_editor", "computer"]);

function isBuiltinToolName(name: string): boolean {
  return BUILTIN_TOOL_NAMES.has(name.toLowerCase());
}

export function applyClaudeToolPrefix(name: string, prefix: string = TOOL_PREFIX): string {
  if (isBuiltinToolName(name)) return name;
  // Always prepend, including when a logical name already starts with the
  // namespace, so stripping exactly one prefix always round-trips.
  return `${prefix}${name}`;
}

export function stripClaudeToolPrefix(name: string, prefix: string = TOOL_PREFIX): string {
  if (!name.startsWith(prefix)) return name;
  return name.slice(prefix.length);
}

/**
 * Close top-level input schemas and prefix every custom tool name carried by
 * an Anthropic request body, in place: custom tool definitions (no versioned
 * `type`), `tool_choice.name`, and historical assistant `tool_use` blocks. IDs,
 * SDK-only fields, and `tool_result` blocks are preserved verbatim.
 */
export function prefixRequestToolNames(params: Record<string, any>, profile: SpoofingProfile = SDK_CLI_PROFILE): void {
  const prefix = profile.toolPrefix;
  if (Array.isArray(params.tools)) {
    for (const tool of params.tools) {
      if (!tool || typeof tool !== "object") continue;
      if (
        tool.input_schema &&
        typeof tool.input_schema === "object" &&
        !Array.isArray(tool.input_schema)
      ) {
        tool.input_schema.additionalProperties = false;
      }
      // Provider/server tools are identified by a versioned `type`
      // (web_search_20250305, computer_20250124, ...); custom function tools
      // have no `type` at all.
      if (typeof tool.type === "string") continue;
      if (typeof tool.name === "string") tool.name = applyClaudeToolPrefix(tool.name, prefix);
    }
  }
  const toolChoice = params.tool_choice;
  if (
    toolChoice &&
    typeof toolChoice === "object" &&
    toolChoice.type === "tool" &&
    typeof toolChoice.name === "string"
  ) {
    toolChoice.name = applyClaudeToolPrefix(toolChoice.name, prefix);
  }
  if (Array.isArray(params.messages)) {
    for (const message of params.messages) {
      if (!message || typeof message !== "object" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block?.type === "tool_use" && typeof block.name === "string") {
          block.name = applyClaudeToolPrefix(block.name, prefix);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bounded response uncloaking (non-streaming JSON + incremental SSE)
// ---------------------------------------------------------------------------

/** Strip the cloaking prefix from `content[].type === "tool_use"` names in a non-streaming JSON response body. */
export function transformJsonToolUseNames(body: string, prefix: string = TOOL_PREFIX): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, any>).content)) return body;
  for (const block of (parsed as Record<string, any>).content) {
    if (block?.type === "tool_use" && typeof block.name === "string") {
      block.name = stripClaudeToolPrefix(block.name, prefix);
    }
  }
  return JSON.stringify(parsed);
}

// One complete SSE event may be buffered while it is assembled across chunks.
// Anthropic messages events sit far below this; exceeding it means the stream
// is not well-formed SSE and buffering further would be unbounded.
const SSE_EVENT_BUFFER_LIMIT = 1024 * 1024;

/**
 * Incremental SSE transformer that strips exactly one cloaking prefix from
 * tool_use names inside content_block_start events and in any
 * message_start.message.content tool_use blocks. Complete SSE event records
 * are parsed across arbitrary chunk boundaries (CRLF/LF), joining multiple
 * `data:` lines per the SSE rules before JSON parsing. Events that need no
 * rewrite pass through byte-for-byte, and only the current partial event is
 * ever buffered — never the full stream. A partial event that exceeds the
 * assembly cap fails the stream with a clear error.
 */
export function createSseToolNameTransform(
  prefix: string = TOOL_PREFIX,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  // Lines of the event being assembled: text without its terminator, plus the
  // exact terminator bytes that followed it ("\n" or "\r\n"). The terminating
  // blank line is included, so re-emitting the list reproduces the raw bytes.
  let eventLines: Array<{ text: string; eol: string }> = [];
  let eventBytes = 0;

  function uncloak(event: any): any | undefined {
    if (event?.type === "content_block_start") {
      const block = event.content_block;
      if (block?.type === "tool_use" && typeof block.name === "string") {
        return { ...event, content_block: { ...block, name: stripClaudeToolPrefix(block.name, prefix) } };
      }
      return undefined;
    }
    if (event?.type === "message_start" && Array.isArray(event.message?.content)) {
      let changed = false;
      const content = event.message.content.map((block: any) => {
        if (block?.type !== "tool_use" || typeof block.name !== "string") return block;
        changed = true;
        return { ...block, name: stripClaudeToolPrefix(block.name, prefix) };
      });
      return changed ? { ...event, message: { ...event.message, content } } : undefined;
    }
    return undefined;
  }

  /** Emit one completed event: rewritten only when its data payload carried a cloaked name. */
  function dispatch(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (eventLines.length === 0) return;
    let rebuilt: string[] | undefined;
    const dataValues = eventLines
      .filter((line) => line.text.startsWith("data:"))
      .map((line) => (line.text.slice(5).startsWith(" ") ? line.text.slice(6) : line.text.slice(5)));
    if (dataValues.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataValues.join("\n"));
      } catch {}
      const next = uncloak(parsed);
      if (next !== undefined) {
        // Re-emit the event verbatim except for its data lines: the first
        // carries the rewritten JSON, any additional ones are folded into it.
        const newData = `data: ${JSON.stringify(next)}`;
        rebuilt = [];
        let replaced = false;
        for (const line of eventLines) {
          if (line.text.startsWith("data:")) {
            if (!replaced) {
              rebuilt.push(`${newData}${line.eol}`);
              replaced = true;
            }
          } else {
            rebuilt.push(`${line.text}${line.eol}`);
          }
        }
      }
    }
    controller.enqueue(
      encoder.encode(rebuilt ? rebuilt.join("") : eventLines.map((line) => `${line.text}${line.eol}`).join("")),
    );
    eventLines = [];
    eventBytes = 0;
  }

  return new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      for (;;) {
        const newlineIdx = pending.indexOf("\n");
        if (newlineIdx === -1) break;
        let text = pending.slice(0, newlineIdx);
        pending = pending.slice(newlineIdx + 1);
        let eol = "\n";
        if (text.endsWith("\r")) {
          text = text.slice(0, -1);
          eol = "\r\n";
        }
        eventBytes += text.length + eol.length;
        if (eventBytes > SSE_EVENT_BUFFER_LIMIT) {
          throw new Error(
            `claude-oauth: buffered SSE event exceeded ${SSE_EVENT_BUFFER_LIMIT} bytes without a record boundary; aborting the response stream`,
          );
        }
        eventLines.push({ text, eol });
        // A blank line terminates the SSE event record.
        if (text === "") dispatch(controller);
      }
      if (eventBytes + pending.length > SSE_EVENT_BUFFER_LIMIT) {
        throw new Error(
          `claude-oauth: buffered SSE event exceeded ${SSE_EVENT_BUFFER_LIMIT} bytes without a record boundary; aborting the response stream`,
        );
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending.length > 0) {
        // A final line without a terminator completes the last event.
        eventLines.push({ text: pending, eol: "" });
        pending = "";
      }
      dispatch(controller);
    },
  });
}

// Non-streaming JSON bodies are read whole but bounded: a legitimate message
// response stays far below this; anything larger is a protocol error, not
// something to buffer indefinitely.
const MAX_JSON_RESPONSE_CHARS = 64 * 1024 * 1024;

export async function readBoundedJsonText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > MAX_JSON_RESPONSE_CHARS) {
      reader.cancel().catch(() => {});
      throw new Error(
        `claude-oauth: non-streaming JSON response exceeds the ${MAX_JSON_RESPONSE_CHARS}-character uncloaking bound`,
      );
    }
  }
  return text;
}

/**
 * Headers for a rewritten Response: cloned from the upstream response with
 * stale entity headers removed — they describe bytes we replaced, not the
 * transformed body. Status/statusText/content-type are preserved by the caller.
 */
export function uncloakedResponseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  for (const key of [...headers.keys()]) {
    const lower = key.toLowerCase();
    if (
      lower === "content-length" ||
      lower === "content-encoding" ||
      lower === "etag" ||
      lower === "content-md5" ||
      lower.includes("checksum")
    ) {
      headers.delete(key);
    }
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Body rewrite: billing fingerprint + cch + metadata.user_id attribution
// ---------------------------------------------------------------------------

type ContentBlock = {
  type?: string;
  text?: string;
  cache_control?: { type?: unknown; ttl?: unknown; scope?: unknown; [key: string]: unknown };
};

const BILLING_SALT = "59cf53e54c78";
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const MAX_OUTPUT_TOKENS = 64000;

function createBillingHeader(firstUserMessageText: string, profile: SpoofingProfile): string {
  // Fingerprint: SHA256(salt + msg[4] + msg[7] + msg[20] + version)[:3],
  // chars taken from the first non-meta user text block (not the system prompt).
  const k = [4, 7, 20]
    .map((i) => firstUserMessageText[i] ?? "0")
    .join("");
  const versionSuffix = createHash("sha256")
    .update(`${BILLING_SALT}${k}${profile.version}`)
    .digest("hex")
    .slice(0, 3);
  // The CCH placeholder is replaced after the complete request object is assembled.
  return `${BILLING_HEADER_PREFIX} cc_version=${profile.version}.${versionSuffix}; cc_entrypoint=${profile.billingEntrypoint}; ${CCH_PLACEHOLDER_STR};`;
}

// cch attestation: XXHash64(body_with_placeholder, seed) low-20-bits as 5 hex chars.
function rot13(value: string): string {
  return value.replace(/[a-z]/gi, (char) => String.fromCharCode(char.charCodeAt(0) + (char.toLowerCase() < "n" ? 13 : -13)));
}

const CCH_SEED = BigInt(rot13("0k4q659218r32n3268"));
const CCH_PLACEHOLDER_STR = rot13("ppu=00000");
const cchEncoder = new TextEncoder();

// Valid legacy cloaking id: user_<64 hex>_account_<uuid>_session_<uuid>.
const CLOAKING_USER_ID_REGEX =
  /^user_[0-9a-fA-F]{64}_account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Session id carried by a valid CC attribution user_id: the legacy cloaking
 * id's trailing session, or the `session_id` of the `{device_id, session_id,
 * ...}` JSON envelope. Undefined for anything that must be regenerated.
 */
export function extractUserIdSessionId(userId: string): string | undefined {
  if (CLOAKING_USER_ID_REGEX.test(userId)) return userId.slice(userId.lastIndexOf("_session_") + "_session_".length);
  if (userId.startsWith("{")) {
    try {
      const sessionId = (JSON.parse(userId) as Record<string, unknown>).session_id;
      if (typeof sessionId === "string" && sessionId.length > 0) return sessionId;
    } catch {}
  }
  return undefined;
}

// Generated user ids prefer an account already present in metadata over the
// auth-derived one.
function readMetadataAccountId(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  for (const key of ["account_uuid", "accountId", "account_id"]) {
    const value = (metadata as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function extractFirstUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const m = message as { role?: string; content?: unknown };
    if (m.role !== "user") continue;
    if (typeof m.content === "string") {
      if (!m.content.startsWith("<system-reminder>")) return m.content;
      continue;
    }
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (!block || typeof block !== "object" || (block as ContentBlock).type !== "text") continue;
        const text = (block as ContentBlock).text ?? "";
        if (!text.startsWith("<system-reminder>")) return text;
      }
    }
  }
  return "";
}

const CANONICAL_BODY_KEYS = [
  "model",
  "messages",
  "system",
  "tools",
  "metadata",
  "max_tokens",
  "thinking",
  "context_management",
  "temperature",
  "output_config",
  "fallbacks",
  "stream",
];

/**
 * Rewrite a /v1/messages body into the active profile's shape:
 * - system[0] billing header, system[1] profile identity
 * - metadata.user_id in the CC attribution envelope (valid incoming
 *   attribution preserved verbatim)
 * - max_tokens clamped to <= 64000
 * - SDK fields (thinking.display, eager_input_streaming) preserved, caches
 *   untouched, tool input schemas closed, and active thinking emits a single
 *   keep-all clear-thinking edit; the CCH mode follows OMP (cowork) or
 *   pi-black (sdk-cli)
 * - known keys rebuilt in canonical order (incl. output_config / fallbacks),
 *   remaining keys appended in their original relative order;
 *   incoming `stream` is preserved as-is
 */
export function rewriteBody(
  body: string,
  ctx: {
    sessionId?: string;
    accountId?: string;
    attributionHeader?: boolean;
    profile?: SpoofingProfile;
  },
): { json: string; thinking: unknown; hasTools: boolean; model: string; sessionId?: string } {
  const profile = ctx.profile ?? SDK_CLI_PROFILE;
  const params = JSON.parse(body) as Record<string, any>;
  // Cloak custom tool names before anything else, so cch hashes the
  // already-prefixed final body.
  prefixRequestToolNames(params, profile);
  if (
    params.tool_choice?.type === "auto" &&
    typeof params.tool_choice === "object" &&
    Object.keys(params.tool_choice).length === 1
  ) {
    delete params.tool_choice;
  }
  const hasTools = Array.isArray(params.tools) && params.tools.length > 0;

  const modelId: string = params.model ?? "";
  // Cowork follows CC's gate: neither the billing header nor the identity
  // instruction goes to haiku. pi-black's sdk-cli injects for every model.
  const injectFingerprint =
    !profile.skipIdentityForHaiku || !modelId.startsWith("claude-3-5-haiku");

  // Normalize incoming system content (string → text block, array kept as-is,
  // including caller fields like cache_control). Skip injection entirely when a
  // billing block already exists so rewrites never stack duplicate fingerprints.
  const incomingSystem = params.system;
  let systemBlocks: ContentBlock[] =
    typeof incomingSystem === "string"
      ? [{ type: "text", text: incomingSystem }]
      : Array.isArray(incomingSystem)
        ? incomingSystem
        : [];
  const hasBillingBlock =
    (typeof incomingSystem === "string" && incomingSystem.startsWith(BILLING_HEADER_PREFIX)) ||
    systemBlocks.some((block) => typeof block?.text === "string" && block.text.startsWith(BILLING_HEADER_PREFIX));

  if (ctx.attributionHeader === false) {
    systemBlocks = systemBlocks.filter(
      (block) => typeof block?.text !== "string" || !block.text.startsWith(BILLING_HEADER_PREFIX),
    );
  }

  const hasIdentityBlock = systemBlocks.some((block) => block?.text === profile.systemInstruction);
  const fingerprintBlocks: ContentBlock[] = [];
  if (injectFingerprint && ctx.attributionHeader !== false && !hasBillingBlock) {
    fingerprintBlocks.push({
      type: "text",
      text: createBillingHeader(extractFirstUserText(params.messages), profile),
    });
  }
  if (injectFingerprint && !hasIdentityBlock) {
    fingerprintBlocks.push({ type: "text", text: profile.systemInstruction });
  }
  const system = [...fingerprintBlocks, ...systemBlocks];

  // Preserve valid CC attribution verbatim — the legacy cloaking id or the
  // `{device_id, session_id, ...}` JSON envelope with a nonempty session_id.
  // Anything else gets a freshly generated envelope whose session matches the
  // header-provided sessionId so Step 5 can keep header and body attribution
  // consistent.
  const incomingUserId = params.metadata?.user_id;
  const preservedSession = typeof incomingUserId === "string" ? extractUserIdSessionId(incomingUserId) : undefined;
  let userId: string;
  let sessionId: string;
  if (preservedSession !== undefined) {
    userId = incomingUserId;
    sessionId = preservedSession;
  } else {
    const accountId = readMetadataAccountId(params.metadata) ?? ctx.accountId;
    const envelope: Record<string, string> = {
      device_id: deriveDeviceId(accountId, profile.deviceDomainInstall, profile.deviceDomainAccount),
    };
    if (accountId) envelope.account_uuid = accountId;
    envelope.session_id = ctx.sessionId ?? randomUUID().toLowerCase();
    userId = JSON.stringify(envelope);
    sessionId = envelope.session_id;
  }
  const metadata = { ...params.metadata, user_id: userId };

  const thinking =
    params.thinking && typeof params.thinking === "object" ? { ...params.thinking } : params.thinking;
  // Active thinking emits a single keep-all edit, replacing whatever arrived.
  // Incoming objects are copied, never mutated.
  const incomingContextManagement = params.context_management;
  let contextManagement: Record<string, any> | undefined;
  if (isActiveThinking(thinking)) {
    contextManagement = { edits: [{ type: "clear_thinking_20251015", keep: "all" }] };
  } else if (incomingContextManagement) {
    contextManagement = incomingContextManagement;
  }

  const overrides: Record<string, any> = {
    model: params.model,
    messages: params.messages,
    ...(system.length > 0 && { system }),
    // OAuth requests always carry a tools array, even an empty one (CC does).
    tools: Array.isArray(params.tools) ? params.tools : [],
    metadata,
    max_tokens: Math.min(MAX_OUTPUT_TOKENS, params.max_tokens ?? MAX_OUTPUT_TOKENS),
    ...(thinking && { thinking }),
    ...(contextManagement && { context_management: contextManagement }),
  };
  const merged = { ...params, ...overrides };

  // Rebuild known keys in canonical order, then append every remaining key in
  // its original relative order. Incoming `stream` is preserved as-is (the
  // normal SDK path sends true); undefined values drop out on stringify.
  const rewritten: Record<string, any> = {};
  for (const key of CANONICAL_BODY_KEYS) {
    if (merged[key] !== undefined) rewritten[key] = merged[key];
  }
  for (const [key, value] of Object.entries(params)) {
    if (!(key in rewritten) && value !== undefined) rewritten[key] = value;
  }

  const billingBlock = system.find(
    (block) =>
      typeof block?.text === "string" &&
      block.text.startsWith(BILLING_HEADER_PREFIX) &&
      block.text.includes(CCH_PLACEHOLDER_STR),
  );
  if (billingBlock?.text) {
    // Cowork attests the raw final serialized body: hash it with the
    // placeholder still in place (OMP's wrapFetchForCch behavior, applied
    // before serialization here). pi-black's sdk-cli clones the final body,
    // blanks only the top-level model, and drops top-level max_tokens.
    const attested =
      profile.cchMode === "raw"
        ? JSON.stringify(rewritten)
        : JSON.stringify({ ...rewritten, model: "", max_tokens: undefined });
    const hash = Bun.hash.xxHash64(cchEncoder.encode(attested), CCH_SEED);
    const cch = (hash & 0xfffffn).toString(16).padStart(5, "0");
    billingBlock.text = billingBlock.text.replace(CCH_PLACEHOLDER_STR, `cch=${cch}`);
  }

  return { json: JSON.stringify(rewritten), thinking, hasTools, model: modelId, sessionId };
}
