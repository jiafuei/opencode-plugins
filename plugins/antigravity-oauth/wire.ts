/**
 * Antigravity wire-format helpers.
 *
 * Everything in this file mirrors the native Antigravity IDE language server
 * against the Cloud Code Assist (`daily-cloudcode-pa`) endpoints: user agent,
 * agent model catalog, per-session request identity, request envelope
 * construction, tool schema normalization, and SSE response unwrapping.
 */

import { Model, Provider } from "@opencode/plugin";
import { normalizeSchemaForCCA, normalizeToolSchemaForCCA } from "./schema.ts";

export const PROVIDER_ID = Provider.ID.make("google-antigravity");

// ---------------------------------------------------------------------------
// Endpoints & client identity
// ---------------------------------------------------------------------------

export const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_ENDPOINTS = [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT] as const;

/** Native IDE client version; override with OPENCODE_ANTIGRAVITY_VERSION. */
export function getAntigravityVersion(): string {
  return process.env.OPENCODE_ANTIGRAVITY_VERSION || "2.5.5";
}

/**
 * User-Agent of the native IDE language server:
 * `antigravity/ide/2.5.5 (aidev_client; os_type=windows; arch=amd64)`.
 * Overrides: OPENCODE_ANTIGRAVITY_VERSION / _OS / _ARCH.
 */
export function getAntigravityUserAgent(): string {
  const os = process.env.OPENCODE_ANTIGRAVITY_OS || "windows";
  const arch = process.env.OPENCODE_ANTIGRAVITY_ARCH || "amd64";
  return `antigravity/ide/${getAntigravityVersion()} (aidev_client; os_type=${os}; arch=${arch})`;
}

/**
 * User-Agent of the IDE's Electron (Node) side, which runs login and account
 * provisioning: `antigravity/2.5.5 windows/amd64 google-api-nodejs-client/10.3.0`.
 */
export function getAntigravityNodeUserAgent(): string {
  const os = process.env.OPENCODE_ANTIGRAVITY_OS || "windows";
  const arch = process.env.OPENCODE_ANTIGRAVITY_ARCH || "amd64";
  return `antigravity/${getAntigravityVersion()} ${os}/${arch} google-api-nodejs-client/10.3.0`;
}

/** Metrics platform enum: `WINDOWS_AMD64`. */
export function getAntigravityPlatform(): string {
  const os = process.env.OPENCODE_ANTIGRAVITY_OS || "windows";
  const arch = process.env.OPENCODE_ANTIGRAVITY_ARCH || "amd64";
  return `${os}_${arch}`.toUpperCase();
}

/** Header set of the language server's Go HTTP client on Cloud Code Assist calls. */
export function antigravityHeaders(accessToken: string): Record<string, string> {
  return {
    "User-Agent": getAntigravityUserAgent(),
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Encoding": "gzip",
  };
}

/** CCA bypass accepted only when a Gemini 3 turn's first function call is unsigned. */
const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

/** Title and compaction requests use this checkpoint model. */
const CHECKPOINT_MODEL = "gemini-3.1-flash-lite";

// ---------------------------------------------------------------------------
// Agent model catalog
// ---------------------------------------------------------------------------

/** Carries the selected wire model id from the model/variant overlays to the HTTP hook. */
export const WIRE_MODEL_HEADER = "x-antigravity-wire-model";

/** The `fetchAvailableModels` entry fields the native client turns into request settings. */
export interface WireModel {
  displayName?: string;
  /** Opaque enum sent as `labels.model_enum`. */
  model?: string;
  apiProvider?: string;
  supportsImages?: boolean;
  thinkingBudget?: number;
  /** Anthropic thinking tier: 1/2/3 → LOW/MEDIUM/HIGH. */
  thinkingLevel?: number;
  maxTokens: number;
  maxOutputTokens: number;
}

export type WireCatalog = Record<string, WireModel>;

const ANTHROPIC = "API_PROVIDER_ANTHROPIC_VERTEX";
const GEMINI = "API_PROVIDER_GOOGLE_GEMINI";
const THINKING_LEVELS = ["UNSPECIFIED", "LOW", "MEDIUM", "HIGH"];
const TIERS = ["low", "medium", "high"];

/** The native agent model picker captured on 2026-10-03; used until live discovery succeeds. */
export const SNAPSHOT_CATALOG: WireCatalog = {
  "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)", model: "MODEL_PLACEHOLDER_M318", apiProvider: GEMINI, supportsImages: true, thinkingBudget: -1, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.8-flash-medium": { displayName: "Gemini 3.8 Flash (Medium)", model: "MODEL_PLACEHOLDER_M319", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 4000, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.8-flash-low": { displayName: "Gemini 3.8 Flash (Low)", model: "MODEL_PLACEHOLDER_M320", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 1000, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.7-flash-high": { displayName: "Gemini 3.7 Flash (High)", model: "MODEL_PLACEHOLDER_M298", apiProvider: GEMINI, supportsImages: true, thinkingBudget: -1, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.7-flash-medium": { displayName: "Gemini 3.7 Flash (Medium)", model: "MODEL_PLACEHOLDER_M299", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 4000, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.7-flash-low": { displayName: "Gemini 3.7 Flash (Low)", model: "MODEL_PLACEHOLDER_M300", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 1000, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.6-flash-high": { displayName: "Gemini 3.6 Flash (High)", model: "MODEL_PLACEHOLDER_M71", apiProvider: GEMINI, supportsImages: true, thinkingBudget: -1, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.6-flash-medium": { displayName: "Gemini 3.6 Flash (Medium)", model: "MODEL_PLACEHOLDER_M72", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 4000, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-3.6-flash-low": { displayName: "Gemini 3.6 Flash (Low)", model: "MODEL_PLACEHOLDER_M73", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 1000, maxTokens: 1048576, maxOutputTokens: 65536 },
  "gemini-pro-agent": { displayName: "Gemini 3.1 Pro (High)", model: "MODEL_PLACEHOLDER_M16", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 10001, maxTokens: 1048576, maxOutputTokens: 65535 },
  "gemini-3.1-pro-low": { displayName: "Gemini 3.1 Pro (Low)", model: "MODEL_PLACEHOLDER_M36", apiProvider: GEMINI, supportsImages: true, thinkingBudget: 1001, maxTokens: 1048576, maxOutputTokens: 65535 },
  "claude-opus-5-5-low": { displayName: "Claude Opus 5.5 (Low)", model: "MODEL_PLACEHOLDER_M400", apiProvider: ANTHROPIC, supportsImages: true, thinkingLevel: 1, maxTokens: 1000000, maxOutputTokens: 128000 },
  "claude-opus-5-5-medium": { displayName: "Claude Opus 5.5 (Medium)", model: "MODEL_PLACEHOLDER_M401", apiProvider: ANTHROPIC, supportsImages: true, thinkingLevel: 2, maxTokens: 1000000, maxOutputTokens: 128000 },
  "claude-opus-5-5-high": { displayName: "Claude Opus 5.5 (High)", model: "MODEL_PLACEHOLDER_M402", apiProvider: ANTHROPIC, supportsImages: true, thinkingLevel: 3, maxTokens: 1000000, maxOutputTokens: 128000 },
  "claude-sonnet-5-5-low": { displayName: "Claude Sonnet 5.5 (Low)", model: "MODEL_PLACEHOLDER_M403", apiProvider: ANTHROPIC, supportsImages: true, thinkingLevel: 1, maxTokens: 1000000, maxOutputTokens: 128000 },
  "claude-sonnet-5-5-medium": { displayName: "Claude Sonnet 5.5 (Medium)", model: "MODEL_PLACEHOLDER_M404", apiProvider: ANTHROPIC, supportsImages: true, thinkingLevel: 2, maxTokens: 1000000, maxOutputTokens: 128000 },
  "claude-sonnet-5-5-high": { displayName: "Claude Sonnet 5.5 (High)", model: "MODEL_PLACEHOLDER_M405", apiProvider: ANTHROPIC, supportsImages: true, thinkingLevel: 3, maxTokens: 1000000, maxOutputTokens: 128000 },
  "gpt-oss-120b-medium": { displayName: "GPT-OSS 120B (Medium)", model: "MODEL_OPENAI_GPT_OSS_120B_MEDIUM", apiProvider: "API_PROVIDER_OPENAI_VERTEX", thinkingBudget: 8192, maxTokens: 131072, maxOutputTokens: 32768 },
};

/**
 * One OpenCode model per tier family (`Claude Opus 5.5 (Low|Medium|High)`)
 * with one variant per tier; the highest tier is the default. Every overlay
 * names its wire id in WIRE_MODEL_HEADER.
 */
export function providerModels(catalog: WireCatalog = SNAPSHOT_CATALOG): Model.Info[] {
  const families = new Map<string, Array<{ wireId: string; tier?: string }>>();
  for (const [wireId, model] of Object.entries(catalog)) {
    const match = /^(.*) \((Low|Medium|High)\)$/.exec(model.displayName ?? "");
    const name = match?.[1] ?? model.displayName ?? wireId;
    families.set(name, [...(families.get(name) ?? []), { wireId, tier: match?.[2]?.toLowerCase() }]);
  }
  return [...families].map(([name, members]) => {
    members.sort((a, b) => TIERS.indexOf(a.tier!) - TIERS.indexOf(b.tier!));
    // `gemini-3.1-pro-low` + `gemini-pro-agent` → `gemini-3.1-pro`.
    const named = members.find((member) => member.wireId.endsWith(`-${member.tier}`));
    const id = Model.ID.make(named ? named.wireId.slice(0, -named.tier!.length - 1) : members[0]!.wireId);
    const fallback = members.at(-1)!.wireId;
    const model = catalog[fallback]!;
    return {
      id,
      modelID: id,
      providerID: PROVIDER_ID,
      name,
      headers: { [WIRE_MODEL_HEADER]: fallback },
      capabilities: { tools: true, input: model.supportsImages ? ["text", "image"] : ["text"], output: ["text"] },
      variants:
        members.length > 1
          ? members.map((member) => ({ id: Model.VariantID.make(member.tier!), headers: { [WIRE_MODEL_HEADER]: member.wireId } }))
          : [],
      time: { released: 0 },
      cost: [],
      status: "active" as const,
      enabled: true,
      limit: { context: model.maxTokens, output: model.maxOutputTokens },
    };
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
  /** Trajectory steps derived from the previous request's history. */
  historySteps: number;
  /** Steps hidden by history shrinking (compaction) so the step index never moves backwards. */
  stepOffset: number;
  userTurns: number;
  /** Execution (user turn) in progress, and the one before it (`labels.last_execution_id`). */
  executionId?: string;
  lastExecutionId?: string;
  usedClaude: boolean;
  usedNonGemini: boolean;
  /** `writeTrajectoryAcls` precedes the trajectory's first agent request. */
  aclWritten: boolean;
  /** Auto endpoint mode: where this session's next request goes (daily when unset). */
  endpoint?: string;
}

export function createSessionState(): AntigravitySessionState {
  return {
    agentId: crypto.randomUUID(),
    trajectoryId: crypto.randomUUID(),
    sessionId: randomSignedDecimalSessionId(),
    historySteps: 0,
    stepOffset: 0,
    userTurns: 0,
    usedClaude: false,
    usedNonGemini: false,
    aclWritten: false,
  };
}

/**
 * Request identity for one invocation, derived from its history so a retry
 * of the same request reproduces it. Mirrors the native trajectory step
 * count: one step per content, one per tool result, plus the checkpoint step
 * that follows the first reply; `labels.last_step_index` trails it by one. A
 * new user turn starts a new execution and labels carry the previous one.
 */
export function advanceEnvelope(
  state: AntigravitySessionState,
  contents: Array<Record<string, any>>,
  model: WireModel,
): { requestId: string; labels: Record<string, string> } {
  let steps = 1;
  let userTurns = 0;
  for (const content of contents) {
    const results = content.parts.filter((part: Record<string, any>) => part.functionResponse).length;
    steps += results || 1;
    if (!results && content.role === "user") userTurns++;
  }
  if (contents.some((content) => content.role === "model")) steps++;
  if (steps < state.historySteps) state.stepOffset += state.historySteps - steps;
  state.historySteps = steps;
  const step = steps + state.stepOffset;

  if (userTurns !== state.userTurns) {
    state.userTurns = userTurns;
    state.lastExecutionId = state.executionId;
    state.executionId = crypto.randomUUID();
  }
  state.usedClaude ||= model.apiProvider === ANTHROPIC;
  state.usedNonGemini ||= model.apiProvider !== GEMINI;

  const labels: Record<string, string> = {};
  if (state.lastExecutionId) labels["last_execution_id"] = state.lastExecutionId;
  labels["last_step_index"] = String(step - 1);
  if (model.model) labels["model_enum"] = model.model;
  labels["trajectory_id"] = state.trajectoryId;
  labels["used_claude"] = String(state.usedClaude);
  labels["used_claude_conservative"] = String(state.usedClaude);
  labels["used_non_gemini_model"] = String(state.usedNonGemini);
  return { requestId: `agent/${state.agentId}/${Date.now()}/${state.trajectoryId}/${step}`, labels };
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
  /** Logical OpenCode model id (tier family). */
  logicalModelId: string;
  wireModelId: string;
  model: WireModel;
  projectId: string;
  state: AntigravitySessionState;
  /** Route OpenCode title and compaction requests as checkpoint calls. */
  checkpoint: boolean;
}

/**
 * Wrap a standard Gemini generateContent payload in the Antigravity Cloud
 * Code Assist envelope, in the native client's key order. Agent requests get
 * the catalog's output cap and thinking config, VALIDATED function calling
 * (forced for Claude), native tool results, session labels, and session id.
 * Checkpoint calls use the native title model and leave the trajectory untouched.
 */
export function rewriteBodyForAntigravity(options: BodyRewriteOptions): Record<string, any> {
  const { args, logicalModelId, wireModelId, model, projectId, state, checkpoint } = options;
  // The native system prompt is one text part.
  const systemInstruction = args.systemInstruction && {
    role: "user",
    parts: [{ text: args.systemInstruction.parts.map((part: Record<string, any>) => part.text).join("\n") }],
  };

  if (checkpoint) {
    return {
      project: projectId,
      requestId: `checkpoint/${crypto.randomUUID()}`,
      request: {
        contents: normalizeContentsForAntigravity(args.contents, CHECKPOINT_MODEL, false),
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: { maxOutputTokens: 16384, thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
        sessionId: state.sessionId,
      },
      model: CHECKPOINT_MODEL,
      userAgent: "antigravity",
      requestType: "checkpoint",
    };
  }

  const claude = model.apiProvider === ANTHROPIC;
  const contents = normalizeContentsForAntigravity(args.contents, logicalModelId, claude);
  const request: Record<string, any> = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(args.tools ? { tools: normalizeTools(args.tools) } : {}),
  };

  // Antigravity's default tool mode is VALIDATED, forced for Claude. An
  // explicit non-AUTO tool choice wins otherwise.
  const sdkMode = args.toolConfig?.functionCallingConfig?.mode;
  request["toolConfig"] =
    !claude && sdkMode && sdkMode !== "AUTO" ? args.toolConfig : { functionCallingConfig: { mode: "VALIDATED" } };

  const envelope = advanceEnvelope(state, contents, model);
  request["labels"] = envelope.labels;
  // Only the catalog's output cap and thinking config; OpenCode's sampling
  // settings are not part of the native request.
  request["generationConfig"] = {
    maxOutputTokens: model.maxOutputTokens,
    ...(claude
      ? { thinkingConfig: { includeThoughts: true, thinkingBudget: 0, thinkingLevel: THINKING_LEVELS[model.thinkingLevel!] } }
      : model.thinkingBudget !== undefined
        ? { thinkingConfig: { includeThoughts: true, thinkingBudget: model.thinkingBudget } }
        : {}),
  };
  request["sessionId"] = state.sessionId;

  return {
    project: projectId,
    requestId: envelope.requestId,
    request,
    model: wireModelId,
    userAgent: "antigravity",
    requestType: "agent",
  };
}

function normalizeContentsForAntigravity(
  contents: Record<string, any>[],
  logicalModelId: string,
  claude: boolean,
): Record<string, any>[] {
  const gemini3 = logicalModelId.startsWith("gemini-3");

  return contents.flatMap((content: Record<string, any>) => {
    if (content.parts.some((part: Record<string, any>) => part.functionResponse)) {
      // Native tool results wrap the result text as `output`; only Anthropic
      // models receive them as the user role.
      return [{
        role: claude ? "user" : "model",
        parts: content.parts.map((part: Record<string, any>) =>
          part.functionResponse
            ? { ...part, functionResponse: { ...part.functionResponse, response: { output: part.functionResponse.response.content } } }
            : part,
        ),
      }];
    }
    if (content.role !== "model") return [content];

    // Native assistant replay: one joined thought part, one joined text part
    // (omitted when whitespace-only), then calls. The message signature moves
    // to the first non-thought part; call signatures stay on their calls.
    // Claude rejects thinking when the message has no signature to replay.
    const signed = content.parts.some(
      (part: Record<string, any>) => part.thoughtSignature && part.thoughtSignature !== SKIP_THOUGHT_SIGNATURE,
    );
    const thoughts = !claude || signed ? content.parts.filter((part: Record<string, any>) => part.thought === true) : [];
    const texts = content.parts.filter((part: Record<string, any>) => part.thought !== true && part.text !== undefined);
    const signature = [...thoughts, ...texts].find((part) => part.thoughtSignature)?.thoughtSignature;
    const parts: Record<string, any>[] = [];
    if (thoughts.length > 0) {
      parts.push({ text: thoughts.map((part: Record<string, any>) => part.text).join(""), thought: true });
    }
    // Like the native client, drop empty or trailing `<tool_code>` wrappers.
    const text = texts
      .map((part: Record<string, any>) => part.text)
      .join("")
      .replace(/<tool_code>(\s*)<\/tool_code>/g, "")
      .replace(/<tool_code>\s*$/, "");
    if (text.trim()) parts.push({ text });
    parts.push(...content.parts.filter((part: Record<string, any>) => part.text === undefined).map((part: Record<string, any>) => ({ ...part })));
    const target = parts.find((part) => part.thought !== true) ?? parts[0];
    if (signature && target && (!target.thoughtSignature || target.thoughtSignature === SKIP_THOUGHT_SIGNATURE)) {
      target.thoughtSignature = signature;
    }

    if (gemini3) {
      let firstFunctionCall = true;
      for (const part of parts) {
        if (!part.functionCall) continue;
        if (firstFunctionCall) {
          part.thoughtSignature ??= SKIP_THOUGHT_SIGNATURE;
          firstFunctionCall = false;
        } else if (!part.thoughtSignature || part.thoughtSignature === SKIP_THOUGHT_SIGNATURE) {
          delete part.thoughtSignature;
        }
      }
    }
    return parts.length > 0 ? [{ role: "model", parts }] : [];
  });
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

export interface StreamCompletion {
  /** Outer `traceId` of the stream's events. */
  traceId?: string;
  /** `performance.now()` when the first non-empty text or thought arrived; unset for call-only turns. */
  firstMessageAt?: number;
}

/**
 * Incrementally unwrap Cloud Code Assist SSE events (standard Gemini chunks
 * nested under `response`) without buffering the stream. SSE framing is
 * preserved line-by-line; an in-band top-level error event errors the stream
 * with a sanitized Error (no raw bodies or credentials); `onError` is called
 * first. `onComplete` reports a stream that ended with a finish reason.
 */
export function createCcaSseUnwrap(
  onError?: (error: InBandError) => void,
  onComplete?: (completion: StreamCompletion) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const completion: StreamCompletion = {};
  let finished = false;

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
      onError?.(inBand);
      // Surface the failure instead of ending as a silent empty stream.
      controller.error(new Error(describeInBandError(inBand)));
      return false;
    }
    if (parsed.response !== undefined && typeof parsed.response === "object") {
      completion.traceId ??= parsed.traceId;
      finished ||= parsed.response.candidates?.some((candidate: Record<string, any>) => candidate.finishReason) ?? false;
      if (
        completion.firstMessageAt === undefined &&
        parsed.response.candidates?.some((candidate: Record<string, any>) =>
          candidate.content?.parts?.some((part: Record<string, any>) => part.text),
        )
      ) {
        completion.firstMessageAt = performance.now();
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
        } else {
          if (!handleData(line.slice(5).trim(), controller)) return;
        }
      }
      if (finished) onComplete?.(completion);
    },
  });
}
