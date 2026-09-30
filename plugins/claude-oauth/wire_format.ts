import { createHash, randomUUID } from "node:crypto";
import { deriveDeviceId } from "./local_storage.ts";
import { EX_MACHINA_PROFILE } from "./ex_machina_wire.ts";
import type { ExMachinaProfile } from "./ex_machina_wire.ts";
import { CLI_PROFILE, SDK_CLI_PROFILE, type CliProfile } from "./cli_wire.ts";
export { SDK_CLI_PROFILE } from "./cli_wire.ts";
import {
  applyCoworkModelCompatibility,
  applyCoworkPromptCaching,
  makeStringsWellFormed,
  normalizeCoworkTools,
  sanitizeCoworkSystem,
} from "./cowork_wire.ts";

// Beta tokens shared by the profile definitions below.
const CLAUDE_CODE_20250219_BETA = "claude-code-20250219";
const OAUTH_BETA = "oauth-2025-04-20";
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
const THINKING_TOKEN_COUNT_BETA = "thinking-token-count-2026-05-13";
const CONTEXT_MANAGEMENT_BETA = "context-management-2025-06-27";
const PROMPT_CACHING_SCOPE_BETA = "prompt-caching-scope-2026-01-05";
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-12-15";
const MID_CONVERSATION_SYSTEM_BETA = "mid-conversation-system-2026-04-07";
const ADVANCED_TOOL_USE_BETA = "advanced-tool-use-2025-11-20";
const EFFORT_BETA = "effort-2025-11-24";
const FALLBACK_CREDIT_BETA = "fallback-credit-2026-06-01";

// Claude client wire-format behavior: beta profiles, Stainless
// headers, tool-name cloaking, bounded response uncloaking, and /v1/messages
// body rewriting (billing fingerprint, cch attestation, metadata.user_id
// attribution). Nothing here touches OpenCode's plugin API; server.ts
// wires these pieces into the session HTTP hooks.

/**
 * Cowork mirrors oh-my-pi's desktop-agent wire format. The capture-based
 * interactive and SDK CLI profiles live in cli_wire.ts.
 */
export interface ClaudeCodeSpoofingProfile {
  id: "cowork";
  wireFormat: "claude-code";
  version: string;
  userAgent: string;
  billingEntrypoint: string;
  systemInstruction: string;
  toolPrefix: string;
  stainlessPackageVersion: string;
  deviceDomainInstall: string;
  deviceDomainAccount: string;
  utilityBetas: readonly string[];
  agentBetas: readonly string[];
}

export type SpoofingProfile = ClaudeCodeSpoofingProfile | ExMachinaProfile | CliProfile;

export const COWORK_PROFILE: ClaudeCodeSpoofingProfile = {
  id: "cowork",
  wireFormat: "claude-code",
  version: "2.1.246",
  userAgent: `claude-cli/2.1.246 (external, claude-desktop)`,
  billingEntrypoint: "claude-desktop",
  systemInstruction: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
  toolPrefix: "_",
  stainlessPackageVersion: "0.112.1",
  deviceDomainInstall: "omp-claude-device-id-v1:",
  deviceDomainAccount: "omp-claude-device-id-v2",
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

const SPOOFING_PROFILES: Record<string, SpoofingProfile> = {
  cli: CLI_PROFILE,
  cowork: COWORK_PROFILE,
  "sdk-cli": SDK_CLI_PROFILE,
  "ex-machina": EX_MACHINA_PROFILE,
};

/** Resolve the plugin's spoofingProfile option once at the boundary. Undefined selects SDK CLI. */
export function resolveSpoofingProfile(value: string | undefined): SpoofingProfile {
  const profile = SPOOFING_PROFILES[value ?? "sdk-cli"];
  if (!profile) {
    throw new Error(
      `claude-oauth: unsupported spoofingProfile "${value}" — expected "cli", "cowork", "sdk-cli", or "ex-machina"`,
    );
  }
  return profile;
}

// These caller-supplied betas are absent from the supported wire profiles.
// context-1m additionally hard-429s OAuth subscription requests.
const STRIPPED_BETAS = new Set([
  "context-1m-2025-08-07",
  "fine-grained-tool-streaming-2025-05-14",
  "structured-outputs-2025-11-13",
]);

function isActiveThinking(thinking: any): boolean {
  return thinking?.type === "enabled" || thinking?.type === "adaptive";
}

/**
 * Build the final anthropic-beta header: the profile's betas first, then
 * deduplicated SDK/caller extras (compact, PDF, MCP, skills/files, fast mode,
 * task budgets, ...). `incoming` is the request's existing anthropic-beta
 * header value, if any. Cowork adds effort and fallback credit only on agent
 * requests, matching OMP.
 */
export function buildBetas(
  thinking: unknown,
  hasTools: boolean,
  incoming?: string | null,
  profile: ClaudeCodeSpoofingProfile = COWORK_PROFILE,
): string {
  const agent = hasTools || isActiveThinking(thinking);
  const betas = new Set(agent ? profile.agentBetas : profile.utilityBetas);
  if (isActiveThinking(thinking)) betas.add(EFFORT_BETA);
  if (agent) betas.add(FALLBACK_CREDIT_BETA);
  for (const beta of incoming?.split(",") ?? []) {
    if (beta.trim() && !STRIPPED_BETAS.has(beta.trim())) betas.add(beta.trim());
  }
  return [...betas].join(",");
}

/**
 * The complete /v1/messages header set for a Claude Code profile. Every
 * caller header not listed here (OpenCode's session routing, project/client
 * markers, its User-Agent) is dropped.
 */
export function buildEnforcedHeaders(
  profile: ClaudeCodeSpoofingProfile,
  fields: { sessionId: string; betas: string; authorization: string; clientRequestId: string },
): Headers {
  const arch = process.arch === "ia32" ? "x86" : process.arch === "x64" || process.arch === "arm64" ? process.arch : `other::${process.arch}`;
  return new Headers({
    Accept: "application/json",
    Authorization: fields.authorization,
    "Content-Type": "application/json",
    "User-Agent": profile.userAgent,
    "X-Claude-Code-Session-Id": fields.sessionId,
    "X-Stainless-Arch": arch,
    "X-Stainless-Lang": "js",
    "X-Stainless-OS": "Linux",
    "X-Stainless-Package-Version": profile.stainlessPackageVersion,
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": "v26.3.0",
    "X-Stainless-Timeout": "600",
    "anthropic-beta": fields.betas,
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-version": "2023-06-01",
    "x-app": "cli",
    "x-client-request-id": fields.clientRequestId,
  });
}

// ---------------------------------------------------------------------------
// Custom tool name cloaking
// ---------------------------------------------------------------------------

// Anthropic built-in tool names are never prefixed. Server tools from the
// pinned @ai-sdk/anthropic additionally carry versioned `type` fields
// (web_search_20250305, text_editor_20250429, computer_20250124,
// code_execution_20250522, ...) on their definitions; any tool definition with
// a string `type` is a provider tool and is left untouched.
const BUILTIN_TOOL_NAMES = new Set(["web_search", "code_execution", "text_editor", "computer"]);

/**
 * Prefix every custom tool name carried by an Anthropic request body, in
 * place: custom tool definitions (no versioned `type`), `tool_choice.name`,
 * and historical assistant `tool_use` blocks. IDs, SDK-only fields, and
 * `tool_result` blocks are preserved verbatim. Always prepend, including when
 * a logical name already starts with the prefix, so stripping exactly one
 * prefix always round-trips.
 */
function prefixRequestToolNames(params: Record<string, any>, prefix: string): void {
  const apply = (name: string) => (BUILTIN_TOOL_NAMES.has(name.toLowerCase()) ? name : `${prefix}${name}`);
  for (const tool of params.tools ?? []) {
    if (typeof tool.type !== "string") tool.name = apply(tool.name);
  }
  if (params.tool_choice?.type === "tool") params.tool_choice.name = apply(params.tool_choice.name);
  for (const message of params.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use") block.name = apply(block.name);
    }
  }
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
  prefix: string = COWORK_PROFILE.toolPrefix,
  transformName?: (name: string) => string,
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
    if (transformName) {
      let changed = false;
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        for (const [key, item] of Object.entries(value)) {
          if (key === "name" && typeof item === "string") {
            const next = transformName(item);
            if (next !== item) {
              (value as Record<string, unknown>)[key] = next;
              changed = true;
            }
          } else {
            visit(item);
          }
        }
      };
      visit(event);
      return changed ? event : undefined;
    }
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

// ---------------------------------------------------------------------------
// Body rewrite: billing fingerprint + cch + metadata.user_id attribution
// ---------------------------------------------------------------------------

type ContentBlock = {
  type: string;
  text: string;
  cache_control?: { type?: unknown; ttl?: unknown; scope?: unknown; [key: string]: unknown };
};

const BILLING_SALT = "59cf53e54c78";
const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const MAX_OUTPUT_TOKENS = 64000;
// cch attestation: XXHash64(body_with_placeholder, seed) low-20-bits as 5 hex chars.
const CCH_SEED = 0x4d659218e32a3268n;
const CCH_PLACEHOLDER = "cch=00000";

function createBillingHeader(firstUserMessageText: string, profile: SpoofingProfile): string {
  // Fingerprint: SHA256(salt + msg[4] + msg[7] + msg[20] + version)[:3],
  // chars taken from the first user text block (not the system prompt).
  const k = [4, 7, 20].map((i) => firstUserMessageText[i] ?? "0").join("");
  const versionSuffix = createHash("sha256").update(`${BILLING_SALT}${k}${profile.version}`).digest("hex").slice(0, 3);
  // The CCH placeholder is replaced after the complete request object is assembled.
  return `${BILLING_HEADER_PREFIX} cc_version=${profile.version}.${versionSuffix}; cc_entrypoint=${profile.billingEntrypoint}; ${CCH_PLACEHOLDER};`;
}

// Valid legacy cloaking id: user_<64 hex>_account_<uuid>_session_<uuid>.
const CLOAKING_USER_ID_REGEX =
  /^user_[0-9a-fA-F]{64}_account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_session_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Session id carried by a valid CC attribution user_id: the legacy cloaking
 * id's trailing session, or the `session_id` of the `{device_id, session_id,
 * ...}` JSON envelope. Undefined for anything that must be regenerated.
 */
function extractUserIdSessionId(userId: unknown): string | undefined {
  if (typeof userId !== "string") return undefined;
  const legacy = CLOAKING_USER_ID_REGEX.exec(userId);
  if (legacy) return legacy[1];
  if (userId.startsWith("{")) return JSON.parse(userId).session_id || undefined;
  return undefined;
}

function extractFirstUserText(messages: any[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    const block = message.content.find((block: ContentBlock) => block.type === "text");
    if (block) return block.text;
  }
  return "";
}

const COWORK_BODY_KEYS = [
  "model",
  "messages",
  "system",
  "tools",
  "metadata",
  "max_tokens",
  "thinking",
  "context_management",
  "output_config",
  "fallbacks",
  "stream",
  "temperature",
  "top_p",
  "top_k",
  "stop_sequences",
  "speed",
  "tool_choice",
];

/**
 * Rewrite a /v1/messages body into the active profile's shape:
 * - system[0] billing header, system[1] profile identity
 * - metadata.user_id in the CC attribution envelope (valid incoming
 *   attribution preserved verbatim)
 * - max_tokens clamped to <= 64000
 * - Cowork model compatibility, schema normalization, and prompt caching;
 *   active thinking emits a single keep-all clear-thinking edit
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
    profile?: ClaudeCodeSpoofingProfile;
  },
): { json: string; thinking: unknown; hasTools: boolean; sessionId: string } {
  const profile = ctx.profile ?? COWORK_PROFILE;
  const params = JSON.parse(body) as Record<string, any>;
  if (params.tool_choice?.type === "auto" && Object.keys(params.tool_choice).length === 1) delete params.tool_choice;
  normalizeCoworkTools(params.tools);
  applyCoworkModelCompatibility(params);
  applyCoworkPromptCaching(params.messages);
  // Cloak custom tool names before anything else, so cch hashes the
  // already-prefixed final body.
  prefixRequestToolNames(params, profile.toolPrefix);
  const hasTools = params.tools?.length > 0;

  // Cowork follows CC's gate: neither the billing header nor the identity
  // instruction goes to claude-3-5-haiku.
  const injectFingerprint = !(params.model ?? "").startsWith("claude-3-5-haiku");

  // Incoming billing blocks are kept (never stacked with a fresh one) unless
  // attribution is disabled; incoming identity blocks are re-emitted in front.
  const incomingSystem: ContentBlock[] =
    typeof params.system === "string" ? [{ type: "text", text: params.system }] : params.system ?? [];
  const billingBlocks = incomingSystem.filter((block) => block.text.startsWith(BILLING_HEADER_PREFIX));
  const system: ContentBlock[] = [];
  if (ctx.attributionHeader !== false) {
    if (billingBlocks.length > 0) system.push(...billingBlocks);
    else if (injectFingerprint) {
      system.push({ type: "text", text: createBillingHeader(extractFirstUserText(params.messages), profile) });
    }
  }
  if (injectFingerprint) system.push({ type: "text", text: profile.systemInstruction });
  system.push(...sanitizeCoworkSystem(incomingSystem.filter(
    (block) => block.text !== profile.systemInstruction && !block.text.startsWith(BILLING_HEADER_PREFIX),
  )));

  // Preserve valid CC attribution verbatim — the legacy cloaking id or the
  // `{device_id, session_id, ...}` JSON envelope with a nonempty session_id.
  // Anything else gets a freshly generated envelope whose session matches the
  // header-provided sessionId so header and body attribution stay consistent.
  const preservedSession = extractUserIdSessionId(params.metadata?.user_id);
  let userId: string;
  let sessionId: string;
  if (preservedSession !== undefined) {
    userId = params.metadata.user_id;
    sessionId = preservedSession;
  } else {
    // Generated user ids prefer an account already present in metadata over
    // the auth-derived one.
    const accountId: string | undefined =
      params.metadata?.account_uuid || params.metadata?.accountId || params.metadata?.account_id || ctx.accountId;
    sessionId = ctx.sessionId ?? randomUUID();
    userId = JSON.stringify({
      device_id: deriveDeviceId(accountId, profile.deviceDomainInstall, profile.deviceDomainAccount),
      session_id: sessionId,
      ...(accountId && { account_uuid: accountId }),
    });
  }

  const thinking = params.thinking;
  const edits = [
    ...(isActiveThinking(thinking) ? [{ type: "clear_thinking_20251015", keep: "all" }] : []),
    ...(params.context_management?.edits ?? []),
  ];
  const overrides: Record<string, any> = {
    model: params.model,
    messages: params.messages,
    ...(system.length > 0 && { system }),
    // OAuth requests always carry a tools array, even an empty one (CC does).
    tools: params.tools ?? [],
    metadata: { user_id: userId },
    max_tokens: Math.min(MAX_OUTPUT_TOKENS, params.max_tokens ?? MAX_OUTPUT_TOKENS),
    // Active thinking emits a single keep-all edit ahead of any kept compaction edit. On-demand compaction rejects
    // context_management entirely.
    ...(!params.compaction && edits.length > 0 && { context_management: { edits } }),
  };
  const merged = { ...params, ...overrides };

  // Rebuild known keys in canonical order, then append every remaining key in
  // its original relative order. Incoming `stream` is preserved as-is (the
  // normal SDK path sends true); undefined values drop out on stringify.
  const rewritten: Record<string, any> = {};
  for (const key of COWORK_BODY_KEYS) {
    if (merged[key] !== undefined) rewritten[key] = merged[key];
  }
  for (const [key, value] of Object.entries(params)) {
    if (!(key in rewritten) && value !== undefined) rewritten[key] = value;
  }

  makeStringsWellFormed(rewritten);

  const billingBlock = system.find(
    (block) => block.text.startsWith(BILLING_HEADER_PREFIX) && block.text.includes(CCH_PLACEHOLDER),
  );
  if (billingBlock) {
    // Cowork attests the raw final serialized body: hash it with the
    // placeholder still in place (OMP's wrapFetchForCch behavior).
    const hash = Bun.hash.xxHash64(JSON.stringify(rewritten), CCH_SEED);
    const cch = (hash & 0xfffffn).toString(16).padStart(5, "0");
    billingBlock.text = billingBlock.text.replace(CCH_PLACEHOLDER, `cch=${cch}`);
  }

  return { json: JSON.stringify(rewritten), thinking, hasTools, sessionId };
}
