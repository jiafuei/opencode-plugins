import { describe, expect, test } from "bun:test";
import {
  SNAPSHOT_CATALOG,
  WIRE_MODEL_HEADER,
  advanceEnvelope,
  createCcaSseUnwrap,
  createSessionState,
  getAntigravityUserAgent,
  normalizeSchemaForCCA,
  providerModels,
  rewriteBodyForAntigravity,
} from "./wire.ts";

// ---------------------------------------------------------------------------
// User agent
// ---------------------------------------------------------------------------

describe("antigravity user agent", () => {
  test("matches the native IDE language server fingerprint", () => {
    const version = process.env.OPENCODE_ANTIGRAVITY_VERSION;
    delete process.env.OPENCODE_ANTIGRAVITY_VERSION;
    expect(getAntigravityUserAgent()).toBe("antigravity/ide/2.5.5 (aidev_client; os_type=windows; arch=amd64)");
    process.env.OPENCODE_ANTIGRAVITY_VERSION = "9.9.9";
    process.env.OPENCODE_ANTIGRAVITY_OS = "darwin";
    process.env.OPENCODE_ANTIGRAVITY_ARCH = "arm64";
    expect(getAntigravityUserAgent()).toBe("antigravity/ide/9.9.9 (aidev_client; os_type=darwin; arch=arm64)");
    delete process.env.OPENCODE_ANTIGRAVITY_OS;
    delete process.env.OPENCODE_ANTIGRAVITY_ARCH;
    if (version === undefined) delete process.env.OPENCODE_ANTIGRAVITY_VERSION;
    else process.env.OPENCODE_ANTIGRAVITY_VERSION = version;
  });
});

// ---------------------------------------------------------------------------
// Session state & request envelope
// ---------------------------------------------------------------------------

const user = (text: string) => ({ role: "user", parts: [{ text }] });
const reply = (text: string) => ({ role: "model", parts: [{ text }] });
const call = (name: string) => ({ role: "model", parts: [{ functionCall: { id: name, name, args: {} } }] });
const results = (...names: string[]) => ({
  role: "user",
  parts: names.map((name) => ({ functionResponse: { id: name, name, response: { name, content: "ok" } } })),
});

describe("session envelope", () => {
  test("step index and execution ids follow the native trajectory", () => {
    const state = createSessionState();
    const model = SNAPSHOT_CATALOG["gemini-3.8-flash-low"]!;
    const stepOf = (requestId: string) => Number(requestId.split("/").at(-1));

    // Captured sequence: first prompt is step 2, the checkpoint after the
    // first reply adds a step, tool calls and results add one step each.
    const first = advanceEnvelope(state, [user("a")], model);
    expect(first.requestId).toMatch(new RegExp(`^agent/${state.agentId}/\\d+/${state.trajectoryId}/2$`));
    expect(first.labels).toEqual({
      last_step_index: "1",
      model_enum: "MODEL_PLACEHOLDER_M320",
      trajectory_id: state.trajectoryId,
      used_claude: "false",
      used_claude_conservative: "false",
      used_non_gemini_model: "false",
    });

    const second = advanceEnvelope(state, [user("a"), reply("b"), user("c")], model);
    expect(stepOf(second.requestId)).toBe(5);
    const execution = second.labels["last_execution_id"];
    expect(execution).toMatch(/^[0-9a-f-]{36}$/);

    // A tool continuation stays in the same execution.
    const toolTurn = [user("a"), reply("b"), user("c"), call("x"), results("x")];
    const third = advanceEnvelope(state, toolTurn, model);
    expect(stepOf(third.requestId)).toBe(7);
    expect(third.labels["last_execution_id"]).toBe(execution);

    // Retries of the same history reproduce the identity.
    expect(advanceEnvelope(state, toolTurn, model).labels).toEqual(third.labels);

    // Four batched results are four steps; the next user turn moves the execution on.
    const batched = advanceEnvelope(state, [...toolTurn, call("y"), results("y1", "y2", "y3", "y4"), user("d")], model);
    expect(stepOf(batched.requestId)).toBe(13);
    expect(batched.labels["last_execution_id"]).not.toBe(execution);

    // Compacted history never moves the step backwards.
    const compacted = advanceEnvelope(state, [user("summary"), user("e")], model);
    expect(stepOf(compacted.requestId)).toBe(13);
  });

  test("model family flags stay set once a non-Gemini model is used", () => {
    const state = createSessionState();
    const flags = (wireId: string) => {
      const { labels } = advanceEnvelope(state, [user("a")], SNAPSHOT_CATALOG[wireId]!);
      return [labels["used_claude"], labels["used_claude_conservative"], labels["used_non_gemini_model"]];
    };
    expect(flags("gpt-oss-120b-medium")).toEqual(["false", "false", "true"]);
    expect(flags("claude-opus-5-5-low")).toEqual(["true", "true", "true"]);
    expect(flags("gemini-3.8-flash-high")).toEqual(["true", "true", "true"]);
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

function rewrite(args: Record<string, any>, wireModelId: string, state = createSessionState()): Record<string, any> {
  return rewriteBodyForAntigravity({
    args,
    logicalModelId: wireModelId.replace(/-(low|medium|high)$/, ""),
    wireModelId,
    model: SNAPSHOT_CATALOG[wireModelId]!,
    projectId: "proj-1",
    state,
    checkpoint: false,
  });
}

describe("body rewrite", () => {
  test("produces the Cloud Code Assist envelope", () => {
    const args = baseArgs();
    args.systemInstruction = { parts: [{ text: "system" }, { text: "prompt" }] };
    args.generationConfig = { temperature: 0.5, topK: 3, maxOutputTokens: 100, thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } };
    args.tools = [{ functionDeclarations: [{ name: "t", parameters: { type: "object", properties: {} } }] }];
    const body = rewrite(args, "gemini-3.8-flash-low");
    expect(body.project).toBe("proj-1");
    expect(body.model).toBe("gemini-3.8-flash-low");
    expect(body.userAgent).toBe("antigravity");
    expect(body.requestType).toBe("agent");
    expect(body.requestId).toMatch(/^agent\//);
    expect(Object.keys(body)).toEqual(["project", "requestId", "request", "model", "userAgent", "requestType"]);
    expect(Object.keys(body.request)).toEqual([
      "contents",
      "systemInstruction",
      "tools",
      "toolConfig",
      "labels",
      "generationConfig",
      "sessionId",
    ]);
    // The native system prompt is a single part.
    expect(body.request.systemInstruction).toEqual({ role: "user", parts: [{ text: "system\nprompt" }] });
    expect(body.request.sessionId).toMatch(/^-\d+$/);
    // Only the catalog's output cap and thinking budget; OpenCode's sampling settings are dropped.
    expect(body.request.generationConfig).toEqual({
      maxOutputTokens: 65536,
      thinkingConfig: { includeThoughts: true, thinkingBudget: 1000 },
    });
    expect(body.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
    expect(body.request.labels.model_enum).toBe("MODEL_PLACEHOLDER_M320");
  });

  test("sends each family's captured thinking transport", () => {
    expect(rewrite(baseArgs(), "gemini-3.8-flash-high").request.generationConfig).toEqual({
      maxOutputTokens: 65536,
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
    });
    expect(rewrite(baseArgs(), "claude-opus-5-5-medium").request.generationConfig).toEqual({
      maxOutputTokens: 128000,
      thinkingConfig: { includeThoughts: true, thinkingBudget: 0, thinkingLevel: "MEDIUM" },
    });
  });

  test("title requests become checkpoint calls that leave the trajectory untouched", () => {
    const state = createSessionState();
    const body = rewriteBodyForAntigravity({
      args: { ...baseArgs(), generationConfig: { temperature: 0.5 } },
      logicalModelId: "claude-opus-5-5",
      wireModelId: "claude-opus-5-5-high",
      model: SNAPSHOT_CATALOG["claude-opus-5-5-high"]!,
      projectId: "proj-1",
      state,
      checkpoint: true,
    });
    expect(body).toEqual({
      project: "proj-1",
      requestId: expect.stringMatching(/^checkpoint\/[0-9a-f-]{36}$/),
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        systemInstruction: { role: "user", parts: [{ text: "system prompt" }] },
        generationConfig: { maxOutputTokens: 16384, thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } },
        sessionId: state.sessionId,
      },
      model: "gemini-3.1-flash-lite",
      userAgent: "antigravity",
      requestType: "checkpoint",
    });
    expect(state.historySteps).toBe(0);
    expect(state.usedClaude).toBe(false);

    // A tool-less agent request keeps its model and simply has no tools.
    const agent = rewrite(baseArgs(), "claude-opus-5-5-high");
    expect(agent).toMatchObject({ model: "claude-opus-5-5-high", requestType: "agent" });
    expect(agent.request.tools).toBeUndefined();
  });

  test("forces VALIDATED for Claude", () => {
    const body = rewrite({ contents: [], toolConfig: { functionCallingConfig: { mode: "ANY" } } }, "claude-opus-5-5-high");
    expect(body.request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
    expect(body.request.labels.used_claude).toBe("true");
  });

  test("keeps explicit non-AUTO SDK tool choices and defaults plain tools to VALIDATED", () => {
    const forced = baseArgs();
    forced.tools = [{ functionDeclarations: [{ name: "t", parameters: { type: "object", properties: {} } }] }];
    forced.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["t"] } };
    expect(rewrite(forced, "gemini-3.8-flash-low").request.toolConfig.functionCallingConfig.mode).toBe("ANY");

    const plain = baseArgs();
    plain.tools = [{ functionDeclarations: [{ name: "t", parameters: { type: "object", properties: {} } }] }];
    expect(rewrite(plain, "gemini-3.8-flash-low").request.toolConfig.functionCallingConfig.mode).toBe("VALIDATED");
  });

  test("tool results carry output text in the provider's native role", () => {
    const args = { contents: [user("a"), call("x"), results("x")] };
    const nativeResult = (role: string) => ({
      role,
      parts: [{ functionResponse: { id: "x", name: "x", response: { output: "ok" } } }],
    });
    expect(rewrite(args, "gemini-3.8-flash-low").request.contents[2]).toEqual(nativeResult("model"));
    expect(rewrite(args, "claude-opus-5-5-low").request.contents[2]).toEqual(nativeResult("user"));
  });

  test("normalizes Gemini 3 function-call signatures per model turn", () => {
    const contents = [
      {
        role: "model",
        parts: [
          { functionCall: { name: "first", args: {} }, thoughtSignature: "signed" },
          { functionCall: { name: "second", args: {} }, thoughtSignature: "skip_thought_signature_validator" },
        ],
      },
      { role: "user", parts: [{ functionResponse: { name: "first", response: { content: "" } } }] },
      { role: "model", parts: [{ functionCall: { name: "unsigned", args: {} } }] },
    ];
    const body = rewrite({ contents }, "gemini-3.8-flash-low");

    expect(body.request.contents[0].parts[0].thoughtSignature).toBe("signed");
    expect(body.request.contents[0].parts[1].thoughtSignature).toBeUndefined();
    expect(body.request.contents[2].parts[0].thoughtSignature).toBe("skip_thought_signature_validator");
  });

  test("keeps Claude thinking only for messages that carry a signature", () => {
    const body = rewrite(
      {
        contents: [
          {
            role: "model",
            parts: [
              { text: "first ", thought: true },
              { text: "second", thought: true, thoughtSignature: "opaque" },
              { functionCall: { name: "tool", args: {} } },
            ],
          },
          { role: "model", parts: [{ text: "unsigned", thought: true }, { text: "answer" }] },
        ],
      },
      "claude-opus-5-5-high",
    );

    // The signature moves to the first non-thought part, as the native client replays it.
    expect(body.request.contents).toEqual([
      {
        role: "model",
        parts: [
          { text: "first second", thought: true },
          { functionCall: { name: "tool", args: {} }, thoughtSignature: "opaque" },
        ],
      },
      { role: "model", parts: [{ text: "answer" }] },
    ]);
  });

  test("replays assistant parts in native order: joined thoughts, joined text, then calls", () => {
    const body = rewrite(
      {
        contents: [
          {
            role: "model",
            parts: [
              { text: "a", thought: true },
              { text: "b", thought: true },
              { functionCall: { name: "first", args: {} }, thoughtSignature: "call-sig" },
              { text: "x<tool_code> </tool_code>", thoughtSignature: "text-sig" },
              { text: "y<tool_code>\n" },
              { functionCall: { name: "second", args: {} } },
            ],
          },
          { role: "model", parts: [{ text: " \n" }, { functionCall: { name: "third", args: {} }, thoughtSignature: "s3" }] },
        ],
      },
      "gemini-3.8-flash-low",
    );
    expect(body.request.contents).toEqual([
      {
        role: "model",
        parts: [
          { text: "ab", thought: true },
          { text: "xy", thoughtSignature: "text-sig" },
          { functionCall: { name: "first", args: {} }, thoughtSignature: "call-sig" },
          { functionCall: { name: "second", args: {} } },
        ],
      },
      // Whitespace-only text is omitted.
      { role: "model", parts: [{ functionCall: { name: "third", args: {} }, thoughtSignature: "s3" }] },
    ]);
  });

  test("converts @ai-sdk/google parametersJsonSchema declarations like OMP", () => {
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
              properties: { path: { type: "string", title: "Path", pattern: "^/" }, extra: true },
              required: ["path"],
              additionalProperties: false,
            },
          },
          // Legacy `parameters` declarations pass through untouched.
          { name: "legacy", description: "", parameters: { type: "object", properties: {} } },
        ],
      },
    ];
    const body = rewrite(args, "claude-opus-5-5-high");
    const declarations = body.request.tools[0].functionDeclarations;
    expect(declarations[0].parametersJsonSchema).toBeUndefined();
    // Native protojson shape: enum-name types and sorted property maps.
    expect(declarations[0].parameters).toEqual({
      type: "OBJECT",
      properties: { extra: {}, path: { type: "STRING" } },
      required: ["path"],
    });
    expect(Object.keys(declarations[0].parameters.properties)).toEqual(["extra", "path"]);
    expect(declarations[1]).toEqual({ name: "legacy", description: "", parameters: { type: "OBJECT", properties: {} } });
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
    const declaration = rewrite(args, "claude-opus-5-5-high").request.tools[0].functionDeclarations[0];
    expect(declaration.parameters).toEqual({
      type: "OBJECT",
      properties: { depth: { type: "INTEGER", enum: ["1", "2"] } },
      required: ["depth"],
    });
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
// Provider model registration
// ---------------------------------------------------------------------------

describe("provider model registration", () => {
  test("groups the agent catalog into tier families defaulting to the highest tier", () => {
    const models = Object.fromEntries(providerModels().map((model) => [model.id, model]));
    expect(Object.keys(models)).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.1-pro",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "gpt-oss-120b",
    ]);
    const opus = models["claude-opus-5-5"]!;
    expect(opus).toMatchObject({
      providerID: "google-antigravity",
      name: "Claude Opus 5.5",
      headers: { [WIRE_MODEL_HEADER]: "claude-opus-5-5-high" },
      cost: [],
      limit: { context: 1_000_000, output: 128_000 },
    });
    expect(opus.variants).toEqual([
      { id: "low", headers: { [WIRE_MODEL_HEADER]: "claude-opus-5-5-low" } },
      { id: "medium", headers: { [WIRE_MODEL_HEADER]: "claude-opus-5-5-medium" } },
      { id: "high", headers: { [WIRE_MODEL_HEADER]: "claude-opus-5-5-high" } },
    ] as any);
    // Asymmetric wire ids still group by display name.
    expect(models["gemini-3.1-pro"]!.headers).toEqual({ [WIRE_MODEL_HEADER]: "gemini-pro-agent" });
    // A single tier needs no variants.
    expect(models["gpt-oss-120b"]!.variants).toEqual([]);
    expect(models["gpt-oss-120b"]!.capabilities.input).toEqual(["text"]);
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
    const chunkA = JSON.stringify({ response: { candidates: [], usageMetadata: {}, responseId: "r-1" }, traceId: "t-1" });
    const chunkB = JSON.stringify({ response: { candidates: [{ finishReason: "STOP" }], responseId: "r-1" } });
    const completions: unknown[] = [];
    // Split mid-line across writes to prove incremental processing.
    const output = await collect(createCcaSseUnwrap(undefined, (completion) => completions.push(completion)), [
      `data: ${chunkA.slice(0, 20)}`,
      chunkA.slice(20),
      "\n\n",
      `data: ${chunkB}\n\n`,
    ]);
    const dataLines = output.split("\n").filter((line) => line.startsWith("data:"));
    expect(dataLines).toHaveLength(2);
    expect(JSON.parse(dataLines[0]!.slice(6))).toEqual(JSON.parse(chunkA).response);
    expect(JSON.parse(dataLines[1]!.slice(6))).toEqual(JSON.parse(chunkB).response);
    // A call-only or empty turn has no first-message time.
    expect(completions).toEqual([{ traceId: "t-1" }]);
  });

  test("[DONE] and non-data lines pass through", async () => {
    const completions: unknown[] = [];
    const output = await collect(createCcaSseUnwrap(undefined, (completion) => completions.push(completion)), ["event: x\ndata: [DONE]\n\n"]);
    expect(output).toContain("event: x\n");
    expect(output).toContain("data: [DONE]\n\n");
    // A stream without a finish reason is not a completed response.
    expect(completions).toEqual([]);
  });
});
