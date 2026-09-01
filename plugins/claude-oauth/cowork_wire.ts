const GENERIC_OPENING = "You are a coding agent operating in the user's workspace.";
const COMBINATOR_KEYS = ["anyOf", "allOf", "oneOf"] as const;
const UNIVERSAL_KEEP = new Set([
  "$ref", "$defs", "$schema", "definitions", "type", "anyOf", "allOf", "enum", "const",
  "description", "title", "default", "nullable",
]);
const OBJECT_KEEP = new Set(["properties", "required", "additionalProperties"]);
const ARRAY_KEEP = new Set(["items", "prefixItems", "minItems"]);
const STRING_KEEP = new Set(["format"]);
const STRING_FORMATS = new Set([
  "date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid",
]);
const STRICT_TOOLS = new Set(["bash", "python", "edit", "find"]);
const STRICT_INCOMPATIBLE = ["oneOf", "allOf", "$ref", "patternProperties", "propertyNames"];
const CACHE_CONTROL = { type: "ephemeral" } as const;
const MAX_OUTPUT_TOKENS = 64000;
const OUTPUT_BUFFER = 4000;

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scalarType(schema: Record<string, any>): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) return schema.type.find((entry: unknown) => typeof entry === "string" && entry !== "null");
  if (isRecord(schema.properties)) return "object";
  if (schema.items !== undefined || Array.isArray(schema.prefixItems)) return "array";
  return undefined;
}

function spillDescription(result: Record<string, any>, spill: Array<[string, unknown]>): void {
  const entries = spill.filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const text = `{${entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")}}`;
  result.description = result.description ? `${result.description}\n\n${text}` : text;
}

function normalizeNode(
  schema: unknown,
  cache: WeakMap<Record<string, any>, Record<string, any>>,
  root = false,
): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => normalizeNode(entry, cache));
  if (!isRecord(schema)) return schema;
  const cached = cache.get(schema);
  if (cached) return cached;
  const result: Record<string, any> = {};
  cache.set(schema, result);
  const type = scalarType(schema);
  const keep = type === "object" ? OBJECT_KEEP : type === "array" ? ARRAY_KEEP : type === "string" ? STRING_KEEP : undefined;
  const spill: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(schema)) {
    if ((!root || !COMBINATOR_KEYS.includes(key as any)) && (UNIVERSAL_KEEP.has(key) || keep?.has(key))) result[key] = value;
    else spill.push([key, value]);
  }
  if (type === "string" && typeof result.format === "string" && !STRING_FORMATS.has(result.format)) {
    spill.push(["format", result.format]);
    delete result.format;
  }
  if (type === "array" && result.minItems !== undefined && result.minItems !== 0 && result.minItems !== 1) {
    spill.push(["minItems", result.minItems]);
    delete result.minItems;
  }
  if (type === "object" && result.additionalProperties === undefined) result.additionalProperties = false;
  if (isRecord(result.properties)) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([name, value]) => [name, normalizeNode(value, cache)]),
    );
  }
  if (isRecord(result.additionalProperties)) {
    const normalized = normalizeNode(result.additionalProperties, cache);
    result.additionalProperties = isRecord(normalized) && Object.keys(normalized).length === 0 ? true : normalized;
  }
  if (Array.isArray(result.items)) result.items = result.items.map((entry: unknown) => normalizeNode(entry, cache));
  else if (isRecord(result.items)) result.items = normalizeNode(result.items, cache);
  if (Array.isArray(result.prefixItems)) result.prefixItems = result.prefixItems.map((entry: unknown) => normalizeNode(entry, cache));
  for (const key of COMBINATOR_KEYS) {
    if (Array.isArray(result[key])) result[key] = result[key].map((entry: unknown) => normalizeNode(entry, cache));
  }
  for (const key of ["$defs", "definitions"]) {
    if (isRecord(result[key])) {
      result[key] = Object.fromEntries(Object.entries(result[key]).map(([name, value]) => [name, normalizeNode(value, cache)]));
    }
  }
  spillDescription(result, spill);
  return result;
}

export function normalizeCoworkToolSchema(schema: unknown): unknown {
  return normalizeNode(schema, new WeakMap(), true);
}

function isArrayNode(schema: Record<string, any>): boolean {
  return schema.type === "array" ||
    (Array.isArray(schema.type) && schema.type.includes("array") && !schema.type.includes("object")) ||
    schema.items !== undefined || Array.isArray(schema.prefixItems);
}

function isObjectNode(schema: Record<string, any>): boolean {
  return !isArrayNode(schema) &&
    (schema.type === "object" || (Array.isArray(schema.type) && schema.type.includes("object")) || isRecord(schema.properties));
}

function hasDefiningKeyword(schema: Record<string, any>): boolean {
  return ["type", "properties", "additionalProperties", "items", "prefixItems", "enum", "const", "$ref", "$defs", "definitions"]
    .some((key) => schema[key] !== undefined) || COMBINATOR_KEYS.some((key) => schema[key] !== undefined);
}

function hasNull(schema: Record<string, any>): boolean {
  return (Array.isArray(schema.type) && schema.type.includes("null")) ||
    (Array.isArray(schema.anyOf) && schema.anyOf.some((entry: unknown) => isRecord(entry) && entry.type === "null"));
}

interface StrictBudget {
  optionalRemaining: number;
  unionRemaining: number;
  optionalCount: number;
  unionCount: number;
}

function nullable(schema: unknown, budget: StrictBudget): unknown | undefined {
  if (isRecord(schema)) {
    if (hasNull(schema)) return schema;
    if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: [...schema.anyOf, { type: "null" }] };
    if (Array.isArray(schema.type)) return { ...schema, type: [...schema.type, "null"] };
  }
  if (budget.unionRemaining <= 0) return undefined;
  budget.unionRemaining--;
  budget.unionCount++;
  return { anyOf: [schema, { type: "null" }] };
}

function strictNode(
  schema: unknown,
  budget: StrictBudget,
  cache: WeakMap<Record<string, any>, Record<string, any>>,
): unknown | undefined {
  if (Array.isArray(schema)) {
    const result: unknown[] = [];
    for (const entry of schema) {
      const normalized = strictNode(entry, budget, cache);
      if (normalized === undefined) return undefined;
      result.push(normalized);
    }
    return result;
  }
  if (!isRecord(schema)) return schema;
  const cached = cache.get(schema);
  if (cached) return cached;
  if (!hasDefiningKeyword(schema) || (isObjectNode(schema) && schema.additionalProperties !== false)) return undefined;
  const result = { ...schema };
  cache.set(schema, result);
  if (Array.isArray(result.type) || Array.isArray(result.anyOf)) {
    if (budget.unionRemaining <= 0) return undefined;
    budget.unionRemaining--;
    budget.unionCount++;
  }
  if (isRecord(result.properties)) {
    const originalRequired = new Set(Array.isArray(result.required) ? result.required.filter((entry: unknown) => typeof entry === "string") : []);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [name, value] of Object.entries(result.properties)) {
      const normalized = strictNode(value, budget, cache);
      if (normalized === undefined) return undefined;
      if (originalRequired.has(name)) {
        properties[name] = normalized;
        required.push(name);
      } else if (budget.optionalRemaining > 0) {
        budget.optionalRemaining--;
        budget.optionalCount++;
        properties[name] = normalized;
      } else {
        const madeNullable = nullable(normalized, budget);
        if (madeNullable === undefined) return undefined;
        properties[name] = madeNullable;
        required.push(name);
      }
    }
    result.properties = properties;
    result.required = required;
  }
  for (const key of ["items", "prefixItems", ...COMBINATOR_KEYS]) {
    if (result[key] === undefined) continue;
    const normalized = strictNode(result[key], budget, cache);
    if (normalized === undefined) return undefined;
    result[key] = normalized;
  }
  for (const key of ["$defs", "definitions"]) {
    if (!isRecord(result[key])) continue;
    const definitions: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(result[key])) {
      const normalized = strictNode(value, budget, cache);
      if (normalized === undefined) return undefined;
      definitions[name] = normalized;
    }
    result[key] = definitions;
  }
  return result;
}

function hasStrictIncompatible(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => hasStrictIncompatible(entry, seen));
  const record = value as Record<string, unknown>;
  return STRICT_INCOMPATIBLE.some((key) => record[key] !== undefined) ||
    Object.values(record).some((entry) => hasStrictIncompatible(entry, seen));
}

export function normalizeCoworkTools(tools: unknown): void {
  if (!Array.isArray(tools)) return;
  const candidates: number[] = [];
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    if (!isRecord(tool) || typeof tool.type === "string") continue;
    const rawSchema = isRecord(tool.input_schema) ? tool.input_schema : {};
    const logicalName = tool.name;
    tool.input_schema = normalizeCoworkToolSchema({
      ...rawSchema,
      type: "object",
      properties: isRecord(rawSchema.properties) ? rawSchema.properties : {},
      required: Array.isArray(rawSchema.required) ? rawSchema.required.filter((entry) => typeof entry === "string") : [],
    });
    if (typeof logicalName === "string" && STRICT_TOOLS.has(logicalName) && tool.strict !== false && !hasStrictIncompatible(rawSchema)) {
      candidates.push(index);
    }
  }
  let strictCount = 0;
  let optionalCount = 0;
  let unionCount = 0;
  for (const index of candidates) {
    if (strictCount >= 20) break;
    const budget: StrictBudget = {
      optionalRemaining: 24 - optionalCount,
      unionRemaining: 16 - unionCount,
      optionalCount: 0,
      unionCount: 0,
    };
    const normalized = strictNode(tools[index].input_schema, budget, new WeakMap());
    if (!isRecord(normalized)) continue;
    tools[index].input_schema = normalized;
    tools[index].strict = true;
    strictCount++;
    optionalCount += budget.optionalCount;
    unionCount += budget.unionCount;
  }
}

export function sanitizeCoworkSystem(blocks: Array<Record<string, any>>): Array<Record<string, any>> {
  let openingSeen = false;
  const output: Array<Record<string, any>> = [];
  for (const block of blocks) {
    if (block?.type !== "text" || typeof block.text !== "string") {
      output.push(block);
      continue;
    }
    let text = block.text.replace(/\r\n?/g, "\n");
    const firstContent = text.search(/\S/);
    if (firstContent >= 0) {
      const lineEnd = text.indexOf("\n", firstContent);
      const end = lineEnd < 0 ? text.length : lineEnd;
      const line = text.slice(firstContent, end);
      if (/^You are OpenCode\b/i.test(line.trimStart())) {
        text = `${text.slice(0, firstContent)}${GENERIC_OPENING}${text.slice(end)}`;
      }
    }
    const lines = text.split("\n").filter((line) =>
      !/OpenCode|github\.com\/anomalyco\/opencode|opencode\.ai\/docs/i.test(line),
    );
    text = lines.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) continue;
    if (text === GENERIC_OPENING) {
      if (openingSeen) continue;
      openingSeen = true;
    } else if (text.startsWith(`${GENERIC_OPENING}\n`)) {
      if (openingSeen) text = text.slice(GENERIC_OPENING.length).trimStart();
      else openingSeen = true;
    }
    if (text) output.push({ ...block, text });
  }
  return output;
}

function applyCacheToLastBlock(blocks: Array<Record<string, any>>): void {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (["thinking", "redacted_thinking", "fallback"].includes(block.type)) continue;
    if (block.cache_control != null) return;
    blocks[index] = { ...block, cache_control: { ...CACHE_CONTROL } };
    return;
  }
}

export function applyCoworkPromptCaching(messages: unknown): void {
  if (!Array.isArray(messages)) return;
  const trailingIndex = messages.length - 1;
  const trailing = messages[trailingIndex];
  const hasPad = trailing?.role === "user" && trailing.content === "Continue." && messages[trailingIndex - 1]?.role === "assistant";
  const end = hasPad ? trailingIndex - 1 : trailingIndex;
  for (let index = end; index >= Math.max(0, end - 1); index--) {
    const message = messages[index];
    if (typeof message?.content === "string") {
      message.content = [{ type: "text", text: message.content, cache_control: { ...CACHE_CONTROL } }];
    } else if (Array.isArray(message?.content)) {
      applyCacheToLastBlock(message.content);
    }
  }
}

interface ClaudeModel {
  family: "opus" | "sonnet" | "fable" | "mythos" | "haiku";
  major: number;
  minor: number;
}

function parseClaudeModel(modelId: string): ClaudeModel | undefined {
  const familyFirst = modelId.match(
    /(?:^|[/.:])claude-(opus|sonnet|fable|mythos|haiku)-(\d+)(?:[.-](\d{1,2}))?(?:[.@-]|$)/i,
  );
  const versionFirst = modelId.match(
    /(?:^|[/.:])claude-(\d+)(?:[.-](\d{1,2}))?-(opus|sonnet|fable|mythos|haiku)(?:[.@-]|$)/i,
  );
  if (familyFirst) {
    return {
      family: familyFirst[1]!.toLowerCase() as ClaudeModel["family"],
      major: +familyFirst[2]!,
      minor: +(familyFirst[3] ?? 0),
    };
  }
  if (versionFirst) {
    return {
      family: versionFirst[3]!.toLowerCase() as ClaudeModel["family"],
      major: +versionFirst[1]!,
      minor: +(versionFirst[2] ?? 0),
    };
  }
  return undefined;
}

function atLeast(model: ClaudeModel, major: number, minor = 0): boolean {
  return model.major > major || (model.major === major && model.minor >= minor);
}

export function applyCoworkModelCompatibility(params: Record<string, any>): void {
  const model = parseClaudeModel(typeof params.model === "string" ? params.model : "");
  if (!model) return;
  const adaptiveOnly = model.family !== "haiku" && atLeast(model, 4, 6);
  const modernAdaptive = model.family === "opus"
    ? atLeast(model, 4, 7)
    : ["sonnet", "fable", "mythos"].includes(model.family) && atLeast(model, 5);
  const supportsDisplay = modernAdaptive;
  const supportsForced = model.family !== "fable" && model.family !== "mythos";
  let thinking = isRecord(params.thinking) ? { ...params.thinking } : params.thinking;
  if (isRecord(thinking) && !supportsDisplay) delete thinking.display;
  const outputConfig = isRecord(params.output_config) ? { ...params.output_config } : {};
  if (isRecord(thinking) && thinking.type === "disabled" && adaptiveOnly) {
    thinking = undefined;
    outputConfig.effort = "low";
  }
  const forced = params.tool_choice?.type === "any" || params.tool_choice?.type === "tool";
  if (forced && !supportsForced) params.tool_choice = { type: "auto" };
  else if (forced) {
    thinking = undefined;
    if (adaptiveOnly) outputConfig.effort = "low";
    else delete outputConfig.effort;
  }
  params.max_tokens = Math.min(MAX_OUTPUT_TOKENS, params.max_tokens ?? MAX_OUTPUT_TOKENS);
  if (isRecord(thinking) && thinking.type === "enabled" && Number(thinking.budget_tokens) > 0) {
    params.max_tokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(params.max_tokens, thinking.budget_tokens + OUTPUT_BUFFER));
    if (thinking.budget_tokens + OUTPUT_BUFFER > params.max_tokens) {
      thinking.budget_tokens = params.max_tokens - OUTPUT_BUFFER;
    }
  }
  delete params.context_management;
  if (modernAdaptive || (isRecord(thinking) && thinking.type !== "disabled")) {
    delete params.temperature;
    delete params.top_p;
    delete params.top_k;
  }
  if (thinking === undefined) delete params.thinking;
  else params.thinking = thinking;
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;
  else delete params.output_config;
}

export function makeStringsWellFormed(value: unknown): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (typeof value[index] === "string") value[index] = value[index].toWellFormed();
      else makeStringsWellFormed(value[index]);
    }
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") value[key] = entry.toWellFormed();
      else makeStringsWellFormed(entry);
    }
  }
}
