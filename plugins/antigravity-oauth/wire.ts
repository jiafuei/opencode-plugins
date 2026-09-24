/**
 * Antigravity wire-format helpers.
 *
 * Everything in this file mirrors the behavior of the native
 * `antigravity/hub` client and oh-my-pi's Google Antigravity implementation
 * against the Cloud Code Assist (`daily-cloudcode-pa`) endpoints: request
 * envelope construction, per-session identity state, effort-tier wire-id
 * routing, tool schema normalization, and SSE response unwrapping.
 */

import { Model, Provider } from "@opencode/plugin";
import { normalizeSchemaForCCA, normalizeToolSchemaForCCA } from "./schema.ts";

export const PROVIDER_ID = Provider.ID.make("google-antigravity");

// ---------------------------------------------------------------------------
// Endpoints & captured constants
// ---------------------------------------------------------------------------

export const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINTS = [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT] as const;

const DEFAULT_ANTIGRAVITY_VERSION = "2.8.0";

const ANTIGRAVITY_VERSION_MANIFEST_URL =
  "https://antigravity-hub-auto-updater-974169037036.us-central1.run.app/manifest/latest-arm64-mac.yml";
const ANTIGRAVITY_VERSION_FETCH_TIMEOUT_MS = 5_000;

let discoveredAntigravityVersion: string | null = null;
let antigravityVersionFetch: Promise<void> | null = null;

/** Current Antigravity client version: env override → manifest-discovered → pinned fallback. */
export function getAntigravityVersion(): string {
  return process.env.OPENCODE_ANTIGRAVITY_VERSION || discoveredAntigravityVersion || DEFAULT_ANTIGRAVITY_VERSION;
}

/** Extracts the client version from an electron-builder update manifest. */
export function parseAntigravityManifestVersion(yamlText: string): string | null {
  for (const line of yamlText.split(/\r?\n/)) {
    const match = /^\s*version\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const version = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  }
  return null;
}

/**
 * Resolves the latest Antigravity release from the official update manifest.
 * Cached for the process lifetime; failures are silent (the pinned fallback
 * stays valid). Skipped entirely when OPENCODE_ANTIGRAVITY_VERSION is set.
 */
export function ensureAntigravityVersion(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<void> {
  if (process.env.OPENCODE_ANTIGRAVITY_VERSION || discoveredAntigravityVersion) return Promise.resolve();
  if (antigravityVersionFetch) return antigravityVersionFetch;

  antigravityVersionFetch = (async () => {
    try {
      const timeoutSignal = AbortSignal.timeout(ANTIGRAVITY_VERSION_FETCH_TIMEOUT_MS);
      const response = await fetcher(ANTIGRAVITY_VERSION_MANIFEST_URL, {
        headers: { "Cache-Control": "no-cache", "User-Agent": "electron-builder" },
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      });
      if (response.ok) {
        discoveredAntigravityVersion = parseAntigravityManifestVersion(await response.text());
      }
    } catch {
      // Silent: pinned fallback remains valid when version discovery fails.
    } finally {
      if (!discoveredAntigravityVersion) antigravityVersionFetch = null;
    }
  })();
  return antigravityVersionFetch;
}

/**
 * Antigravity User-Agent, captured from the real `antigravity/hub` client:
 * `antigravity/hub/2.8.0 (aidev_client; os_type=darwin; arch=arm64; cl=963137146)`.
 * os_type/arch are pinned to the darwin/arm64 reference client independent of
 * host platform; only the version gates backend models.
 * Overrides: OPENCODE_ANTIGRAVITY_VERSION / _CL / _OS / _ARCH.
 */
export function getAntigravityUserAgent(): string {
  const version = getAntigravityVersion();
  const cl = process.env.OPENCODE_ANTIGRAVITY_CL || "963137146";
  const os = process.env.OPENCODE_ANTIGRAVITY_OS || "darwin";
  const arch = process.env.OPENCODE_ANTIGRAVITY_ARCH || "arm64";
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
}

/** `anthropic-beta` header sent for reasoning Claude models on Antigravity. */
export const CLAUDE_THINKING_BETA_HEADER = "interleaved-thinking-2025-05-14";

/** CCA bypass accepted only when a Gemini 3 turn's first function call is unsigned. */
const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

/**
 * Per-wire-id Cloud Code Assist request constants captured from the real
 * `antigravity/hub` client. `modelEnum` is the opaque `labels.model_enum`
 * token; Claude-backed ids omit it. `maxOutputTokens` is the fixed
 * `generationConfig.maxOutputTokens` the backend enforces regardless of the
 * thinking budget (Claude rejects >64000 with a 400).
 */
export interface AntigravityModelWireProfile {
  modelEnum?: string;
  maxOutputTokens: number;
}

export const ANTIGRAVITY_MODEL_WIRE_PROFILES: Readonly<Record<string, AntigravityModelWireProfile>> = {
  "gemini-3.5-flash-extra-low": { modelEnum: "MODEL_PLACEHOLDER_M187", maxOutputTokens: 65536 },
  "gemini-3.5-flash-low": { modelEnum: "MODEL_PLACEHOLDER_M20", maxOutputTokens: 65536 },
  "gemini-3-flash-agent": { modelEnum: "MODEL_PLACEHOLDER_M132", maxOutputTokens: 65536 },
  "gemini-3.1-pro-low": { modelEnum: "MODEL_PLACEHOLDER_M36", maxOutputTokens: 65535 },
  "gemini-pro-agent": { modelEnum: "MODEL_PLACEHOLDER_M16", maxOutputTokens: 65535 },
  "claude-sonnet-4-6": { maxOutputTokens: 64000 },
  "claude-opus-4-6-thinking": { maxOutputTokens: 64000 },
};

// ---------------------------------------------------------------------------
// Model registry: logical models + effort-tier routing tables
// ---------------------------------------------------------------------------

export type Effort = "minimal" | "low" | "medium" | "high";
const EFFORT_ORDER: readonly Effort[] = ["minimal", "low", "medium", "high"];

/**
 * Default thinking budgets OMP applies for budget-mode families without baked
 * per-effort budgets (Claude, GPT-OSS, Gemini 2.5).
 */
export const DEFAULT_EFFORT_BUDGETS: Readonly<Record<Effort, number>> = {
  minimal: 1024,
  low: 4096,
  medium: 8192,
  high: 16384,
};

export interface AntigravityModelSpec {
  name: string;
  reasoning: boolean;
  imageInput: boolean;
  contextWindow: number;
  outputLimit: number;
  /** Thinking transport the family uses on daily-cloudcode-pa. */
  transport: "level" | "budget";
  /** Supported efforts; requests clamp unsupported efforts to the lowest one. */
  efforts?: readonly Effort[];
  /** Per-effort upstream wire id; "off" applies when thinking is disabled. */
  routing?: Partial<Record<Effort | "off", string>>;
  /** Fallback wire id when routing misses (OMP's requestModelId). */
  requestModelId?: string;
  /** Baked per-effort thinking budgets (budget transport only). */
  budgets?: Readonly<Partial<Record<Effort, number>>>;
  /** Thinking-off requests must explicitly suppress thinking on the wire. */
  suppressWhenOff?: boolean;
}

function thinkingPair(baseId: string, name: string, ctx: number, out: number, image = true): AntigravityModelSpec {
  return {
    name,
    reasoning: true,
    imageInput: image,
    contextWindow: ctx,
    outputLimit: out,
    transport: "budget",
    routing: {
      off: baseId,
      minimal: `${baseId}-thinking`,
      low: `${baseId}-thinking`,
      medium: `${baseId}-thinking`,
      high: `${baseId}-thinking`,
    },
  };
}

export const MODEL_SPECS: Readonly<Record<string, AntigravityModelSpec>> = {
  "claude-opus-4-5": thinkingPair("claude-opus-4-5", "Claude Opus 4.5", 200_000, 64_000),
  "claude-opus-4-6": {
    name: "Claude Opus 4.6",
    reasoning: true,
    imageInput: true,
    contextWindow: 250_000,
    outputLimit: 64_000,
    // Only the `-thinking` wire id exists upstream; thinking state rides the
    // request body, so both on/off requests use it.
    transport: "budget",
    requestModelId: "claude-opus-4-6-thinking",
  },
  "claude-sonnet-4-5": thinkingPair("claude-sonnet-4-5", "Claude Sonnet 4.5", 1_000_000, 64_000),
  "claude-sonnet-4-6": {
    name: "Claude Sonnet 4.6",
    reasoning: true,
    imageInput: true,
    contextWindow: 250_000,
    outputLimit: 64_000,
    // Only the bare wire id exists upstream (asymmetric exposure).
    transport: "budget",
  },
  "gemini-2.5-flash": thinkingPair("gemini-2.5-flash", "Gemini 2.5 Flash", 1_048_576, 65_535),
  "gemini-2.5-flash-lite": {
    name: "Gemini 2.5 Flash Lite",
    reasoning: true,
    imageInput: true,
    contextWindow: 1_048_576,
    outputLimit: 65_535,
    transport: "budget",
  },
  "gemini-2.5-pro": {
    name: "Gemini 2.5 Pro",
    reasoning: true,
    imageInput: true,
    contextWindow: 1_048_576,
    outputLimit: 65_536,
    transport: "budget",
  },
  "gemini-3-flash": flashBudgetFamily("gemini-3-flash", "Gemini 3 Flash"),
  "gemini-3.5-flash": flashBudgetFamily("gemini-3.5-flash", "Gemini 3.5 Flash"),
  "gemini-3-pro": {
    name: "Gemini 3 Pro",
    reasoning: true,
    imageInput: true,
    contextWindow: 1_048_576,
    outputLimit: 65_535,
    transport: "level",
    efforts: ["low", "high"],
    routing: { off: "gemini-3-pro-low", low: "gemini-3-pro-low", high: "gemini-3-pro-high" },
    suppressWhenOff: true,
  },
  "gemini-3.1-pro": {
    name: "Gemini 3.1 Pro Preview",
    reasoning: true,
    imageInput: true,
    contextWindow: 1_048_576,
    outputLimit: 65_535,
    transport: "budget",
    efforts: ["low", "high"],
    // High routes to `gemini-pro-agent`: the upstream `gemini-3.1-pro-high`
    // deployment returns INVALID_ARGUMENT on every streamGenerateContent call.
    routing: { off: "gemini-3.1-pro-low", low: "gemini-3.1-pro-low", high: "gemini-pro-agent" },
    budgets: { low: 1001, high: 10001 },
    suppressWhenOff: true,
  },
  "gemini-3.6-flash": levelFlashFamily("gemini-3.6-flash", "Gemini 3.6 Flash"),
  "gemini-3.7-flash": levelFlashFamily("gemini-3.7-flash", "Gemini 3.7 Flash"),
  "gemini-3.8-flash": levelFlashFamily("gemini-3.8-flash", "Gemini 3.8 Flash"),
  "gpt-oss-120b": {
    name: "GPT-OSS 120B",
    reasoning: true,
    imageInput: false,
    contextWindow: 131_072,
    outputLimit: 32_768,
    transport: "budget",
    requestModelId: "gpt-oss-120b-medium",
  },
};

/** Antigravity budget-mode Flash family: captured tier triplets + budgets. */
function flashBudgetFamily(id: string, name: string): AntigravityModelSpec {
  return {
    name,
    reasoning: true,
    imageInput: true,
    contextWindow: 1_048_576,
    outputLimit: 65_536,
    transport: "budget",
    routing: {
      off: "gemini-3.5-flash-extra-low",
      minimal: "gemini-3.5-flash-extra-low",
      low: "gemini-3.5-flash-extra-low",
      medium: "gemini-3.5-flash-low",
      high: "gemini-3-flash-agent",
    },
    budgets: { minimal: 1000, low: 1000, medium: 4000, high: 10000 },
    suppressWhenOff: true,
  };
}

/** Gemini 3.6+ Flash: one mandatory-reasoning wire id per level. */
function levelFlashFamily(id: string, name: string): AntigravityModelSpec {
  return {
    name,
    reasoning: true,
    imageInput: true,
    contextWindow: 1_048_576,
    outputLimit: 65_536,
    transport: "level",
    routing: {
      minimal: `${id}-low`,
      low: `${id}-low`,
      medium: `${id}-medium`,
      high: `${id}-high`,
    },
  };
}

export function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("claude");
}

/** Clamp an effort to the spec's lowest supported effort (OMP minimumSupportedEffort). */
function clampEffort(spec: AntigravityModelSpec, effort: Effort): Effort {
  const supported = spec.efforts ?? EFFORT_ORDER;
  return (supported as readonly string[]).includes(effort) ? effort : supported[0] ?? "minimal";
}

export interface ResolvedThinking {
  /**
   * Wire-routing effort. "off" also covers requests whose custom thinking
   * controls cannot be mapped to a captured tier; those additionally set
   * `unmatched` so the wire rewrite forwards them untouched.
   */
  effort: Effort | "off";
  /** True when a thinkingConfig was present on the incoming request. */
  requested: boolean;
  /** Requested but unmappable custom control; never re-serialized. */
  unmatched?: boolean;
}

/**
 * Extract the requested thinking tier from the request's generationConfig.
 *
 * OpenCode's default Google variants supply `thinkingLevel` for
 * Gemini 3 ids regardless of the family's native transport, and merged
 * variant options can carry level and budget together; this normalizes to
 * exactly the model spec's transport at the wire boundary:
 * - level families understand `thinkingLevel` only;
 * - budget families understand their captured budgets, then OpenCode-style
 *   levels mapped onto the family's tiers.
 */
export function readRequestedEffort(
  spec: AntigravityModelSpec,
  thinkingConfig: Record<string, unknown> | undefined,
): ResolvedThinking {
  if (!thinkingConfig || !spec.reasoning) return { effort: "off", requested: false };
  const levelRaw = typeof thinkingConfig.thinkingLevel === "string" ? thinkingConfig.thinkingLevel.toLowerCase() : undefined;
  const budget =
    typeof thinkingConfig.thinkingBudget === "number" && Number.isFinite(thinkingConfig.thinkingBudget)
      ? thinkingConfig.thinkingBudget
      : undefined;

  if (spec.transport === "level") {
    // Level families understand levels only; a bare budget never invents a tier.
    if (levelRaw && (EFFORT_ORDER as readonly string[]).includes(levelRaw)) {
      return { effort: clampEffort(spec, levelRaw as Effort), requested: true };
    }
  } else {
    if (budget !== undefined) {
      const budgets = spec.budgets ?? DEFAULT_EFFORT_BUDGETS;
      for (const effort of EFFORT_ORDER) {
        if (budgets[effort] === budget) return { effort, requested: true };
      }
    }
    // OpenCode-style levels map onto the family's captured tiers.
    if (levelRaw && (EFFORT_ORDER as readonly string[]).includes(levelRaw)) {
      return { effort: clampEffort(spec, levelRaw as Effort), requested: true };
    }
  }

  // Reasoning requested without any usable control: OpenCode's intended
  // reasoning default is high.
  if (levelRaw === undefined && budget === undefined && thinkingConfig.includeThoughts === true) {
    return { effort: clampEffort(spec, "high"), requested: true };
  }

  // No tier control at all (e.g. includeThoughts:false): an explicit off.
  if (levelRaw === undefined && budget === undefined) {
    return { effort: "off", requested: true };
  }

  // Custom/unmatched control: preserve untouched, route like off.
  return { effort: "off", requested: true, unmatched: true };
}

/** The single transport-native thinking control for an effort on a spec. */
function nativeThinkingControl(spec: AntigravityModelSpec, includeThoughts: boolean, effort: Effort): Record<string, unknown> {
  const level = effort === "minimal" && spec.routing?.minimal === spec.routing?.low ? "low" : effort;
  return spec.transport === "level"
    ? { includeThoughts, thinkingLevel: level.toUpperCase() }
    : { includeThoughts, thinkingBudget: spec.budgets?.[effort] ?? DEFAULT_EFFORT_BUDGETS[effort] };
}

/** Resolve the outbound wire id for a logical model under the requested effort. */
export function resolveWireModelId(spec: AntigravityModelSpec, requested: ResolvedThinking, logicalModelId: string): string {
  const routed =
    requested.effort === "off"
      ? spec.routing?.off
      : spec.routing?.[clampEffort(spec, requested.effort as Effort)];
  if (routed) return routed;
  // Families without an "off" route are mandatory-reasoning: thinking-off
  // requests clamp to the lowest supported effort (OMP minimumSupportedEffort).
  if (requested.effort === "off") {
    const lowest = (spec.efforts ?? EFFORT_ORDER)[0];
    const clampedRoute = lowest ? spec.routing?.[lowest] : undefined;
    if (clampedRoute) return clampedRoute;
  }
  return spec.requestModelId ?? logicalModelId;
}

// ---------------------------------------------------------------------------
// Provider model registration
// ---------------------------------------------------------------------------

export interface DiscoveredModel {
  maxTokens?: number;
  maxOutputTokens?: number;
  supportsImages?: boolean;
  isInternal?: boolean;
}

/** Build the provider catalog; a discovered inventory drops unavailable models and effort variants. */
export function providerModels(available?: Record<string, DiscoveredModel>): Model.Info[] {
  const usable = (wireId: string) => !available || (available[wireId] !== undefined && !available[wireId].isInternal);
  return Object.entries(MODEL_SPECS).flatMap(([id, spec]) => {
    if (id === "gemini-2.5-pro") return []; // OMP excludes this deployment from discovery.
    const wireId = resolveWireModelId(spec, { effort: "off", requested: false }, id);
    // The default route must work even when no reasoning variant is selected.
    if (!usable(wireId)) return [];
    const discovered = available?.[wireId];
    const imageInput = discovered?.supportsImages ?? spec.imageInput;
    const variants = spec.reasoning
      ? EFFORT_ORDER.flatMap((effort) => {
          if (!usable(resolveWireModelId(spec, { effort, requested: true }, id))) return [];
          const clamped = clampEffort(spec, effort);
          const thinkingConfig =
            spec.transport === "level"
              ? { includeThoughts: true, thinkingLevel: clamped }
              : { includeThoughts: true, thinkingBudget: spec.budgets?.[clamped] ?? DEFAULT_EFFORT_BUDGETS[clamped] };
          return [{ id: Model.VariantID.make(effort), settings: { thinkingConfig } }];
        })
      : [];
    return [{
      id: Model.ID.make(id),
      modelID: Model.ID.make(id),
      providerID: PROVIDER_ID,
      name: spec.name,
      capabilities: { tools: true, input: imageInput ? ["text", "image"] : ["text"], output: ["text"] },
      variants,
      time: { released: 0 },
      cost: [],
      status: "active" as const,
      enabled: true,
      limit: { context: discovered?.maxTokens ?? spec.contextWindow, output: discovered?.maxOutputTokens ?? spec.outputLimit },
    }];
  });
}

// ---------------------------------------------------------------------------
// Session state & request envelope
// ---------------------------------------------------------------------------

const INT63_MASK = (1n << 63n) - 1n;
const RANDOM_BOUND = 9_000_000_000_000_000_000n;

/** Signed-decimal session id in the native client's format: `-<int63 digits>`. */
export function randomSignedDecimalSessionId(): string {
  let value: bigint;
  do {
    value = BigInt.asIntN(64, BigInt(`0x${crypto.randomUUID().replace(/-/g, "")}`)) & INT63_MASK;
  } while (value >= RANDOM_BOUND);
  return `-${value}`;
}

export interface AntigravitySessionState {
  agentId: string;
  trajectoryId: string;
  sessionId: string;
  stepIndex: number;
  lastExecutionId?: string;
  /** Auto endpoint mode: where this session's next request goes (daily when unset). */
  endpoint?: string;
  /** Last model.request invocation id seen; identical ids reuse the envelope so retries do not advance steps. */
  lastInvocationId?: string;
  lastEnvelope?: { requestId: string; step: number; labels: Record<string, string> };
}

export function createSessionState(): AntigravitySessionState {
  return {
    agentId: crypto.randomUUID(),
    trajectoryId: crypto.randomUUID(),
    sessionId: randomSignedDecimalSessionId(),
    stepIndex: 1,
  };
}

/**
 * Advance (or reuse) the per-conversation envelope. Mirrors the native
 * client: `requestId` is `agent/<agentId>/<ts>/<trajectoryId>/<step>` and
 * `labels.last_step_index` trails the requestId step by one. When the same
 * invocation id is presented again (a retry of the prepared request),
 * the previous envelope is returned unchanged.
 */
export function advanceEnvelope(
  state: AntigravitySessionState,
  wireModelId: string,
  invocationId: string | undefined,
  isClaude: boolean,
): { sessionId: string; requestId: string; step: number; labels: Record<string, string> } {
  if (invocationId && invocationId === state.lastInvocationId && state.lastEnvelope) {
    return { sessionId: state.sessionId, ...state.lastEnvelope };
  }

  state.stepIndex += 1;
  const step = state.stepIndex;
  const profile = ANTIGRAVITY_MODEL_WIRE_PROFILES[wireModelId];
  const labels: Record<string, string> = {};
  if (state.lastExecutionId) labels["last_execution_id"] = state.lastExecutionId;
  labels["last_step_index"] = String(step - 1);
  if (profile?.modelEnum !== undefined) labels["model_enum"] = profile.modelEnum;
  labels["trajectory_id"] = state.trajectoryId;
  labels["used_claude"] = String(isClaude);
  labels["used_claude_conservative"] = String(isClaude);
  const envelope = { requestId: `agent/${state.agentId}/${Date.now()}/${state.trajectoryId}/${step}`, step, labels };

  state.lastInvocationId = invocationId;
  state.lastEnvelope = envelope;
  return { sessionId: state.sessionId, ...envelope };
}

// ---------------------------------------------------------------------------
// Tool schema normalization (CCA subset)
// ---------------------------------------------------------------------------

export { normalizeSchemaForCCA };

// ---------------------------------------------------------------------------
// Request body rewrite
// ---------------------------------------------------------------------------

export interface BodyRewriteOptions {
  /** Native Gemini generateContent body sent by OpenCode's Google client. */
  args: Record<string, any>;
  /** Logical OpenCode model id (registry key). */
  logicalModelId: string;
  projectId: string;
  state: AntigravitySessionState;
  /** Per-invocation id from the model.request hook; retries present the same id. */
  invocationId?: string;
}

export interface BodyRewriteResult {
  body: string;
  wireModelId: string;
}

/**
 * Wrap a standard Gemini generateContent payload in the Antigravity
 * Cloud Code Assist envelope: effort-routed wire model, VALIDATED function
 * calling (forced for Claude), role-tagged systemInstruction, wire-profile
 * maxOutputTokens/model_enum, session labels, and the signed-decimal session
 * id. Mirrors OMP's buildRequest for google-antigravity.
 */
export function rewriteBodyForAntigravity(options: BodyRewriteOptions): BodyRewriteResult {
  const { args, logicalModelId, projectId, state, invocationId } = options;
  const spec = MODEL_SPECS[logicalModelId];
  if (!spec) throw new Error(`Unknown google-antigravity model "${logicalModelId}"`);
  const generationConfig: Record<string, any> = { ...(args.generationConfig ?? {}) };

  // Route the effort to its upstream wire id.
  const requested = readRequestedEffort(spec, generationConfig.thinkingConfig);
  const wireModelId = resolveWireModelId(spec, requested, logicalModelId);

  // Thinking rewrite: normalize to exactly the family's transport. Explicit
  // suppression when genuinely off (omitting thinkingConfig re-applies the
  // baked server default); unmatched custom controls pass through untouched.
  const incomingThinking = generationConfig.thinkingConfig as Record<string, unknown> | undefined;
  if (requested.unmatched) {
    // Keep the caller's custom control verbatim.
  } else if (requested.requested && requested.effort !== "off") {
    generationConfig.thinkingConfig = nativeThinkingControl(
      spec,
      incomingThinking?.includeThoughts !== false,
      requested.effort as Effort,
    );
  } else if (!spec.suppressWhenOff) {
    delete generationConfig.thinkingConfig;
  } else {
    generationConfig.thinkingConfig =
      spec.transport === "level"
        ? { includeThoughts: false, thinkingLevel: "MINIMAL" }
        : { includeThoughts: false, thinkingBudget: 0 };
  }

  // The real client sends a fixed per-model output cap independent of the
  // thinking budget.
  const profile = ANTIGRAVITY_MODEL_WIRE_PROFILES[wireModelId];
  if (profile) generationConfig.maxOutputTokens = profile.maxOutputTokens;

  const request: Record<string, any> = {
    contents: normalizeContentsForAntigravity(args.contents, logicalModelId),
    ...(args.systemInstruction
      ? {
          // Antigravity tags system instructions with role "user".
          systemInstruction: { role: "user", ...stripEmptyRole(args.systemInstruction) },
        }
      : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };

  const isClaude = isClaudeModel(logicalModelId);
  const tools = Array.isArray(args.tools) ? normalizeTools(args.tools) : undefined;
  if (tools) request["tools"] = tools;

  // Antigravity's default tool mode is VALIDATED; Claude forces it even with
  // no tools declared. An explicit non-AUTO tool choice wins otherwise.
  if (isClaude) {
    request["toolConfig"] = { functionCallingConfig: { mode: "VALIDATED" } };
  } else if (tools) {
    const sdkMode = args.toolConfig?.functionCallingConfig?.mode;
    request["toolConfig"] =
      sdkMode && sdkMode !== "AUTO" ? args.toolConfig : { functionCallingConfig: { mode: "VALIDATED" } };
  }

  const envelope = advanceEnvelope(state, wireModelId, invocationId, isClaude);
  request["labels"] = envelope.labels;
  request["sessionId"] = envelope.sessionId;

  return {
    wireModelId,
    body: JSON.stringify({
      project: projectId,
      requestId: envelope.requestId,
      request,
      model: wireModelId,
      userAgent: "antigravity",
      requestType: "agent",
    }),
  };
}

function normalizeContentsForAntigravity(contents: Record<string, any>[], logicalModelId: string): Record<string, any>[] {
  const claude = isClaudeModel(logicalModelId);
  const gemini3 = logicalModelId.startsWith("gemini-3");
  if (!claude && !gemini3) return contents;

  return contents.flatMap((content: Record<string, any>) => {
    if (content.role !== "model") return [content];
    let firstFunctionCall = true;
    const parts = content.parts.flatMap((part: Record<string, any>) => {
      if (claude && part.thought === true && !part.thoughtSignature) return [];
      if (!gemini3 || !part.functionCall) return [part];

      const normalized = { ...part };
      if (firstFunctionCall) {
        if (!normalized.thoughtSignature) normalized.thoughtSignature = SKIP_THOUGHT_SIGNATURE;
        firstFunctionCall = false;
      } else if (!normalized.thoughtSignature || normalized.thoughtSignature === SKIP_THOUGHT_SIGNATURE) {
        delete normalized.thoughtSignature;
      }
      return [normalized];
    });
    return parts.length > 0 ? [{ ...content, parts }] : [];
  });
}

function stripEmptyRole(systemInstruction: Record<string, any>): Record<string, any> {
  const { role: _role, ...rest } = systemInstruction;
  return rest;
}

/**
 * Normalize tool declarations for Cloud Code Assist exactly like OMP's
 * `normalizeAntigravityTools`: normalize both legacy `parameters` and the
 * `parametersJsonSchema` field emitted by OpenCode's Gemini client, then emit only
 * the CCA `parameters` form.
 */
function normalizeTools(tools: Array<Record<string, any>>): Array<Record<string, any>> {
  return tools.map((tool) => ({
    ...tool,
    functionDeclarations: (tool.functionDeclarations ?? []).map((declaration: Record<string, any>) => {
      const { parameters, parametersJsonSchema, ...rest } = declaration;
      const schema = Object.hasOwn(declaration, "parameters") ? parameters : parametersJsonSchema;
      return { ...rest, parameters: normalizeToolSchemaForCCA(schema) };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Response unwrapping
// ---------------------------------------------------------------------------

/** Unwrap a non-stream Cloud Code Assist response (`response` wrapper). */
export function unwrapCcaJson(payload: Record<string, any>): Record<string, any> {
  const inner = payload["response"];
  return inner && typeof inner === "object" ? (inner as Record<string, any>) : payload;
}

/** Copy response headers for rewritten bodies, dropping stale entity headers. */
export function unwrappedResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of response.headers.entries()) {
    const lower = name.toLowerCase();
    if (lower === "content-length" || lower === "content-encoding" || lower === "transfer-encoding") continue;
    headers.set(name, value);
  }
  return headers;
}

export interface SseUnwrapHooks {
  /** Called once when the stream carries an in-band error event. */
  onError?: (error: InBandError) => void;
  /** Called after the stream reaches a candidate finish reason, with the last responseId. */
  onComplete?: (lastResponseId: string | undefined) => void;
}

interface InBandError {
  code?: number;
  message?: string;
  status?: string;
}

export function readInBandError(payload: unknown): InBandError | undefined {
  const record = payload as Record<string, any>;
  if (record?.response !== undefined) return undefined;
  const error = record?.error;
  if (error === undefined || error === null || typeof error !== "object") return undefined;
  return {
    code: typeof error.code === "number" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
    status: typeof error.status === "string" ? error.status : undefined,
  };
}

/** Sanitized one-line description of an in-band error (never raw bodies). */
export function describeInBandError(error: InBandError): string {
  const detail = error.message || error.status || (typeof error.code === "number" ? String(error.code) : "unknown error");
  return `Cloud Code Assist error (${error.status ?? error.code ?? "unknown"}): ${detail}`;
}

/**
 * Incrementally unwrap Cloud Code Assist SSE events (standard Gemini chunks
 * nested under `response`) without buffering the stream. SSE framing is
 * preserved line-by-line; an in-band top-level error event errors the stream
 * with a sanitized Error (no raw bodies or credentials).
 */
export function createCcaSseUnwrap(hooks: SseUnwrapHooks = {}): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let lastResponseId: string | undefined;
  let sawFinishReason = false;

  const handleData = (payload: string, controller: TransformStreamDefaultController<Uint8Array>): boolean => {
    if (payload === "[DONE]") {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      return true;
    }
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(payload);
    } catch {
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`)); // not ours to interpret
      return true;
    }
    const inBand = readInBandError(parsed);
    if (inBand && parsed.response === undefined) {
      hooks.onError?.(inBand);
      // Surface the failure instead of ending as a silent empty stream.
      controller.error(new Error(describeInBandError(inBand)));
      return false;
    }
    if (parsed.response !== undefined && typeof parsed.response === "object") {
      const responseId = parsed.response.responseId;
      if (typeof responseId === "string" && responseId.length > 0) lastResponseId = responseId;
      if (
        Array.isArray(parsed.response.candidates) &&
        parsed.response.candidates.some((candidate: Record<string, any>) => candidate.finishReason)
      ) {
        sawFinishReason = true;
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed.response)}\n\n`));
      return true;
    }
    controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    return true;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("data:")) {
          controller.enqueue(encoder.encode(`${line}\n`));
          continue;
        }
        if (!handleData(line.slice(5).trim(), controller)) return;
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        const line = buffer.replace(/\r$/, "");
        buffer = "";
        if (!line.startsWith("data:")) {
          controller.enqueue(encoder.encode(`${line}\n`));
        } else if (!handleData(line.slice(5).trim(), controller)) {
          return;
        }
      }
      if (sawFinishReason) hooks.onComplete?.(lastResponseId);
    },
  });
}
