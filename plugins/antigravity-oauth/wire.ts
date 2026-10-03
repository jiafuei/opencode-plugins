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

/** Title requests use this checkpoint model. */
const CHECKPOINT_MODEL = "gemini-3.1-flash-lite";

/** The native client's compaction prompt, sent as the last user turn of a native compaction. */
export const COMPACTION_PROMPT = `You have been working on the task described above but have not yet completed
it. Write a continuation summary that will allow you (or another instance of
yourself) to resume work efficiently in a future context window where the
full conversation history will NOT be available—only this summary.

This summary is all that will be available to you going forward in the future
context window. Do not call any tools, simply just provide the summary based on
the information available in the current context window.

Your summary must be structured, concise, and actionable. Optimize for enabling immediate resumption with zero redundant work.

Include the following sections:

1. **Task Overview**
   - The user's core request and success criteria
   - Constraints, preferences, or scope boundaries they specified
   - Any ambiguities that were resolved (and how)

2. **Progress**
   - What has been completed, with concrete references (file paths,
     resource identifiers, tool outputs, URLs, etc.)
   - Key artifacts produced and their current state
   - What is in progress but incomplete, and its current state

3. **Key Findings**
   - Technical constraints, requirements, or domain details uncovered
   - Decisions made and their rationale
   - Errors encountered and their resolutions
   - Approaches that were tried and abandoned (and why—this prevents
     the successor from repeating them)

4. **Active Context**
   - State of any external resources, sessions, or environments in use
   - Relevant intermediate results, hypotheses, or working assumptions
   - Dependencies between components or steps

5. **Next Steps**
   - Specific actions needed to complete the task, in priority order
   - Known blockers or open questions that must be resolved
   - For each step, note any prerequisites or risks

6. **Commitments & Constraints**
   - Promises made to the user (e.g., "I said I would do X before Y")
   - User preferences or style requirements
   - Any boundaries the user set on approach, tools, or scope

Be concise but complete—err on the side of including anything that would
prevent duplicate work, repeated mistakes, or broken promises. Do not include
information that is obvious from the task description itself.

Wrap your response in <summary></summary> tags.
`;

/** Opens the native post-compaction message, which (like the summary prompt) is sent as plain user text. */
export const COMPACTION_RESUME_HEADER = "# Resuming from a compaction";

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
  /** Latest annotated user turn, which identifies the execution across a compaction. */
  lastUserTurn?: string;
  /** Set by compaction: the next request rebases the turn count instead of starting an execution. */
  rebase?: boolean;
  /** Execution (user turn) in progress, and the one before it (`labels.last_execution_id`). */
  executionId?: string;
  lastExecutionId?: string;
  usedClaude: boolean;
  usedNonGemini: boolean;
  /** `writeTrajectoryAcls` precedes the trajectory's first agent request. */
  aclWritten: boolean;
  /** Auto endpoint mode: where this session's next request goes (daily when unset). */
  endpoint?: string;
  /** Wire model that produced each response signature. */
  signatureModels: Map<string, string>;
  /** When each tool call arrived and its result was first sent. */
  callTimes: Map<string, { created: number; completed?: number }>;
  /** Each user turn's native metadata block, fixed when the turn is first sent. */
  turnMetadata: Map<string, string>;
  /** Display name of the model the latest new user turn went to (`None` before the first). */
  modelName: string;
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
    signatureModels: new Map(),
    callTimes: new Map(),
    turnMetadata: new Map(),
    modelName: "None",
  };
}

/** RFC 3339 local time with offset, like the native client's metadata: `2026-10-03T18:37:29+08:00`. */
function localTimestamp(ms: number): string {
  const offset = -new Date(ms).getTimezoneOffset();
  const local = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  if (offset === 0) return `${local}Z`;
  const abs = Math.abs(offset);
  return `${local}${offset > 0 ? "+" : "-"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
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

  // Compaction shrinks the history but, like the native client, keeps the
  // execution going unless the latest user turn changed.
  const lastUserTurn = contents.findLast((content) => content.parts[0]?.text?.startsWith("<USER_REQUEST>"))?.parts[0].text;
  if (state.rebase ? lastUserTurn !== state.lastUserTurn : userTurns !== state.userTurns) {
    state.lastExecutionId = state.executionId;
    state.executionId = crypto.randomUUID();
  }
  state.userTurns = userTurns;
  state.lastUserTurn = lastUserTurn;
  state.rebase = false;
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
  /** Trajectory state of this request kind. */
  state: AntigravitySessionState;
  /** The conversation's state: session id and history annotations (the primary state for title and compaction). */
  history: AntigravitySessionState;
  /** Title and compaction requests go out as native checkpoints; everything else as agent requests. */
  kind: "agent" | "title" | "compaction";
}

/**
 * Wrap a standard Gemini generateContent payload in the Antigravity Cloud
 * Code Assist envelope, in the native client's key order. Agent requests get
 * the catalog's output cap and thinking config, VALIDATED function calling,
 * native user turns and tool results, session labels, and session id.
 * Checkpoint calls leave the trajectory untouched: titles use the native
 * title model, compaction the current model with its tools disabled.
 */
export function rewriteBodyForAntigravity(options: BodyRewriteOptions): Record<string, any> {
  const { args, logicalModelId, wireModelId, model, projectId, state, history, kind } = options;
  // The native system prompt is one text part.
  const systemInstruction = args.systemInstruction && {
    role: "user",
    parts: [{ text: args.systemInstruction.parts.map((part: Record<string, any>) => part.text).join("\n") }],
  };

  if (kind === "title") {
    return {
      project: projectId,
      requestId: `checkpoint/${crypto.randomUUID()}`,
      request: {
        contents: normalizeContentsForAntigravity(args.contents, CHECKPOINT_MODEL, false),
        ...(systemInstruction ? { systemInstruction } : {}),
        generationConfig: { maxOutputTokens: 16384, thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
        sessionId: history.sessionId,
      },
      model: CHECKPOINT_MODEL,
      userAgent: "antigravity",
      requestType: "checkpoint",
    };
  }

  const claude = model.apiProvider === ANTHROPIC;
  // A compaction request ends with its summary prompt, which stays plain user text.
  const end =
    kind === "compaction"
      ? args.contents.findLastIndex(
          (content: Record<string, any>) =>
            content.role === "model" || content.parts.some((part: Record<string, any>) => part.functionResponse),
        ) + 1
      : args.contents.length;
  const contents = [
    ...normalizeContentsForAntigravity(args.contents.slice(0, end), logicalModelId, claude, {
      state: history,
      wireModelId,
      modelName: model.displayName ?? wireModelId,
    }),
    ...args.contents.slice(end),
  ];
  const request: Record<string, any> = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(args.tools ? { tools: normalizeTools(args.tools) } : {}),
  };
  // Only the catalog's thinking config; OpenCode's sampling settings are not
  // part of the native request.
  const thinkingConfig = claude
    ? { includeThoughts: true, thinkingBudget: 0, thinkingLevel: THINKING_LEVELS[model.thinkingLevel!] }
    : model.thinkingBudget !== undefined
      ? { includeThoughts: true, thinkingBudget: model.thinkingBudget }
      : undefined;

  if (kind === "compaction") {
    request["toolConfig"] = { functionCallingConfig: { mode: "NONE" } };
    request["generationConfig"] = { maxOutputTokens: 16384, ...(thinkingConfig ? { thinkingConfig } : {}) };
    request["sessionId"] = history.sessionId;
    return {
      project: projectId,
      requestId: `checkpoint/${crypto.randomUUID()}`,
      request,
      model: wireModelId,
      userAgent: "antigravity",
      requestType: "checkpoint",
    };
  }

  // VALIDATED like the native client, except NONE (OpenCode's step limit)
  // for Claude. Live-tested 2026-10-04: CCA ignores NONE and ANY on Gemini,
  // GPT-OSS leaks harmony tokens under NONE, and Claude 400s on ANY.
  const none = claude && args.toolConfig?.functionCallingConfig?.mode === "NONE";
  request["toolConfig"] = { functionCallingConfig: { mode: none ? "NONE" : "VALIDATED" } };

  const envelope = advanceEnvelope(state, contents, model);
  request["labels"] = envelope.labels;
  request["generationConfig"] = { maxOutputTokens: model.maxOutputTokens, ...(thinkingConfig ? { thinkingConfig } : {}) };
  request["sessionId"] = history.sessionId;

  return {
    project: projectId,
    requestId: envelope.requestId,
    request,
    model: wireModelId,
    userAgent: "antigravity",
    requestType: "agent",
  };
}

const SETTINGS_CHANGE_NOTE =
  "No need to comment on this change if the user doesn't ask about it. If reporting what model you are, please use a human readable name instead of the exact string.";

/**
 * Agent requests also annotate history like the native client: user turns
 * get the `<USER_REQUEST>` / `<ADDITIONAL_METADATA>` wrapper (plus a
 * `<USER_SETTINGS_CHANGE>` note on the first turn after a model switch) and
 * tool results get `Created At` / `Completed At` lines. Both are fixed the
 * first time they are sent, so replays stay byte-identical.
 */
function normalizeContentsForAntigravity(
  contents: Record<string, any>[],
  logicalModelId: string,
  claude: boolean,
  agent?: { state: AntigravitySessionState; wireModelId: string; modelName: string },
): Record<string, any>[] {
  const gemini3 = logicalModelId.startsWith("gemini-3");
  const now = Date.now();
  const occurrences = new Map<string, number>();
  // Gemini 3 validates signatures only on calls after the latest user turn.
  const turnStart = contents.findLastIndex(
    (content) => content.role === "user" && !content.parts.some((part: Record<string, any>) => part.functionResponse),
  );

  return contents.flatMap((content: Record<string, any>, index) => {
    if (content.parts.some((part: Record<string, any>) => part.functionResponse)) {
      // Native tool results wrap the result text as `output`; only Anthropic
      // models receive them as the user role.
      return [{
        role: claude ? "user" : "model",
        parts: content.parts.map((part: Record<string, any>) => {
          if (!part.functionResponse) return part;
          let output = part.functionResponse.response.content;
          if (agent) {
            const times = agent.state.callTimes.get(part.functionResponse.id) ?? { created: now };
            times.completed ??= now;
            agent.state.callTimes.set(part.functionResponse.id, times);
            output = `Created At: ${localTimestamp(times.created)}\nCompleted At: ${localTimestamp(times.completed)}\n${output}`;
          }
          return { ...part, functionResponse: { ...part.functionResponse, response: { output } } };
        }),
      }];
    }
    if (content.role !== "model") {
      const texts = content.parts.filter((part: Record<string, any>) => part.text !== undefined);
      // Post-compaction summaries are plain user text, like the native resume message.
      if (
        !agent ||
        content.role !== "user" ||
        texts.length === 0 ||
        texts[0].text.startsWith(COMPACTION_RESUME_HEADER) ||
        texts[0].text.startsWith("<conversation-checkpoint>")
      ) {
        return [content];
      }
      const text = texts.map((part: Record<string, any>) => part.text).join("\n");
      // Repeated identical turns ("continue") each keep their own metadata.
      const occurrence = (occurrences.get(text) ?? 0) + 1;
      occurrences.set(text, occurrence);
      const key = `${occurrence}:${text}`;
      let metadata = agent.state.turnMetadata.get(key);
      if (metadata === undefined) {
        metadata = `<ADDITIONAL_METADATA>\nThe current local time is: ${localTimestamp(now)}.\n</ADDITIONAL_METADATA>`;
        if (agent.state.modelName !== agent.modelName) {
          metadata += `\n<USER_SETTINGS_CHANGE>\nThe user changed setting \`Model Selection\` from ${agent.state.modelName} to ${agent.modelName}. ${SETTINGS_CHANGE_NOTE}\n</USER_SETTINGS_CHANGE>`;
          agent.state.modelName = agent.modelName;
        }
        agent.state.turnMetadata.set(key, metadata);
      }
      return [{
        role: "user",
        parts: [
          { text: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n${metadata}` },
          ...content.parts.filter((part: Record<string, any>) => part.text === undefined),
        ],
      }];
    }

    // The native client drops thinking and signatures produced by another
    // Claude tier (Gemini tiers stay compatible; OpenCode already strips
    // signatures across model families).
    const foreign =
      claude &&
      agent &&
      content.parts.some(
        (part: Record<string, any>) =>
          part.thoughtSignature &&
          (agent.state.signatureModels.get(part.thoughtSignature) ?? agent.wireModelId) !== agent.wireModelId,
      );
    const source: Record<string, any>[] = foreign
      ? content.parts.map(({ thoughtSignature: _, ...part }: Record<string, any>) => part)
      : content.parts;

    // Native assistant replay: one joined thought part, one joined text part
    // (omitted when whitespace-only), then calls. The message signature moves
    // to the first non-thought part; call signatures stay on their calls.
    // Like the native client, thinking without a signature (from another
    // model) is dropped.
    const signed = source.some((part) => part.thoughtSignature && part.thoughtSignature !== SKIP_THOUGHT_SIGNATURE);
    const thoughts = signed ? source.filter((part) => part.thought === true) : [];
    const texts = source.filter((part) => part.thought !== true && part.text !== undefined);
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
    parts.push(...source.filter((part) => part.text === undefined).map((part) => ({ ...part })));
    const target = parts.find((part) => part.thought !== true) ?? parts[0];
    if (signature && target && (!target.thoughtSignature || target.thoughtSignature === SKIP_THOUGHT_SIGNATURE)) {
      target.thoughtSignature = signature;
    }

    // Native replays older unsigned calls bare; only the current turn needs the bypass.
    if (gemini3 && index > turnStart) {
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
 * Normalize tool declarations for Cloud Code Assist: normalize both legacy
 * `parameters` and the `parametersJsonSchema` field emitted by OpenCode's
 * Gemini client into the CCA `parameters` form. Like the native client, each
 * declaration gets its own Tool, sorted by function name.
 */
function normalizeTools(tools: Array<Record<string, any>>): Array<Record<string, any>> {
  return tools
    .flatMap((tool) => tool.functionDeclarations as Array<Record<string, any>>)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((declaration) => {
      const { parameters, parametersJsonSchema, ...rest } = declaration;
      const schema = Object.hasOwn(declaration, "parameters") ? parameters : parametersJsonSchema;
      return { functionDeclarations: [{ ...rest, parameters: normalizeToolSchemaForCCA(schema) }] };
    });
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
 * first. `onComplete` reports a stream that ended with a finish reason, and
 * `onChunk` sees each unwrapped Gemini chunk.
 */
export function createCcaSseUnwrap(
  onError?: (error: InBandError) => void,
  onComplete?: (completion: StreamCompletion) => void,
  onChunk?: (chunk: Record<string, any>) => void,
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
      onChunk?.(parsed.response);
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
