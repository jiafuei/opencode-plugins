import { createHash } from "node:crypto";
import { deriveDeviceId } from "./local_storage.ts";

export const CLI_PROFILE = {
  id: "cli",
  version: "2.1.321",
  userAgent: "claude-cli/2.1.321 (external, cli)",
  billingEntrypoint: "cli",
  systemInstruction: "You are Claude Code, Anthropic's official CLI for Claude.",
  toolPrefix: "mcp__oc__",
} as const;

export const SDK_CLI_PROFILE = {
  ...CLI_PROFILE,
  id: "sdk-cli",
  userAgent: "claude-cli/2.1.321 (external, sdk-cli)",
  billingEntrypoint: "sdk-cli",
  systemInstruction: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
} as const;

export type CliProfile = typeof CLI_PROFILE | typeof SDK_CLI_PROFILE;

export interface CliAttribution {
  sessionId: string;
  accountId?: string;
  agentId?: string;
  agentType?: string;
  requestClass: "main" | "subagent" | "auxiliary" | "compaction";
  title?: boolean;
  /** Original user text, before the provider merges injected context into user blocks. */
  firstUserText?: string;
  toolsUsed?: ReadonlySet<string>;
  promptId?: string;
  turnOrigin?: "human" | "task_notification" | "sdk";
  /** Main-thread turns and the prompts among them, both from 1. */
  promptIndex?: number;
  turnIndex?: number;
  /** What triggered a compaction request, and on the first main request after one, the compaction it follows. */
  compactionKind?: "auto" | "manual";
  contextCompacted?: "auto" | "manual";
  previousRequestId?: string;
  previousMessageId?: string;
}

const IDENTITY = CLI_PROFILE.systemInstruction;
const AGENT_IDENTITY = SDK_CLI_PROFILE.systemInstruction;
const PREAMBLE = "You are an interactive agent that helps users with software engineering tasks. " +
  "Workspace tools are provided by the oc MCP server. Use the available tool schemas and follow the user's instructions.";
const BILLING = "x-anthropic-billing-header:";
// Claude 3 and 4 models go without the per-turn, tool-change, clear-at, and thinking-update betas and keep their
// thinking options. Every other ID gets the current set, including models and families released after this profile.
const LEGACY = /^claude-(?:3-|(?:opus|sonnet|haiku)-4)/;

/** Native byte-marker normalization, verified against 2.1.280 and 2.1.284 captures (September 29–30) and 48 2.1.296 requests (October 11). */
export function patchCliCch(body: string): string {
  const anchor = body.indexOf('"system":[');
  const placeholder = body.indexOf("cch=00000", anchor);
  if (anchor < 0 || placeholder < 0 || Buffer.byteLength(body.slice(anchor, placeholder + 9)) > 300) return body;
  const markers = /"model":"[^"]*"|"max_tokens":\d+|"fallback_credit_token":"[^"]*"|"fallbacks":\[/g;
  let cursor = 0;
  let normalized = "";
  for (let match; (match = markers.exec(body));) {
    let start = match.index;
    let end = markers.lastIndex;
    if (match[0].startsWith('"model":')) {
      normalized += body.slice(cursor, start) + '"model":""';
      cursor = end;
      continue;
    }
    if (match[0] === '"fallbacks":[') {
      let depth = 1;
      let quoted = false;
      while (end < body.length && depth > 0) {
        const char = body[end++]!;
        if (quoted) {
          if (char === "\\") end++;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === "[") depth++;
        else if (char === "]") depth--;
      }
    }
    if (body[end] === ",") end++;
    else if (start > cursor && body[start - 1] === ",") start--;
    normalized += body.slice(cursor, start);
    cursor = end;
    markers.lastIndex = end;
  }
  normalized += body.slice(cursor);
  const hash = Bun.hash.xxHash64(new TextEncoder().encode(normalized), 0x4d659218e32a3268n);
  const cch = (hash & 0xfffffn).toString(16).padStart(5, "0");
  return body.slice(0, placeholder + 4) + cch + body.slice(placeholder + 9);
}

export function rewriteCliBody(body: string, attribution: CliAttribution, attributionHeader = true, profile: CliProfile = CLI_PROFILE) {
  const params = JSON.parse(body) as Record<string, any>;
  const search = attribution.requestClass === "auxiliary" && params.tools?.length === 1 &&
    params.tools[0].type?.startsWith("web_search_");
  const utility = !params.tools?.length && !["enabled", "adaptive"].includes(params.thinking?.type);
  const structured = params.output_config?.format?.type === "json_schema";
  const sideQuery = attribution.requestClass === "auxiliary" && utility && !structured && !attribution.title;
  const compaction = attribution.requestClass === "compaction";
  const providerNames = new Set<string>((params.tools ?? []).filter((tool: any) => typeof tool.type === "string" && tool.type !== "custom").map((tool: any) => tool.name));
  const prefix = (name: string) => providerNames.has(name) ? name : profile.toolPrefix + name;
  for (const tool of params.tools ?? []) {
    if (typeof tool.type !== "string" || tool.type === "custom") {
      tool.name = prefix(tool.name);
      tool.ownership_metadata = { verified: false, owner: "mcp" };
    }
    delete tool.cache_control;
  }
  if (params.tool_choice?.type === "tool") params.tool_choice.name = prefix(params.tool_choice.name);
  if (!search && params.tool_choice?.type === "auto" && Object.keys(params.tool_choice).length === 1) delete params.tool_choice;
  let firstUserText = attribution.firstUserText;
  const usedTools = new Set<string>();
  for (const message of params.messages) {
    const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    for (const block of blocks) {
      delete block.cache_control;
      if (block.type === "tool_use") {
        block.name = prefix(block.name);
        usedTools.add(block.name);
      }
      if (block.type === "server_tool_use" || block.type === "mcp_tool_use") usedTools.add(block.name);
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        for (const part of block.content) {
          if (part.type === "tool_reference") part.tool_name = prefix(part.tool_name);
        }
      }
      if (["tool_addition", "tool_removal"].includes(block.type) && block.tool.type === "tool_reference") block.tool.name = prefix(block.tool.name);
      if (firstUserText === undefined && message.role === "user" && block.type === "text" && !block.text.startsWith("<system-reminder>")) {
        firstUserText = block.text;
      }
    }
  }

  const incoming = search ? [{ type: "text", text: "You are an assistant for performing a web search tool use" }]
    : typeof params.system === "string" ? [{ type: "text", text: params.system }] : params.system ?? [];
  // Only the harness opening is removed and the environment preamble reworded. Repository
  // instructions, memories, skills, quoted text, and user references to OpenCode remain verbatim.
  const instructions = incoming
    .filter((block: any) => !block.text.startsWith(BILLING) && block.text !== IDENTITY && block.text !== AGENT_IDENTITY)
    .map((block: any, index: number) => index === 0
      ? block.text.replace(/^You are an AI agent running in OpenCode, a coding agent harness\. ?/, "")
        .replace(/^You are OpenCode[^\n]*\n?/, "")
      : block.text)
    .filter(Boolean).join("\n\n")
    // Anthropic flags OpenCode's environment preamble next to its <env> block as a third-party app.
    .replace("Here is some useful information about the environment you are running in:", "You have been invoked in the following environment:");
  const cache = attribution.agentId || compaction ? { type: "ephemeral" } : { type: "ephemeral", ttl: "1h" };
  const system: any[] = [];
  if (attributionHeader) {
    const sample = [4, 7, 20].map((index) => (firstUserText ?? "")[index] ?? "0").join("");
    const suffix = createHash("sha256").update(`59cf53e54c78${sample}${profile.version}`).digest("hex").slice(0, 3);
    let billing = `${BILLING} cc_version=${profile.version}.${suffix}; cc_entrypoint=${profile.billingEntrypoint}; cch=00000;`;
    if (attribution.agentId) billing += " cc_is_subagent=true;";
    if (attribution.previousRequestId) billing += ` cc_prev_req=${attribution.previousRequestId};`;
    if (attribution.promptId) billing += ` cc_prompt_id=${attribution.promptId};`;
    if (!attribution.agentId && attribution.turnOrigin) billing += ` cc_turn_origin=${attribution.turnOrigin};`;
    if (!attribution.agentId && attribution.turnIndex) billing += ` cc_prompt_index=${attribution.promptIndex}; cc_turn_index=${attribution.turnIndex};`;
    system.push({ type: "text", text: billing });
  }
  system.push({ type: "text", text: attribution.agentId ? AGENT_IDENTITY : profile.systemInstruction,
    ...(!utility && !search && attribution.agentId ? { cache_control: cache } : {}) });
  if (!utility && !search && !attribution.agentId) {
    system.push({ type: "text", text: PREAMBLE, cache_control: { ...cache, scope: "global" } });
  }
  if (instructions) system.push({ type: "text", text: instructions, ...(!utility && !search ? { cache_control: cache } : {}) });
  if (!utility && !search && params.messages.length) {
    // CC's compaction request reads the conversation's cache up to the message before its summary prompt.
    // System messages may trail that prompt.
    const prompt = params.messages.findLastIndex((message: any) => message.role === "user");
    const last = compaction ? params.messages.slice(0, prompt).findLast((message: any) => message.role !== "system")
      : params.messages.at(-1);
    if (last) {
      if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
      const block = last.content.findLast((part: any) => !["thinking", "redacted_thinking"].includes(part.type));
      if (block) block.cache_control = cache;
    }
  }

  const thinking = params.thinking ? { ...params.thinking } : undefined;
  const activeThinking = ["enabled", "adaptive"].includes(thinking?.type);
  if (activeThinking && !LEGACY.test(params.model)) {
    thinking.display = profile.id === "sdk-cli" ? "omitted" : "updates";
    delete thinking.block_binding;
  }
  // CC sends a keep-all clear-thinking edit with active thinking, which must come before any caller edit such as
  // threshold compaction. On-demand compaction rejects context_management entirely.
  const edits = [
    ...(activeThinking ? [{ type: "clear_thinking_20251015", keep: "all" }] : []),
    ...(params.context_management?.edits ?? []).filter((edit: any) => edit.type !== "clear_thinking_20251015"),
  ];
  const context = !params.compaction && edits.length ? { ...params.context_management, edits } : undefined;
  delete params.context_management;
  const rewritten: Record<string, any> = {
    model: params.model,
    messages: params.messages,
    system,
    tools: params.tools ?? [],
    metadata: { user_id: JSON.stringify({ device_id: deriveDeviceId(attribution.accountId),
      ...(attribution.accountId ? { account_uuid: attribution.accountId } : {}), session_id: attribution.sessionId }) },
    max_tokens: params.max_tokens,
    ...(thinking ? { thinking } : {}),
    ...(context ? { context_management: context } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.output_config ? { output_config: params.output_config } : {}),
    ...(!utility && !search ? { diagnostics: { previous_message_id: attribution.previousMessageId ?? null } } : {}),
    ...(params.stream !== undefined ? { stream: params.stream } : {}),
  };
  for (const [key, value] of Object.entries(params)) if (!(key in rewritten)) rewritten[key] = value;
  return { json: patchCliCch(JSON.stringify(rewritten)), model: params.model as string, utility, search, structured, sideQuery, thinking,
    effort: thinking?.type === "adaptive" || params.output_config?.effort !== undefined, usedTools };
}

export function cliHeaders(
  incoming: Headers,
  attribution: CliAttribution,
  body: ReturnType<typeof rewriteCliBody>,
  requestId: string,
  retry: number,
  profile: CliProfile = CLI_PROFILE,
): Record<string, string> {
  const compaction = attribution.requestClass === "compaction";
  const legacy = LEGACY.test(body.model);
  const haiku = body.model.startsWith("claude-haiku-");
  const betas = [
    ...(!body.utility && !haiku ? ["claude-code-20250219"] : []),
    "oauth-2025-04-20", "interleaved-thinking-2025-05-14",
    ...(body.utility || body.search ? ["redact-thinking-2026-02-12"] : []),
    "context-management-2025-06-27", "prompt-caching-scope-2026-01-05",
    // Haiku requests move the Claude Code beta behind prompt-caching-scope.
    ...(!body.utility && haiku ? ["claude-code-20250219"] : []),
    ...(!legacy ? ["per-turn-control-2026-07-01", "mid-conversation-tool-changes-2026-07-01"] : []),
    "tool-provenance-2026-10-26", "thinking-token-count-2026-05-13",
    ...(!body.utility && !body.search ? ["advanced-tool-use-2025-11-20"] : []),
    ...(!legacy ? ["mid-conversation-system-clear-at-2026-08-21"] : []),
    ...(body.sideQuery ? ["claude-code-side-query-2026-09-29"] : []),
    ...(body.effort ? ["effort-2025-11-24"] : []),
    ...(body.structured ? ["structured-outputs-2025-12-15"] : []),
    ...(!body.utility ? [
      ...(profile.id === "cli" && compaction ? ["fallback-credit-2026-06-01"] : []),
      ...(!body.search ? ["thinking-binding-controls-2026-08-01"] : []),
      ...(body.thinking?.display === "updates" ? ["thinking-display-updates-2026-08-18"] : []),
      ...(!body.search && !compaction && !attribution.agentId ? ["extended-cache-ttl-2025-04-11"] : []),
    ] : []),
    "cache-diagnosis-2026-04-07",
  ];
  for (const beta of incoming.get("anthropic-beta")?.split(",").map((value) => value.trim()) ?? []) {
    if (profile.id === "sdk-cli" && ["fallback-credit-2026-06-01", "thinking-display-updates-2026-08-18"].includes(beta)) continue;
    if (!beta || betas.includes(beta) || ["context-1m-2025-08-07", "fine-grained-tool-streaming-2025-05-14",
      "structured-outputs-2025-11-13", "redact-thinking-2026-02-12", "mid-conversation-system-2026-04-07",
      "fallback-credit-2026-06-01", "structured-outputs-2025-12-15"].includes(beta)) continue;
    betas.push(beta);
  }
  // All local tools are exposed through oc's MCP namespace. Provider tools retain their native names.
  const used = [...new Set([...(attribution.toolsUsed ?? []), ...body.usedTools])].map((name) =>
    JSON.stringify({ name, ...(name.startsWith("mcp__") ? { mcp: true } : {}) })
      .replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`));
  const toolsHeader: string[] = [];
  let bytes = 2;
  for (const entry of used) {
    if (toolsHeader.length === 64 || bytes + entry.length + toolsHeader.length > 7168) break;
    toolsHeader.push(entry);
    bytes += entry.length;
  }
  if (toolsHeader.length < used.length) {
    const marker = '{"name":"unreadable-tools-used-before-summary"}';
    while (toolsHeader.length >= 64 || bytes + marker.length + toolsHeader.length > 7168) bytes -= toolsHeader.pop()!.length;
    toolsHeader.unshift(marker);
  }
  return {
    Accept: "application/json",
    Authorization: incoming.get("authorization")!,
    "Content-Type": "application/json",
    "User-Agent": profile.userAgent,
    "X-Claude-Code-Session-Id": attribution.sessionId,
    "X-Stainless-Arch": "x64",
    "X-Stainless-Lang": "js",
    "X-Stainless-OS": "Linux",
    "X-Stainless-Package-Version": "0.128.0",
    "X-Stainless-Retry-Count": String(retry),
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": "v26.12.1",
    "X-Stainless-Timeout": "600",
    "anthropic-beta": betas.join(","),
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-version": "2023-06-01",
    "x-app": "cli",
    ...(attribution.contextCompacted ? {
      "x-cc-context-compacted": attribution.contextCompacted, "x-claude-code-context-compacted": attribution.contextCompacted,
    } : {}),
    ...(attribution.compactionKind ? {
      "x-cc-compaction-request": attribution.compactionKind, "x-claude-code-compaction": attribution.compactionKind,
    } : {}),
    ...(attribution.agentId ? { "x-claude-code-agent-id": attribution.agentId } : {}),
    ...(attribution.agentType && attribution.requestClass === "subagent" ? { "x-claude-code-agent-type": attribution.agentType } : {}),
    ...(attribution.promptId ? { "x-claude-code-prompt-id": attribution.promptId } : {}),
    "x-claude-code-request-class": attribution.requestClass,
    "x-claude-code-sandy-plover": `[${toolsHeader.join(",")}]`,
    "x-client-request-id": requestId,
  };
}
