import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ResponsesBody = {
  model: string;
  input: unknown[];
  instructions?: string;
  [key: string]: unknown;
};

export type CompactionState = {
  sessionID: string;
  model: string;
  endpoint: string;
  compactedCount: number;
  signature: string;
  window: unknown[];
};

type CompactionDiagnostics = {
  estimatedTokens: number;
  tokenThreshold: number;
  state: "none" | "valid" | "stale";
};

type SettledReason = "threshold_unavailable" | "below_threshold" | "no_compactable_history";

export type CompactionPlan = CompactionDiagnostics &
  (
    | { type: "passthrough"; reason: SettledReason }
    | { type: "replay"; input: unknown[]; reason: SettledReason }
    | {
        type: "compact";
        instructions: string;
        compactInput: unknown[];
        envelope: unknown[];
        keptTail: unknown[];
        compactedCount: number;
        signature: string;
        fallbackInput?: unknown[];
      }
  );

type Item = Record<string, unknown>;

const ENVELOPE_ROLES = new Set(["system", "developer"]);

function asItem(value: unknown): Item | undefined {
  return !!value && typeof value === "object" && !Array.isArray(value) ? (value as Item) : undefined;
}

export function isResponsesBody(value: unknown): value is ResponsesBody {
  const item = asItem(value);
  return !!item && typeof item.model === "string" && Array.isArray(item.input);
}

export function isResponsesEndpoint(url: string): boolean {
  return new URL(url).pathname.endsWith("/responses");
}

export function isCodexResponsesEndpoint(url: string): boolean {
  return new URL(url).pathname.endsWith("/codex/responses");
}

export function normalizeEndpoint(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export function compactUrl(url: string): string {
  return `${normalizeEndpoint(url)}/compact`;
}

/**
 * Leading `system`/`developer` items are the prompt envelope opencode rebuilds
 * every turn, not conversation history. ChatGPT OAuth sessions carry the system
 * prompt in `instructions` instead, so the envelope is empty there.
 */
export function splitEnvelope(input: readonly unknown[]): { envelope: unknown[]; history: unknown[] } {
  let boundary = 0;
  while (boundary < input.length) {
    const item = asItem(input[boundary]);
    if (!item || typeof item.role !== "string" || !ENVELOPE_ROLES.has(item.role)) break;
    boundary++;
  }
  return { envelope: input.slice(0, boundary), history: input.slice(boundary) };
}

export function envelopeText(envelope: readonly unknown[]): string {
  return envelope
    .flatMap((value) => {
      const content = asItem(value)?.content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return [];
      return content.map((part) => asItem(part)?.text).filter((text): text is string => !!text);
    })
    .join("\n");
}

/**
 * Structural fingerprint of already-compacted items. Deliberately ignores text
 * content so opencode's tool-output pruning does not invalidate a stored window,
 * while insertions, reorderings and its own compaction still do.
 */
export function fingerprint(items: readonly unknown[]): string {
  const tokens = items.map((value) => {
    const item = asItem(value);
    if (!item) return typeof value;
    const kind = typeof item.type === "string" ? item.type : `role:${String(item.role)}`;
    const id = typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : "";
    return `${kind}#${id}`;
  });
  return `${items.length}:${Bun.hash.wyhash(tokens.join("|")).toString(16)}`;
}

export function lastUserTurnIndex(items: readonly unknown[]): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (asItem(items[index])?.role === "user") return index;
  }
  return -1;
}

export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function planRequest(input: {
  body: ResponsesBody;
  state: CompactionState | undefined;
  endpoint: string;
  contextLimit: number;
  threshold: number;
}): CompactionPlan {
  const { body, endpoint, contextLimit, threshold } = input;
  const { envelope, history } = splitEnvelope(body.input);
  // The fingerprint carries the prefix length, so a truncated history mismatches too.
  const stored = input.state;
  const state =
    stored &&
    stored.model === body.model &&
    stored.endpoint === endpoint &&
    fingerprint(history.slice(0, stored.compactedCount)) === stored.signature
      ? stored
      : undefined;
  const offset = state ? state.window.length : 0;
  const base = state ? [...state.window, ...history.slice(state.compactedCount)] : history;
  const replayInput = state ? [...envelope, ...base] : undefined;
  const tokenThreshold = threshold <= 1 ? contextLimit * threshold : threshold;
  const estimatedTokens = estimateTokens({ ...body, input: [...envelope, ...base] });
  const diagnostics = {
    estimatedTokens,
    tokenThreshold,
    state: stored ? (state ? "valid" : "stale") : "none",
  } as const;
  const settled = (reason: SettledReason): CompactionPlan =>
    replayInput
      ? { type: "replay", input: replayInput, reason, ...diagnostics }
      : { type: "passthrough", reason, ...diagnostics };

  if (tokenThreshold <= 0) return settled("threshold_unavailable");
  if (estimatedTokens < tokenThreshold) return settled("below_threshold");

  const tailStart = Math.max(lastUserTurnIndex(base), offset);
  if (tailStart <= offset) return settled("no_compactable_history");

  const compactedCount = (state?.compactedCount ?? 0) + (tailStart - offset);
  return {
    type: "compact",
    instructions: body.instructions ?? envelopeText(envelope),
    compactInput: base.slice(0, tailStart),
    envelope,
    keptTail: base.slice(tailStart),
    compactedCount,
    signature: fingerprint(history.slice(0, compactedCount)),
    fallbackInput: replayInput,
    ...diagnostics,
  };
}

export function readCompactedWindow(value: unknown): unknown[] | undefined {
  const output = asItem(value)?.output;
  return Array.isArray(output) && output.length > 0 ? output : undefined;
}

export function readStreamingCompactedWindow(value: string, input: readonly unknown[]): unknown[] | undefined {
  let completed = false;
  const compactionItems: unknown[] = [];

  for (const block of value.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;

    let event: Item;
    try {
      const parsed = asItem(JSON.parse(data));
      if (!parsed) return undefined;
      event = parsed;
    } catch {
      return undefined;
    }

    const type = typeof event.type === "string" ? event.type : eventName;
    if (type === "response.output_item.done") {
      const item = asItem(event.item);
      if (item?.type === "compaction") compactionItems.push(item);
    } else if (type === "response.completed" || type === "response.done") {
      completed = true;
    } else if (type === "response.failed" || type === "response.incomplete") {
      return undefined;
    }
  }

  if (!completed || compactionItems.length !== 1) return undefined;

  // Codex V2 returns one opaque compaction item and expects recent real user
  // messages to remain alongside it, capped at the same 64K budget as Codex.
  let remainingTokens = 64_000;
  const retained: unknown[] = [];
  for (let index = input.length - 1; index >= 0; index--) {
    const item = asItem(input[index]);
    if (item?.role !== "user" || (item.type !== undefined && item.type !== "message")) continue;
    const tokens = estimateTokens(item);
    if (tokens > remainingTokens) break;
    retained.unshift(item);
    remainingTokens -= tokens;
  }
  return [...retained, ...compactionItems];
}

export function compactionProjectKey(projectID: string, directory: string): string {
  return projectID === "global"
    ? `global-${Bun.hash.wyhash(resolve(directory)).toString(16)}`
    : projectID.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function compactionDirectory(projectID: string, directory: string): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "openai-compaction", compactionProjectKey(projectID, directory));
}

export function statePath(root: string, sessionID: string): string {
  return join(root, `${sessionID.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`);
}

export function precedingMessageID(messageID: string): string | undefined {
  const match = /^msg_([0-9a-fA-F]{12})([0-9a-zA-Z]{14})$/.exec(messageID);
  if (!match) return undefined;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const random = match[2]!.split("");
  for (let index = random.length - 1; index >= 0; index--) {
    const value = alphabet.indexOf(random[index]!);
    if (value <= 0) continue;
    random[index] = alphabet[value - 1]!;
    random.fill("z", index + 1);
    return `msg_${match[1]!.toLowerCase()}${random.join("")}`;
  }
  const value = BigInt(`0x${match[1]}`);
  if (value === 0n) return undefined;
  const time = (value - 1n).toString(16).padStart(12, "0");
  return `msg_${time}${"z".repeat(14)}`;
}
