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

const REQUIRED_BETAS = ["oauth-2025-04-20", "interleaved-thinking-2025-05-14"] as const;
const BILLING_SALT = "59cf53e54c78";
const TOOL_PREFIX = "mcp_";
const REMOVAL_ANCHORS = ["You are OpenCode", "github.com/anomalyco/opencode", "opencode.ai/docs"];

export function mergeExMachinaBetas(incoming?: string | null): string {
  const betas: string[] = [...REQUIRED_BETAS];
  const seen = new Set<string>(betas);
  for (const beta of incoming?.split(",").map((value) => value.trim()).filter(Boolean) ?? []) {
    if (seen.has(beta)) continue;
    seen.add(beta);
    betas.push(beta);
  }
  return betas.join(",");
}

export function rewriteExMachinaUrl(url: URL): URL {
  const rewritten = new URL(url);
  if (rewritten.pathname === "/v1/messages" && !rewritten.searchParams.has("beta")) {
    rewritten.searchParams.set("beta", "true");
  }
  return rewritten;
}

export function sanitizeExMachinaSystemText(text: string): string {
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

function normalizeSystem(system: unknown): SystemBlock[] {
  const identity: SystemBlock = { type: "text", text: EX_MACHINA_PROFILE.systemInstruction };
  if (system == null) return [identity];
  if (typeof system === "string") {
    const text = sanitizeExMachinaSystemText(system);
    return text === identity.text ? [identity] : [identity, { type: "text", text }];
  }
  if (typeof system === "object" && !Array.isArray(system)) {
    const record = system as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "text";
    const text = sanitizeExMachinaSystemText(typeof record.text === "string" ? record.text : "");
    return [identity, { ...record, type, text } as SystemBlock];
  }
  if (!Array.isArray(system)) return [identity];
  const blocks = system.map((item): SystemBlock => {
    if (typeof item === "string") return { type: "text", text: sanitizeExMachinaSystemText(item) };
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).type === "text" &&
      typeof (item as Record<string, unknown>).text === "string"
    ) {
      const block = item as Record<string, unknown>;
      return { ...block, type: "text", text: sanitizeExMachinaSystemText(block.text as string) } as SystemBlock;
    }
    return { type: "text", text: String(item) };
  });
  return blocks[0]?.text === identity.text ? blocks : [identity, ...blocks];
}

function firstUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const message = messages.find((item) => item?.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content.find((block: unknown) => {
    const record = block as { type?: unknown; text?: unknown };
    return record?.type === "text" && !!record.text;
  })?.text ?? "";
}

export function buildExMachinaBillingHeader(messages: unknown): string {
  const text = firstUserText(messages);
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
  try {
    const parsed = JSON.parse(body) as Record<string, any>;
    const hasUser = Array.isArray(parsed.messages) && parsed.messages.some((message) => message?.role === "user");
    parsed.system = normalizeSystem(parsed.system);
    if (attributionHeader && hasUser) {
      parsed.system.unshift({ type: "text", text: buildExMachinaBillingHeader(parsed.messages) });
    }
    if (Array.isArray(parsed.tools)) {
      for (const tool of parsed.tools) {
        if (typeof tool?.name === "string" && tool.name) tool.name = prefixToolName(tool.name);
      }
    }
    if (Array.isArray(parsed.messages)) {
      for (const message of parsed.messages) {
        if (!Array.isArray(message?.content)) continue;
        for (const block of message.content) {
          if (block?.type === "tool_use" && typeof block.name === "string" && block.name) {
            block.name = prefixToolName(block.name);
          }
        }
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export function unprefixExMachinaName(name: string): string {
  if (!name.startsWith(TOOL_PREFIX)) return name;
  const uncloaked = name.slice(TOOL_PREFIX.length);
  if (uncloaked === "StructuredOutput") return uncloaked;
  return `${uncloaked.charAt(0).toLowerCase()}${uncloaked.slice(1)}`;
}

export function buildExMachinaHeaders(
  input: string | URL | Request,
  initHeaders: HeadersInit | undefined,
  accessToken: string,
): Headers {
  const inherited = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(initHeaders).forEach((value, key) => inherited.set(key, value));
  const headers = new Headers();
  inherited.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "accept" ||
      lower === "content-type" ||
      lower === "anthropic-version" ||
      lower === "anthropic-dangerous-direct-browser-access" ||
      lower === "anthropic-beta" ||
      lower === "x-app" ||
      lower.startsWith("x-stainless-")
    ) {
      headers.set(key, value);
    }
  });
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("anthropic-beta", mergeExMachinaBetas(headers.get("anthropic-beta")));
  headers.set("User-Agent", EX_MACHINA_PROFILE.userAgent);
  return headers;
}
