import { createHash } from "node:crypto";

export const EX_MACHINA_PROFILE = {
  id: "ex-machina",
  wireFormat: "ex-machina",
  version: "2.1.87",
  userAgent: "claude-cli/2.1.87 (external, cli)",
  billingEntrypoint: "sdk-cli",
  systemInstruction: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
} as const;

export type ExMachinaProfile = typeof EX_MACHINA_PROFILE;

const REQUIRED_BETAS = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"];
const BILLING_SALT = "59cf53e54c78";
const TOOL_PREFIX = "mcp_";
const REMOVAL_ANCHORS = ["You are OpenCode", "github.com/anomalyco/opencode", "opencode.ai/docs"];
const FORWARDED_HEADERS = new Set([
  "authorization",
  "accept",
  "content-type",
  "anthropic-version",
  "anthropic-dangerous-direct-browser-access",
  "anthropic-beta",
  "x-app",
]);

function sanitizeExMachinaSystemText(text: string): string {
  const paragraphs = text
    .split(/\n\n+/)
    .filter((paragraph) => !REMOVAL_ANCHORS.some((anchor) => paragraph.includes(anchor)));
  return paragraphs
    .join("\n\n")
    .replace("if OpenCode honestly", "if the assistant honestly")
    .replace(
      "Here is some useful information about the environment you are running in:",
      "Environment context you are running in:",
    )
    .trim();
}

type SystemBlock = { type: string; text: string; [key: string]: unknown };

function normalizeSystem(system: string | SystemBlock[] | undefined): SystemBlock[] {
  const blocks = typeof system === "string" ? [{ type: "text", text: system }] : system ?? [];
  const sanitized = blocks.map((block) => ({ ...block, text: sanitizeExMachinaSystemText(block.text) }));
  const identity = EX_MACHINA_PROFILE.systemInstruction;
  return sanitized[0]?.text === identity ? sanitized : [{ type: "text", text: identity }, ...sanitized];
}

function buildExMachinaBillingHeader(firstUserContent: string | Array<{ type: string; text?: string }>): string {
  const text = typeof firstUserContent === "string"
    ? firstUserContent
    : firstUserContent.find((block) => block.type === "text" && block.text)?.text ?? "";
  const sampled = [4, 7, 20].map((position) => text[position] || "0").join("");
  const suffix = createHash("sha256")
    .update(`${BILLING_SALT}${sampled}${EX_MACHINA_PROFILE.version}`)
    .digest("hex")
    .slice(0, 3);
  const cch = createHash("sha256").update(text).digest("hex").slice(0, 5);
  return `x-anthropic-billing-header: cc_version=${EX_MACHINA_PROFILE.version}.${suffix}; cc_entrypoint=${EX_MACHINA_PROFILE.billingEntrypoint}; cch=${cch};`;
}

function prefixToolName(name: string): string {
  return `${TOOL_PREFIX}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function rewriteExMachinaBody(body: string, attributionHeader = true): string {
  const parsed = JSON.parse(body) as Record<string, any>;
  parsed.system = normalizeSystem(parsed.system);
  const firstUser = parsed.messages.find((message: any) => message.role === "user");
  if (attributionHeader && firstUser) {
    parsed.system.unshift({ type: "text", text: buildExMachinaBillingHeader(firstUser.content) });
  }
  for (const tool of parsed.tools ?? []) tool.name = prefixToolName(tool.name);
  for (const message of parsed.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use") block.name = prefixToolName(block.name);
    }
  }
  return JSON.stringify(parsed);
}

export function unprefixExMachinaName(name: string): string {
  if (!name.startsWith(TOOL_PREFIX)) return name;
  const uncloaked = name.slice(TOOL_PREFIX.length);
  if (uncloaked === "StructuredOutput") return uncloaked;
  return `${uncloaked.charAt(0).toLowerCase()}${uncloaked.slice(1)}`;
}

export function buildExMachinaHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  incoming.forEach((value, key) => {
    if (FORWARDED_HEADERS.has(key) || key.startsWith("x-stainless-")) headers.set(key, value);
  });
  const incomingBetas = headers.get("anthropic-beta")?.split(",").map((beta) => beta.trim()).filter(Boolean) ?? [];
  headers.set("anthropic-beta", [...new Set([...REQUIRED_BETAS, ...incomingBetas])].join(","));
  headers.set("User-Agent", EX_MACHINA_PROFILE.userAgent);
  return headers;
}
