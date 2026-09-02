import { describe, expect, test } from "bun:test";
import {
  ANTIGRAVITY_MODEL_WIRE_PROFILES,
  DEFAULT_EFFORT_BUDGETS,
  MODEL_SPECS,
  advanceEnvelope,
  createCcaSseUnwrap,
  createSessionState,
  getAntigravityUserAgent,
  getAntigravityVersion,
  normalizeSchemaForCCA,
  parseAntigravityManifestVersion,
  providerModels,
  randomSignedDecimalSessionId,
  readFirstSseEvent,
  readRequestedEffort,
  resolveWireModelId,
  rewriteBodyForAntigravity,
  sanitizeOutgoingHeaders,
  unwrapCcaJson,
  unwrappedResponseHeaders,
} from "./wire.ts";

// ---------------------------------------------------------------------------
// User agent / version discovery
// ---------------------------------------------------------------------------

describe("antigravity user agent", () => {
  test("matches the native hub fingerprint format", () => {
    delete process.env.OPENCODE_ANTIGRAVITY_VERSION;
    process.env.OPENCODE_ANTIGRAVITY_VERSION = "9.9.9";
    expect(getAntigravityUserAgent()).toBe(
      "antigravity/hub/9.9.9 (aidev_client; os_type=darwin; arch=arm64; cl=963137146)",
    );
    process.env.OPENCODE_ANTIGRAVITY_CL = "123";
    process.env.OPENCODE_ANTIGRAVITY_OS = "linux";
    process.env.OPENCODE_ANTIGRAVITY_ARCH = "x64";
    expect(getAntigravityVersion()).toBe("9.9.9");
    expect(getAntigravityUserAgent()).toBe(
      "antigravity/hub/9.9.9 (aidev_client; os_type=linux; arch=x64; cl=123)",
    );
    delete process.env.OPENCODE_ANTIGRAVITY_CL;
    delete process.env.OPENCODE_ANTIGRAVITY_OS;
    delete process.env.OPENCODE_ANTIGRAVITY_ARCH;
    // Other suites instantiate the plugin in this process; keep discovery off.
    process.env.OPENCODE_ANTIGRAVITY_VERSION = "2.8.0";
  });

  test("manifest version parsing", () => {
    expect(parseAntigravityManifestVersion("version: 2.9.1\npath: x.yml")).toBe("2.9.1");
    expect(parseAntigravityManifestVersion('version: "3.0.0"')).toBe("3.0.0");
    expect(parseAntigravityManifestVersion("files: []")).toBeNull();
    expect(parseAntigravityManifestVersion("version: not-semver")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Session state & request envelope
// ---------------------------------------------------------------------------

describe("session state", () => {
  test("signed decimal session ids match the native format", () => {
    for (let i = 0; i < 50; i++) expect(randomSignedDecimalSessionId()).toMatch(/^-\d{1,19}$/);
  });

  test("envelope advances monotonically per conversation", () => {
    const state = createSessionState();
    const first = advanceEnvelope(state, "gemini-3.1-pro-low", undefined, false);
    const second = advanceEnvelope(state, "gemini-3.1-pro-low", undefined, false);
    expect(first.step).toBe(2);
    expect(second.step).toBe(3);
    for (const env of [first, second]) {
      expect(env.requestId).toMatch(new RegExp(`^agent/${state.agentId}/\\d+/${state.trajectoryId}/\\d+$`));
      expect(env.labels["trajectory_id"]).toBe(state.trajectoryId);
      expect(env.labels["last_step_index"]).toBe(String(env.step - 1));
      expect(env.labels["used_claude"]).toBe("false");
      // Wire profile enum rides along for known ids.
    }
    expect(first.labels["model_enum"]).toBe(ANTIGRAVITY_MODEL_WIRE_PROFILES["gemini-3.1-pro-low"]!.modelEnum);
  });

  test("identical invocation id reuses the envelope (SDK retries do not advance steps)", () => {
    const state = createSessionState();
    const first = advanceEnvelope(state, "claude-sonnet-4-6", "inv-1", true);
    const retry = advanceEnvelope(state, "claude-sonnet-4-6", "inv-1", true);
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.step).toBe(first.step);
    const next = advanceEnvelope(state, "claude-sonnet-4-6", "inv-2", true);
    expect(next.step).toBe(first.step + 1);
    expect(next.labels["used_claude"]).toBe("true");
  });

  test("prior response id is echoed as last_execution_id", () => {
    const state = createSessionState();
    advanceEnvelope(state, "gpt-oss-120b-medium", undefined, false);
    state.lastExecutionId = "resp-abc";
    const next = advanceEnvelope(state, "gpt-oss-120b-medium", undefined, false);
    expect(next.labels["last_execution_id"]).toBe("resp-abc");
  });
});

// ---------------------------------------------------------------------------
// Effort routing
// ---------------------------------------------------------------------------

function effortOf(specKey: string, thinkingConfig?: Record<string, unknown>) {
  return readRequestedEffort(MODEL_SPECS[specKey]!, thinkingConfig);
}

describe("wire model routing", () => {
  test("budget family tiers route to captured wire ids", () => {
    expect(resolveWireModelId(MODEL_SPECS["gemini-3.1-pro"]!, { effort: "off", requested: true }, "gemini-3.1-pro")).toBe("gemini-3.1-pro-low");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3.1-pro"]!, { effort: "low", requested: true }, "gemini-3.1-pro")).toBe("gemini-3.1-pro-low");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3.1-pro"]!, { effort: "high", requested: true }, "gemini-3.1-pro")).toBe("gemini-pro-agent");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3-flash"]!, { effort: "medium", requested: true }, "gemini-3-flash")).toBe("gemini-3.5-flash-low");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3-flash"]!, { effort: "high", requested: true }, "gemini-3-flash")).toBe("gemini-3-flash-agent");
  });

  test("thinking pairs route off to the bare id and efforts to -thinking", () => {
    const spec = MODEL_SPECS["claude-opus-4-5"]!;
    expect(resolveWireModelId(spec, { effort: "off", requested: true }, "claude-opus-4-5")).toBe("claude-opus-4-5");
    expect(resolveWireModelId(spec, { effort: "minimal", requested: true }, "claude-opus-4-5")).toBe("claude-opus-4-5-thinking");
    expect(resolveWireModelId(spec, { effort: "high", requested: true }, "claude-opus-4-5")).toBe("claude-opus-4-5-thinking");
  });

  test("asymmetric and constant wire ids fall back correctly", () => {
    expect(resolveWireModelId(MODEL_SPECS["claude-sonnet-4-6"]!, { effort: "low", requested: true }, "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(resolveWireModelId(MODEL_SPECS["gpt-oss-120b"]!, { effort: "medium", requested: true }, "gpt-oss-120b")).toBe("gpt-oss-120b-medium");
    expect(resolveWireModelId(MODEL_SPECS["gemini-2.5-pro"]!, { effort: "off", requested: true }, "gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });

  test("mandatory-reasoning families clamp off to the lowest supported effort", () => {
    expect(resolveWireModelId(MODEL_SPECS["gemini-3.6-flash"]!, { effort: "off", requested: true }, "gemini-3.6-flash")).toBe("gemini-3.6-flash-low");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3.7-flash"]!, { effort: "high", requested: true }, "gemini-3.7-flash")).toBe("gemini-3.7-flash-high");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3.8-flash"]!, { effort: "medium", requested: true }, "gemini-3.8-flash")).toBe("gemini-3.8-flash-medium");
    expect(resolveWireModelId(MODEL_SPECS["gemini-3-pro"]!, { effort: "minimal", requested: true }, "gemini-3-pro")).toBe("gemini-3-pro-low");
  });

  test("effort detection from thinkingConfig", () => {
    expect(effortOf("gemini-3.1-pro", undefined)).toEqual({ effort: "off", requested: false });
    expect(effortOf("gemini-3.6-flash", { includeThoughts: true, thinkingLevel: "HIGH" })).toEqual({ effort: "high", requested: true });
    expect(effortOf("gemini-3.5-flash", { includeThoughts: true, thinkingBudget: 4000 })).toEqual({ effort: "medium", requested: true });
    // Unmatched custom budgets keep thinking alive but cannot pick a tier.
    expect(effortOf("claude-sonnet-4-6", { includeThoughts: true, thinkingBudget: 777 })).toEqual({
      effort: "off",
      requested: true,
      unmatched: true,
    });
    // Default budgets apply where families have none baked.
    expect(effortOf("gpt-oss-120b", { includeThoughts: true, thinkingBudget: DEFAULT_EFFORT_BUDGETS.medium })).toEqual({
      effort: "medium",
      requested: true,
    });
  });

  test("budget families accept OpenCode-style levels; level families ignore budgets", () => {
    // OpenCode derives thinkingLevel variants for Gemini 3 ids regardless of
    // transport; budget families map them onto the family's tiers.
    expect(effortOf("gemini-3.1-pro", { includeThoughts: true, thinkingLevel: "low" })).toEqual({ effort: "low", requested: true });
    expect(effortOf("gemini-3.5-flash", { includeThoughts: true, thinkingLevel: "medium" })).toEqual({ effort: "medium", requested: true });
    // Level families never invent a tier from a bare budget value.
    expect(effortOf("gemini-3.6-flash", { includeThoughts: true, thinkingBudget: 4096 })).toEqual({
      effort: "off",
      requested: true,
      unmatched: true,
    });
    // Bare includeThoughts defaults to the family's high control.
    expect(effortOf("gemini-3.1-pro", { includeThoughts: true })).toEqual({ effort: "high", requested: true });
    expect(effortOf("claude-opus-4-6", { includeThoughts: true })).toEqual({ effort: "high", requested: true });
    // Explicit off (no controls at all).
    expect(effortOf("claude-sonnet-4-6", { includeThoughts: false })).toEqual({ effort: "off", requested: true });
  });
});

// ---------------------------------------------------------------------------
// Body rewrite
// ---------------------------------------------------------------------------

function baseArgs(): Record<string, any> {
  return {
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    systemInstruction: { parts: [{ text: "system prompt" }] },
    generationConfig: {},
  };
}

function withThinking(thinkingConfig: Record<string, unknown>): Record<string, any> {
  const args = baseArgs();
  args.generationConfig.thinkingConfig = thinkingConfig;
  return args;
}

describe("body rewrite", () => {
  test("produces the Cloud Code Assist envelope", () => {
    const state = createSessionState();
    const args = baseArgs();
    args.generationConfig.thinkingConfig = { includeThoughts: true, thinkingLevel: "high" };
    args.tools = [{ functionDeclarations: [{ name: "t", parameters: { type: "object", properties: {} } }] }];
    const result = rewriteBodyForAntigravity({
      args,
      logicalModelId: "gemini-3.1-pro",
      projectId: "proj-1",
      state,
      invocationId: undefined,
    });
    expect(result.wireModelId).toBe("gemini-pro-agent");
    const body = JSON.parse(result.body);
    expect(body.project).toBe("proj-1");
    expect(body.model).toBe("gemini-pro-agent");
    expect(body.userAgent).toBe("antigravity");
    expect(body.requestType).toBe("agent");
    expect(body.requestId).toMatch(/^agent\//);
    expect(body.request.systemInstruction).toEqual({ role: "user", parts: [{ text: "system prompt" }] });
    expect(body.request.sessionId).toMatch(/^-\d+$/);
    expect(body.request.generationConfig.maxOutputTokens).toBe(65535);
    // Budget transport: the level input is normalized to the captured budget.
    expect(body.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 10001 });
    expect(body.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
    expect(body.request.labels.model_enum).toBe("MODEL_PLACEHOLDER_M16");
  });

  test("forces VALIDATED for Claude even with no tools", () => {
    const state = createSessionState();
    const result = rewriteBodyForAntigravity({
      args: { contents: [], generationConfig: {} },
      logicalModelId: "claude-sonnet-4-6",
      projectId: "p",
      state,
    });
    const body = JSON.parse(result.body);
    expect(result.wireModelId).toBe("claude-sonnet-4-6");
    expect(body.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
    expect(body.request.tools).toBeUndefined();
    expect(body.request.labels.used_claude).toBe("true");
  });

  test("keeps explicit non-AUTO SDK tool choices and defaults plain tools to VALIDATED", () => {
    const state = createSessionState();
    const forced = baseArgs();
    forced.tools = [{ functionDeclarations: [{ name: "t", parameters: { type: "object", properties: {} } }] }];
    forced.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["t"] } };
    const forcedBody = JSON.parse(
      rewriteBodyForAntigravity({ args: forced, logicalModelId: "gemini-3-flash", projectId: "p", state }).body,
    );
    expect(forcedBody.request.toolConfig.functionCallingConfig.mode).toBe("ANY");

    const plain = baseArgs();
    plain.tools = [{ functionDeclarations: [{ name: "t", parameters: { type: "object", properties: {} } }] }];
    const plainBody = JSON.parse(
      rewriteBodyForAntigravity({ args: plain, logicalModelId: "gemini-3-flash", projectId: "p", state }).body,
    );
    expect(plainBody.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
  });

  test("suppresses server-side thinking when off is required", () => {
    const state = createSessionState();
    const budgetBody = JSON.parse(
      rewriteBodyForAntigravity({ args: baseArgs(), logicalModelId: "gemini-3.5-flash", projectId: "p", state }).body,
    );
    expect(budgetBody.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: false, thinkingBudget: 0 });

    const levelBody = JSON.parse(
      rewriteBodyForAntigravity({ args: baseArgs(), logicalModelId: "gemini-3-pro", projectId: "p", state }).body,
    );
    expect(levelBody.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: false, thinkingLevel: "MINIMAL" });
  });

  test("unmatched custom thinking budgets are forwarded untouched", () => {
    const state = createSessionState();
    const args = baseArgs();
    args.generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: 777 };
    const body = JSON.parse(
      rewriteBodyForAntigravity({ args, logicalModelId: "gemini-3.5-flash", projectId: "p", state }).body,
    );
    expect(body.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 777 });
  });

  test("normalizes thinking to exactly the family transport at the wire boundary", () => {
    const state = createSessionState();

    // Default high on a budget model (bare includeThoughts).
    const defaultPro = JSON.parse(
      rewriteBodyForAntigravity({
        args: withThinking({ includeThoughts: true }),
        logicalModelId: "gemini-3.1-pro",
        projectId: "p",
        state,
      }).body,
    );
    expect(defaultPro.model).toBe("gemini-pro-agent");
    expect(defaultPro.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 10001 });

    // Claude default high uses the shared default budget.
    const claude = JSON.parse(
      rewriteBodyForAntigravity({
        args: withThinking({ includeThoughts: true }),
        logicalModelId: "claude-sonnet-4-6",
        projectId: "p",
        state,
      }).body,
    );
    expect(claude.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: DEFAULT_EFFORT_BUDGETS.high });

    // Merged level+budget input collapses to the single native control.
    const merged = JSON.parse(
      rewriteBodyForAntigravity({
        args: withThinking({ includeThoughts: true, thinkingLevel: "medium", thinkingBudget: 999_999 }),
        logicalModelId: "gemini-3-flash",
        projectId: "p",
        state,
      }).body,
    );
    expect(merged.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 4000 });

    // Level families emit uppercase levels only, dropping stray budgets.
    const levelCleanup = JSON.parse(
      rewriteBodyForAntigravity({
        args: withThinking({ includeThoughts: true, thinkingLevel: "low", thinkingBudget: 12_345 }),
        logicalModelId: "gemini-3.6-flash",
        projectId: "p",
        state,
      }).body,
    );
    expect(levelCleanup.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });

    // Explicit off still suppresses where required.
    const explicitOff = JSON.parse(
      rewriteBodyForAntigravity({
        args: withThinking({ includeThoughts: false }),
        logicalModelId: "gemini-3.5-flash",
        projectId: "p",
        state,
      }).body,
    );
    expect(explicitOff.request.generationConfig.thinkingConfig).toEqual({ includeThoughts: false, thinkingBudget: 0 });
  });

  test("converts @ai-sdk/google parametersJsonSchema declarations like OMP", () => {
    const state = createSessionState();
    const args = baseArgs();
    args.tools = [
      {
        functionDeclarations: [
          {
            name: "read_file",
            description: "Read a file",
            // Actual @ai-sdk/google 3.x shape (OpenAPI-style schema).
            parametersJsonSchema: {
              type: "object",
              properties: { path: { type: "string", pattern: "^/" }, extra: true },
              required: ["path"],
              additionalProperties: false,
            },
          },
          // Legacy `parameters` declarations pass through untouched.
          { name: "legacy", description: "", parameters: { type: "object", properties: {} } },
        ],
      },
    ];
    const body = JSON.parse(rewriteBodyForAntigravity({ args, logicalModelId: "claude-opus-4-6", projectId: "p", state }).body);
    const declarations = body.request.tools[0].functionDeclarations;
    expect(declarations[0].parametersJsonSchema).toBeUndefined();
    expect(declarations[0].parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" }, extra: {} },
      required: ["path"],
    });
    expect(declarations[1]).toEqual({ name: "legacy", description: "", parameters: { type: "object", properties: {} } });
  });

  test("strips SDK and OpenCode session-routing headers", () => {
    const headers = new Headers({
      "x-goog-api-key": "leaked",
      "x-goog-api-client": "ai-sdk/google/3.0.73",
      "client-metadata": "ideType=IDE_UNSPECIFIED",
      "x-session-affinity": "ses-1",
      "X-Session-Id": "ses-1",
      "x-parent-session-id": "parent-1",
      "content-type": "application/json",
    });
    sanitizeOutgoingHeaders(headers);
    for (const leaked of ["x-goog-api-key", "x-goog-api-client", "client-metadata", "x-session-affinity", "x-session-id", "x-parent-session-id"]) {
      expect(headers.get(leaked)).toBeNull();
    }
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("normalizes tool schemas for CCA", () => {
    const normalized = normalizeSchemaForCCA({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        value: { type: ["string", "null"], nullable: true, pattern: "^a", additionalProperties: false },
        mode: { oneOf: [{ type: "string", format: "uri" }, { type: "number", minimum: 1 }] },
        nested: {
          type: "object",
          propertyNames: { pattern: "x" },
          properties: { a: { const: "b" } },
        },
        flag: true,
        extra: { x_custom_vendor_extension: "ignored" },
      },
      required: ["nested"],
    }) as Record<string, any>;
    expect(normalized.type).toBe("object");
    // Nullable type arrays reduce to the non-null scalar; validators are stripped.
    expect(normalized.properties.value).toEqual({ type: "string" });
    // Mixed string|number union narrows to the first non-null type.
    expect(normalized.properties.mode).toEqual({ type: "string" });
    expect(normalized.properties.nested).toEqual({
      type: "object",
      properties: { a: { type: "string", enum: ["b"] } },
    });
    // Boolean subschemas coerce to open objects.
    expect(normalized.properties.flag).toEqual({});
    expect(normalized.properties.extra).toEqual({});
    expect(normalized.required).toEqual(["nested"]);
    assertNoForbiddenConstructs(normalized);
  });

  test("encodes numeric and boolean enums as strings for the CCA Schema proto", () => {
    expect(normalizeSchemaForCCA({ type: "integer", enum: [1, 2] })).toEqual({
      type: "integer",
      enum: ["1", "2"],
    });
    expect(normalizeSchemaForCCA({ type: "boolean", enum: [true, false] })).toEqual({
      type: "boolean",
      enum: ["true", "false"],
    });
  });

  test("encodes numeric enums at the request-rewrite boundary", () => {
    const state = createSessionState();
    const args = baseArgs();
    args.tools = [
      {
        functionDeclarations: [
          {
            name: "read_file",
            parametersJsonSchema: {
              type: "object",
              properties: { depth: { anyOf: [{ type: "integer", enum: [1, 2] }, { type: "null" }] } },
              required: ["depth"],
            },
          },
        ],
      },
    ];
    const result = rewriteBodyForAntigravity({ args, logicalModelId: "claude-opus-4-6", projectId: "p", state });
    const declaration = JSON.parse(result.body).request.tools[0].functionDeclarations[0];
    expect(declaration.parameters).toEqual({
      type: "object",
      properties: { depth: { type: "integer", enum: ["1", "2"] } },
      required: ["depth"],
    });
    expect(result.body).toContain('"enum":["1","2"]');
    expect(result.body).not.toContain('"anyOf"');
    expect(result.body).not.toContain('"oneOf"');
    expect(result.body).not.toContain('"allOf"');
  });
});

// ---------------------------------------------------------------------------
// CCA tool schema normalization regressions (ported from OMP)
// ---------------------------------------------------------------------------

/**
 * Recursively proves a normalized schema carries no forbidden combiners
 * (anyOf/oneOf/allOf), no negation/nullability, and no unsupported keys that
 * make CCA protojson reject the request. Literal `default` payloads are not
 * walked: they are opaque JSON, never interpreted as schemas.
 */
function assertNoForbiddenConstructs(schema: unknown): void {
  const forbidden = new Set([
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "nullable",
    "$ref",
    "$schema",
    "$defs",
    "$id",
    "$comment",
    "additionalProperties",
    "propertyNames",
    "prefixItems",
    "patternProperties",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "uniqueItems",
    "deprecated",
    "readOnly",
    "writeOnly",
    "x-mcp-header",
  ]);
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      expect(forbidden.has(key)).toBe(false);
      if (key !== "default") walk(value);
    }
  };
  walk(schema);
}

describe("CCA tool schema normalization", () => {
  test("collapses nullable unions by dropping the null branch", () => {
    expect(normalizeSchemaForCCA({ type: "string", nullable: true })).toEqual({ type: "string" });
    expect(normalizeSchemaForCCA({ anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({ type: "string" });
    expect(
      normalizeSchemaForCCA({ anyOf: [{ type: "string" }, { type: "null", description: "none" }] }),
    ).toEqual({ type: "string" });
    // Nullable unions become optional-ish but keep their non-null shape.
    expect(
      normalizeSchemaForCCA({
        type: "object",
        properties: { value: { anyOf: [{ enum: ["A", "B"] }, { type: "null" }] }, other: { type: "number" } },
        required: ["value", "other"],
      }),
    ).toEqual({
      type: "object",
      properties: { value: { type: "string", enum: ["A", "B"] }, other: { type: "number" } },
      required: ["value", "other"],
    });
  });

  test("narrows mixed array|string|null unions to the first non-null representable branch", () => {
    const normalized = normalizeSchemaForCCA({
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }, { type: "null" }],
    }) as Record<string, unknown>;
    // Lossy collapse: array|string|null narrows to array.
    expect(normalized).toEqual({ type: "array", items: { type: "string" } });
    assertNoForbiddenConstructs(normalized);
  });

  test("unions same-type enum branches losslessly", () => {
    expect(normalizeSchemaForCCA({ anyOf: [{ enum: ["A", "B"] }, { enum: ["C", "D"] }] })).toEqual({
      type: "string",
      enum: ["A", "B", "C", "D"],
    });
  });

  test("broadens a mixed enum/unconstrained same-type union without narrowing", () => {
    // The unconstrained string branch is broader than the enum branch; the
    // collapse must keep it and never narrow to the enum members.
    const normalized = normalizeSchemaForCCA({ anyOf: [{ enum: ["A"] }, { type: "string" }] }) as Record<
      string,
      unknown
    >;
    expect(normalized).toEqual({ type: "string" });
    expect(normalized).not.toHaveProperty("enum");
  });

  test("merges object unions with required intersection", () => {
    const normalized = normalizeSchemaForCCA({
      type: "object",
      properties: {
        profile: {
          anyOf: [
            { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] },
            { type: "object", properties: { id: { type: "string" }, age: { type: "number" } }, required: ["id", "age"] },
          ],
        },
      },
      required: ["profile"],
    }) as Record<string, any>;
    expect(normalized.properties.profile).toEqual({
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, age: { type: "number" } },
      required: ["id"],
    });
    assertNoForbiddenConstructs(normalized);
  });

  test("drops stale required keys after an object-union merge", () => {
    expect(
      normalizeSchemaForCCA({
        required: ["a"],
        anyOf: [
          { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
          { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
        ],
      }),
    ).toEqual({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } } });
  });

  test("merges object allOf by unioning required keys, never emitting a combiner", () => {
    const normalized = normalizeSchemaForCCA({
      allOf: [
        { type: "object", properties: { a: { type: "string" }, shared: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "number" }, shared: { type: "string" } }, required: ["b"] },
      ],
    }) as Record<string, any>;
    expect(normalized.type).toBe("object");
    expect(Object.keys(normalized.properties).sort()).toEqual(["a", "b", "shared"]);
    expect(normalized.required).toEqual(["a", "b"]);
    assertNoForbiddenConstructs(normalized);

    expect(
      normalizeSchemaForCCA({
        allOf: [
          { required: ["a"], propertyOrdering: ["a"] },
          { type: "object", properties: { a: { type: "string" } } },
        ],
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
      propertyOrdering: ["a"],
    });
  });

  test("fails the whole tool safely when allOf constraints conflict", () => {
    const fallback = { type: "object", properties: {} };
    expect(normalizeSchemaForCCA({ allOf: [{ type: "string" }, { type: "number" }] })).toEqual(fallback);
    expect(
      normalizeSchemaForCCA({
        allOf: [
          { type: "object", properties: { value: { type: "string" } } },
          { type: "object", properties: { value: { type: "number" } } },
        ],
      }),
    ).toEqual(fallback);
    expect(
      normalizeSchemaForCCA({
        allOf: [
          { type: "object", properties: { mode: { type: "string", enum: ["a", "b"] } } },
          { type: "object", properties: { mode: { type: "string", enum: ["b", "c"] } } },
        ],
      }),
    ).toEqual({ type: "object", properties: { mode: { type: "string", enum: ["b"] } } });
  });

  test("lets an unconstrained object branch absorb narrower object-union branches", () => {
    expect(
      normalizeSchemaForCCA({
        anyOf: [
          { type: "object", properties: {} },
          { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        ],
      }),
    ).toEqual({ type: "object", properties: {} });
  });

  test("inlines local $ref definitions including escaped pointer segments", () => {
    expect(
      normalizeSchemaForCCA({
        $ref: "#/$defs/Foo",
        $defs: { Foo: { type: "object", properties: { foo: { type: "string" } } } },
      }),
    ).toEqual({ type: "object", properties: { foo: { type: "string" } } });
    // RFC 6901 escapes: ~1 is "/", ~0 is "~".
    expect(
      normalizeSchemaForCCA({
        $ref: "#/$defs/a~1b",
        $defs: { "a/b": { type: "string", description: "slashed def" } },
      }),
    ).toEqual({ type: "string", description: "slashed def" });
  });

  test("breaks recursive $ref cycles by widening the recursion point", () => {
    expect(
      normalizeSchemaForCCA({
        type: "object",
        properties: { recursive: { $ref: "#/$defs/RecursiveObject" } },
        $defs: {
          RecursiveObject: { type: "object", properties: { self: { $ref: "#/$defs/RecursiveObject" } } },
        },
      }),
    ).toEqual({ type: "object", properties: { recursive: { type: "object", properties: { self: {} } } } });
  });

  test("widens external and unresolvable refs instead of failing", () => {
    expect(normalizeSchemaForCCA({ $ref: "https://example.com/schema.json" })).toEqual({});
    expect(
      normalizeSchemaForCCA({ $ref: "#/$defs/Missing", description: "kept sibling" }),
    ).toEqual({ description: "kept sibling" });
  });

  test("does not recurse infinitely on cyclic JS object graphs", () => {
    const circular: Record<string, unknown> = { type: "object", properties: {} };
    (circular.properties as Record<string, unknown>).self = circular;
    expect(normalizeSchemaForCCA(circular)).toEqual({ type: "object", properties: { self: {} } });
  });

  test("renames snake_case SDK/MCP keys and lets snake win collisions", () => {
    const normalized = normalizeSchemaForCCA({
      additional_properties: false,
      property_ordering: ["mode"],
      properties: { mode: { any_of: [{ type: "integer" }, { type: "number" }] } },
    }) as Record<string, any>;
    expect(normalized.additionalProperties).toBeUndefined();
    expect(normalized.propertyOrdering).toEqual(["mode"]);
    // any_of participates in union collapsing exactly like anyOf.
    expect(normalized.properties.mode).toEqual({ type: "integer" });
    assertNoForbiddenConstructs(normalized);

    // python-genai collision rule: snake_case overwrites an existing camelCase key.
    expect(normalizeSchemaForCCA({ anyOf: [{ type: "string" }], any_of: [{ type: "integer" }] })).toEqual({
      type: "integer",
    });
  });

  test("strips MCP transport annotations and annotation keywords protojson rejects", () => {
    expect(
      normalizeSchemaForCCA({
        type: "object",
        properties: {
          projectId: { type: "string", deprecated: true, readOnly: true },
          screenId: { type: "string", writeOnly: true, $comment: "internal", "x-mcp-header": "X-Trace" },
        },
      }),
    ).toEqual({
      type: "object",
      properties: { projectId: { type: "string" }, screenId: { type: "string" } },
    });
  });

  test("preserves default and enum entries as literal payloads, not schemas", () => {
    const literalDefault = { enum: ["not-a-schema"], properties: { type: "string" }, anyOf: [{ type: "null" }] };
    const normalized = normalizeSchemaForCCA({
      type: "object",
      properties: { config: { type: "object", properties: {}, default: literalDefault } },
    }) as Record<string, any>;
    expect(normalized.properties.config.default).toEqual(literalDefault);
    assertNoForbiddenConstructs(normalized);

    const withDefinitions = normalizeSchemaForCCA({
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {},
          default: { $defs: { literal: true }, nested: { $ref: "literal" } },
        },
      },
      $defs: { Unused: { type: "string" } },
    }) as Record<string, any>;
    expect(withDefinitions.properties.config.default).toEqual({
      $defs: { literal: true },
      nested: { $ref: "literal" },
    });
  });

  test("falls back to an empty object schema for malformed or unrepresentable tools", () => {
    const fallback = { type: "object", properties: {} };
    // Non-object roots.
    expect(normalizeSchemaForCCA("nope")).toEqual(fallback);
    expect(normalizeSchemaForCCA(42)).toEqual(fallback);
    expect(normalizeSchemaForCCA(null)).toEqual(fallback);
    // Scalar subschema in a property slot is malformed.
    expect(normalizeSchemaForCCA({ type: "object", properties: { x: "broken" } })).toEqual(fallback);
    // A residual uncollapsible union (malformed branch) falls back rather than
    // sending a forbidden combiner.
    expect(normalizeSchemaForCCA({ anyOf: [{ type: "string" }, 42] })).toEqual(fallback);
    expect(normalizeSchemaForCCA(false)).toEqual(fallback);
    // Same-type enum branches whose metadata disagrees cannot merge safely.
    expect(
      normalizeSchemaForCCA({
        anyOf: [
          { type: "string", enum: ["a"], title: "First" },
          { type: "string", enum: ["b"] },
        ],
      }),
    ).toEqual(fallback);
  });

  test("deduplicates required arrays and enum values, dropping stale names", () => {
    expect(
      normalizeSchemaForCCA({
        type: "object",
        properties: { mode: { type: "string", enum: ["read", "read", "write"] }, size: { type: "integer" } },
        required: ["mode", "mode", "size", "size", "ghost"],
      }),
    ).toEqual({
      type: "object",
      properties: { mode: { type: "string", enum: ["read", "write"] }, size: { type: "integer" } },
      required: ["mode", "size"],
    });
    expect(
      normalizeSchemaForCCA({
        type: "object",
        properties: { mode: { type: "string" } },
        propertyOrdering: ["ghost", "mode", "mode"],
      }),
    ).toEqual({
      type: "object",
      properties: { mode: { type: "string" } },
      propertyOrdering: ["mode"],
    });
  });

  test("drops enums containing null or non-scalar values instead of narrowing them", () => {
    expect(normalizeSchemaForCCA({ enum: ["a", null] })).toEqual({});
    expect(normalizeSchemaForCCA({ enum: [{ nested: true }] })).toEqual({});
    // Mixed scalar kinds cannot pick one type: the enum is dropped entirely.
    expect(normalizeSchemaForCCA({ enum: [1, "a"] })).toEqual({});
    expect(normalizeSchemaForCCA({ type: "integer", enum: [1, Number.NaN] })).toEqual({ type: "integer" });
  });

  test("infers types for bare scalar enums and consts", () => {
    expect(normalizeSchemaForCCA({ enum: ["definition", "references"] })).toEqual({
      type: "string",
      enum: ["definition", "references"],
    });
    expect(normalizeSchemaForCCA({ const: "FOO" })).toEqual({ type: "string", enum: ["FOO"] });
    expect(normalizeSchemaForCCA({ type: "string", const: "FOO" })).toEqual({ type: "string", enum: ["FOO"] });
    expect(normalizeSchemaForCCA({ type: "string", enum: ["A"], const: "B" })).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeSchemaForCCA({ type: "integer", enum: [1, "1", 2] })).toEqual({
      type: "integer",
      enum: ["1", "2"],
    });
  });

  test("omits tuple-form items safely and keeps valid single item schemas", () => {
    expect(normalizeSchemaForCCA({ type: "array", items: [{ type: "string" }, { type: "number" }] })).toEqual({
      type: "array",
    });
    expect(normalizeSchemaForCCA({ type: "array", items: { type: "string", pattern: "^x" } })).toEqual({
      type: "array",
      items: { type: "string" },
    });
    // Objects always carry properties on the wire.
    expect(normalizeSchemaForCCA({ type: "object" })).toEqual({ type: "object", properties: {} });
  });

  test("normalizes a reused subschema at every occurrence instead of blanking repeats", () => {
    const shared = { type: "string", description: "shared leaf" };
    expect(
      normalizeSchemaForCCA({ type: "object", properties: { a: shared, b: shared } }),
    ).toEqual({
      type: "object",
      properties: {
        a: { type: "string", description: "shared leaf" },
        b: { type: "string", description: "shared leaf" },
      },
    });
  });

  test("preserves property names that overlap object prototype keys", () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"integer"}},"required":["__proto__","constructor"]}',
    );
    const normalized = normalizeSchemaForCCA(schema) as Record<string, any>;
    expect(Object.hasOwn(normalized.properties, "__proto__")).toBe(true);
    expect(normalized.properties.__proto__).toEqual({ type: "string" });
    expect(normalized.properties.constructor).toEqual({ type: "integer" });
    expect(normalized.required).toEqual(["__proto__", "constructor"]);
  });
});

// ---------------------------------------------------------------------------
// Config-facing registration
// ---------------------------------------------------------------------------

describe("provider model registration map", () => {
  test("registers all usable families with zero cost", () => {
    const models = providerModels();
    for (const expected of [
      "gemini-3.5-flash",
      "gemini-3-flash",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.8-flash",
      "gemini-3.1-pro",
      "gemini-3-pro",
      "gemini-2.5-pro",
      "claude-opus-4-5",
      "claude-opus-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-6",
      "gpt-oss-120b",
    ]) {
      expect(models[expected]).toBeDefined();
    }
    for (const model of Object.values(models)) {
      expect(model.cost).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
      expect(model.reasoning).toBe(true);
      if (model.reasoning) expect(Object.keys(model.variants as object).length).toBeGreaterThan(0);
    }
    expect((models["gpt-oss-120b"]!.modalities as any).input).toEqual(["text"]);
    expect((models["claude-opus-4-6"]!.limit as any)).toEqual({ context: 250_000, output: 64_000 });
  });

  test("never registers invented thinking budgets; disables the derived max variant", () => {
    const models = providerModels();
    for (const [id, model] of Object.entries(models)) {
      const variants = model.variants as Record<string, any>;
      // Only OMP's minimal/low/medium/high efforts carry real controls.
      for (const [name, variant] of Object.entries(variants)) {
        if (name === "max") continue;
        expect(variant.thinkingConfig).toBeDefined();
      }
      const max = variants["max"];
      if (id.includes("2.5")) {
        // OpenCode derives `max` for Gemini 2.5 ids; it is explicitly
        // disabled rather than given an invented budget.
        expect(max).toEqual({ disabled: true });
        expect(max.thinkingConfig).toBeUndefined();
      } else {
        expect(max).toBeUndefined();
      }
    }
    // Realistic OpenCode config processing: merge derived + configured
    // variants, then drop disabled entries. Only Gemini 2.5 ids derive a
    // `max` variant.
    for (const id of ["gemini-2.5-pro", "gemini-3.1-pro"]) {
      const derived = id.includes("2.5")
        ? { high: {}, max: { thinkingConfig: { includeThoughts: true, thinkingBudget: 32_768 } } }
        : {};
      const merged = { ...derived, ...(models[id]!.variants as Record<string, any>) };
      const kept = Object.fromEntries(Object.entries(merged).filter(([, v]) => !v.disabled));
      expect(kept["max"]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Response unwrapping
// ---------------------------------------------------------------------------

describe("response unwrapping", () => {
  async function collect(transformer: TransformStream<Uint8Array, Uint8Array>, chunks: string[]): Promise<string> {
    const writer = transformer.writable.getWriter();
    const read = (async () => {
      let out = "";
      const reader = transformer.readable.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
      }
      return out;
    })();
    for (const chunk of chunks) await writer.write(new TextEncoder().encode(chunk));
    await writer.close();
    return read;
  }

  test("unwraps response-wrapped SSE chunks incrementally, preserving framing", async () => {
    const responseIds: string[] = [];
    let completed: string | undefined;
    const transformer = createCcaSseUnwrap({
      onResponseId: (id) => responseIds.push(id),
      onComplete: (id) => (completed = id),
    });
    const chunkA = JSON.stringify({ response: { candidates: [], usageMetadata: {}, responseId: "r-1" } });
    const chunkB = JSON.stringify({ response: { candidates: [{ finishReason: "STOP" }], responseId: "r-1" } });
    // Split mid-line across writes to prove incremental processing.
    const output = await collect(transformer, [
      `data: ${chunkA.slice(0, 20)}`,
      chunkA.slice(20),
      "\n\n",
      `data: ${chunkB}\n\n`,
    ]);
    const dataLines = output.split("\n").filter((line) => line.startsWith("data:"));
    expect(dataLines).toHaveLength(2);
    expect(JSON.parse(dataLines[0]!.slice(6))).toEqual(JSON.parse(chunkA).response);
    expect(JSON.parse(dataLines[1]!.slice(6))).toEqual(JSON.parse(chunkB).response);
    // Both chunks carried the same id; it is reported per chunk.
    expect(responseIds).toEqual(["r-1", "r-1"]);
    expect(completed).toBe("r-1");
  });

  test("in-band errors error the stream with a sanitized message", async () => {
    const errors: unknown[] = [];
    let completeCount = 0;
    const transformer = createCcaSseUnwrap({
      onError: (error) => errors.push(error),
      onComplete: () => completeCount++,
    });
    const writer = transformer.writable.getWriter();
    const read = (async () => {
      let out = "";
      const reader = transformer.readable.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value);
      }
      return out;
    })();
    await writer.write(new TextEncoder().encode('data: {"error":{"code":403,"message":"permission denied","status":"PERMISSION_DENIED"}}\n\n'));
    await expect(read).rejects.toThrow(
      /Cloud Code Assist error \(PERMISSION_DENIED\): permission denied/,
    );
    expect(errors[0]).toEqual({ code: 403, message: "permission denied", status: "PERMISSION_DENIED" });
    // A failed stream never reports successful completion.
    expect(completeCount).toBe(0);
  });

  test("pre-first-event probe buffers without losing bytes", async () => {
    const eventA = { response: { candidates: [], responseId: "r-1" } };
    const eventB = { response: [{ finishReason: "STOP" }], responseId: "r-1" };
    const raw = `data: ${JSON.stringify(eventA)}\ndata: ${JSON.stringify(eventB)}\n\n`;
    // Split the raw bytes at an awkward boundary (mid first event).
    const bytes = new TextEncoder().encode(raw);
    const splitAt = 30;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });
    const probe = await readFirstSseEvent(source, 5_000);
    expect(probe.event).toEqual(eventA);

    // The returned stream replays consumed bytes and continues losslessly.
    let text = "";
    const reader = probe.stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toBe(raw);
  });

  test("probe watchdog fires on silent endpoints", async () => {
    const source = new ReadableStream<Uint8Array>({
      start() {}, // never enqueues, never closes
    });
    await expect(readFirstSseEvent(source, 25)).rejects.toThrow(/timed out waiting for the first event/);
  });

  test("probe rejects clean EOF and [DONE] before the first event", async () => {
    await expect(readFirstSseEvent(new Response("").body!, 5_000)).rejects.toThrow(
      /ended before the first event/,
    );
    await expect(readFirstSseEvent(new Response("data: [DONE]\n\n").body!, 5_000)).rejects.toThrow(
      /ended before the first event/,
    );
  });

  test("[DONE] and non-data lines pass through", async () => {
    const transformer = createCcaSseUnwrap({});
    const output = await collect(transformer, ["event: x\ndata: [DONE]\n\n"]);
    expect(output).toContain("event: x\n");
    expect(output).toContain("data: [DONE]\n\n");
  });

  test("non-stream JSON unwrapping and header hygiene", () => {
    expect(unwrapCcaJson({ response: { candidates: [1] } })).toEqual({ candidates: [1] });
    expect(unwrapCcaJson({ candidates: [] })).toEqual({ candidates: [] });
    const response = new Response("{}" , {
      headers: { "content-type": "application/json", "content-length": "900", "content-encoding": "gzip", "transfer-encoding": "chunked" },
    });
    const headers = unwrappedResponseHeaders(response);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
  });
});
