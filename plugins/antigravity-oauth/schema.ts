// CCA rejects unknown schema fields. Convert JSON tool schemas to its supported
// subset, widening incompatible parameters without discarding their siblings.

type JsonObject = Record<string, unknown>;

class UnrepresentableSchema extends Error {}

const CCA_FALLBACK_SCHEMA: JsonObject = { type: "object", properties: {} };

/** snake_case keys used by python-genai-style SDKs and MCP servers. */
const SNAKE_TO_CAMEL_RENAMES: Record<string, string> = {
  additional_properties: "additionalProperties",
  any_of: "anyOf",
  prefix_items: "prefixItems",
  property_ordering: "propertyOrdering",
};

const SUPPORTED_TYPES: Readonly<Record<string, true>> = {
  string: true,
  number: true,
  integer: true,
  boolean: true,
  object: true,
  array: true,
  null: true,
};

const TYPE_SPECIFIC_KEYS = [
  "items", "minItems", "maxItems", "properties", "required", "propertyOrdering",
  "format", "pattern", "minLength", "maxLength", "minimum", "maximum",
] as const;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function setOwn(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

/**
 * Resolve a local pointer-style `$ref` against the root schema's `$defs` or
 * `definitions` block. Handles escaped pointer segments (`~1` → `/`,
 * `~0` → `~`). Returns undefined for external or unresolvable refs.
 */
function resolveLocalRef(ref: string, root: JsonObject): JsonObject | undefined {
  const match = /^#\/(\$defs|definitions)(\/.+)?$/.exec(ref);
  if (!match) return undefined;
  let node: unknown = root[match[1]!];
  if (match[2]) {
    for (const rawSegment of match[2]!.slice(1).split("/")) {
      const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!isPlainObject(node) || !Object.hasOwn(node, segment)) return undefined;
      node = node[segment];
    }
  }
  return isPlainObject(node) ? node : undefined;
}

/** Inline local refs while never descending into enum/default/example literals. */
function dereferenceNode(
  node: unknown,
  root: JsonObject,
  visitingRefs: Set<string>,
): unknown {
  if (!isPlainObject(node)) return node;
  const ref = node.$ref;
  if (typeof ref === "string") {
    if (visitingRefs.has(ref)) return {};
    const resolved = resolveLocalRef(ref, root);
    if (!resolved) return node;
    visitingRefs.add(ref);
    const inlined = dereferenceNode(resolved, root, visitingRefs);
    visitingRefs.delete(ref);
    const siblings = dereferenceSchemaEntries(node, root, visitingRefs);
    return { allOf: [siblings, inlined] };
  }
  return dereferenceSchemaEntries(node, root, visitingRefs);
}

function dereferenceSchemaEntries(
  node: JsonObject,
  root: JsonObject,
  visitingRefs: Set<string>,
): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$defs" || key === "definitions" || key === "$ref") continue;
    const normalizedKey = SNAKE_TO_CAMEL_RENAMES[key] ?? key;
    if (normalizedKey === "properties" && isPlainObject(value)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, dereferenceNode(schema, root, visitingRefs)]));
      continue;
    }
    if (["anyOf", "oneOf", "allOf"].includes(normalizedKey) && Array.isArray(value)) {
      result[key] = value.map((entry) => dereferenceNode(entry, root, visitingRefs));
      continue;
    }
    if (normalizedKey === "items") {
      result[key] = dereferenceNode(value, root, visitingRefs);
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * Rename known snake_case schema keys (python-genai collision rule: snake wins
 * over an existing camelCase entry). Only applied at schema nodes; property
 * map iteration never renames arbitrary property names.
 */
function renameSnakeKeys(obj: JsonObject): JsonObject {
  if (!Object.keys(obj).some((key) => Object.hasOwn(SNAKE_TO_CAMEL_RENAMES, key))) return obj;
  const out: JsonObject = {};
  for (const key of Object.keys(obj)) {
    const renamed = SNAKE_TO_CAMEL_RENAMES[key];
    if (renamed !== undefined) setOwn(out, renamed, obj[key]);
    else if (!Object.hasOwn(out, key)) setOwn(out, key, obj[key]);
  }
  return out;
}

function normalizeNode(value: unknown): JsonObject {
  if (value === true) return {};
  if (!isPlainObject(value)) throw new UnrepresentableSchema("Expected a schema object");
  return normalizeObjectNode(renameSnakeKeys(value));
}

function normalizeSubschema(value: unknown): JsonObject {
  try {
    return normalizeNode(value);
  } catch (error) {
    if (!(error instanceof UnrepresentableSchema)) throw error;
    return {};
  }
}

function normalizeObjectNode(obj: JsonObject): JsonObject {
  let result: JsonObject = {};

  for (const [key, entry] of Object.entries(obj)) {
    switch (key) {
      case "type":
      case "default":
      case "enum": // entries are literals, never walked as schemas
        result[key] = entry;
        break;
      case "required":
      case "propertyOrdering":
        result[key] = stringArray(entry);
        break;
      case "properties":
        if (isPlainObject(entry)) result.properties = Object.fromEntries(Object.entries(entry).map(([name, schema]) => [name, normalizeSubschema(schema)]));
        break;
      case "items":
        // Tuple-form (array) items are not representable: omit them, widening.
        if (isPlainObject(entry) || typeof entry === "boolean") result.items = normalizeSubschema(entry);
        break;
      // A mistyped validator would fail the whole request's protojson parse: drop it.
      case "description":
      case "title":
      case "format":
      case "pattern":
        if (typeof entry === "string") result[key] = entry;
        break;
      case "minimum":
      case "maximum":
        if (Number.isFinite(entry)) result[key] = entry;
        break;
      case "minLength":
      case "maxLength":
      case "minItems":
      case "maxItems":
        if (Number.isSafeInteger(entry) && (entry as number) >= 0) result[key] = entry;
        break;
    }
  }

  resolveTypeKeyword(result);
  if (Object.hasOwn(obj, "const")) {
    if (Array.isArray(result.enum) && !result.enum.some((value) => Bun.deepEquals(value, obj.const, true))) {
      throw new UnrepresentableSchema("Conflicting const and enum constraints");
    }
    result.enum = [obj.const];
  }
  finalizeEnum(result);

  for (const entry of Array.isArray(obj.allOf) ? obj.allOf : []) {
    const branch = normalizeNode(entry);
    // A branch may declare required/order names while a later branch declares
    // their properties. Keep those names until the full intersection is built.
    if (isPlainObject(entry) && isPlainObject(branch)) {
      const source = renameSnakeKeys(entry);
      const required = [...new Set(stringArray(source.required))];
      const propertyOrdering = [...new Set(stringArray(source.propertyOrdering))];
      if (required.length > 0) branch.required = required;
      if (propertyOrdering.length > 0) branch.propertyOrdering = propertyOrdering;
    }
    result = intersectAllOfSchemas(result, branch);
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(obj[key])) result = collapseUnion(result, obj[key].map(normalizeNode));
  }
  finalizeEnum(result);
  finalizeStructure(result);
  if (obj.nullable === true && result.type !== "null") {
    delete result.type;
    delete result.enum;
    for (const key of TYPE_SPECIFIC_KEYS) delete result[key];
  }
  return result;
}

function intersectAllOfSchemas(left: JsonObject, right: JsonObject): JsonObject {
  if (Object.keys(left).length === 0) return { ...right };
  if (Object.keys(right).length === 0) return { ...left };
  if (
    typeof left.type === "string" &&
    typeof right.type === "string" &&
    left.type !== right.type
  ) {
    if (![left.type, right.type].every((type) => type === "number" || type === "integer")) {
      throw new UnrepresentableSchema("Conflicting allOf types");
    }
  }

  const result: JsonObject = { ...left };
  if (result.type === undefined && right.type !== undefined) result.type = right.type;
  if (left.type === "number" && right.type === "integer") result.type = "integer";

  if (Array.isArray(left.enum) || Array.isArray(right.enum)) {
    if (Array.isArray(left.enum) && Array.isArray(right.enum)) {
      const rightEnum = right.enum as unknown[];
      const intersection = left.enum.filter((value) => rightEnum.includes(value));
      if (intersection.length === 0) throw new UnrepresentableSchema("Conflicting allOf enums");
      result.enum = intersection;
    } else {
      result.enum = Array.isArray(left.enum) ? left.enum : right.enum;
    }
  }

  if (left.properties !== undefined || right.properties !== undefined) {
    if (
      (left.properties !== undefined && !isPlainObject(left.properties)) ||
      (right.properties !== undefined && !isPlainObject(right.properties))
    ) {
      throw new UnrepresentableSchema("Malformed allOf properties");
    }
    const properties: JsonObject = { ...(isPlainObject(left.properties) ? left.properties : {}) };
    for (const [name, schema] of Object.entries(isPlainObject(right.properties) ? right.properties : {})) {
      setOwn(
        properties,
        name,
        Object.hasOwn(properties, name) ? intersectAllOfPropertySchemas(properties[name], schema) : schema,
      );
    }
    result.type = "object";
    result.properties = properties;
    const required = new Set([...stringArray(left.required), ...stringArray(right.required)]);
    result.required = [...required];
  }

  if (left.items !== undefined && right.items !== undefined) {
    result.items = intersectAllOfPropertySchemas(left.items, right.items);
  } else if (result.items === undefined && right.items !== undefined) {
    result.items = right.items;
  }

  for (const key of [
    "title",
    "description",
    "default",
    "propertyOrdering",
    "format",
    "pattern",
  ] as const) {
    if (result[key] === undefined && right[key] !== undefined) result[key] = right[key];
  }
  for (const [minimum, maximum] of [["minimum", "maximum"], ["minLength", "maxLength"], ["minItems", "maxItems"]] as const) {
    if (typeof right[minimum] === "number") {
      result[minimum] = Math.max((left[minimum] as number | undefined) ?? -Infinity, right[minimum]);
    }
    if (typeof right[maximum] === "number") {
      result[maximum] = Math.min((left[maximum] as number | undefined) ?? Infinity, right[maximum]);
    }
    if (typeof result[minimum] === "number" && typeof result[maximum] === "number" && result[minimum] > result[maximum]) {
      throw new UnrepresentableSchema(`Conflicting allOf ${minimum}/${maximum}`);
    }
  }
  return result;
}

function intersectAllOfPropertySchemas(left: unknown, right: unknown): unknown {
  if (Bun.deepEquals(left, right, true)) return left;
  if (!isPlainObject(left) || !isPlainObject(right)) return {};
  try {
    return intersectAllOfSchemas(left, right);
  } catch (error) {
    if (!(error instanceof UnrepresentableSchema)) throw error;
    return {};
  }
}

/**
 * Merge two conflicting property schemas during an object-union merge:
 * identical shapes keep as-is; compatible enum schemas union their members;
 * anything else widens to `{}` rather than emitting a forbidden combiner.
 */
function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (Bun.deepEquals(existing, incoming, true)) return existing;
  if (
    isPlainObject(existing) &&
    isPlainObject(incoming) &&
    Array.isArray(existing.enum) &&
    Array.isArray(incoming.enum)
  ) {
    const { enum: leftEnum, ...left } = existing;
    const { enum: rightEnum, ...right } = incoming;
    if (Bun.deepEquals(left, right, true)) {
      return { ...left, enum: [...new Set([...(leftEnum as string[]), ...(rightEnum as string[])])] };
    }
  }
  return {};
}

/** Keep representable type unions; otherwise widen without inferring a branch's type. */
function resolveTypeKeyword(result: JsonObject): void {
  const raw = result.type;
  const types = [...new Set((Array.isArray(raw) ? raw : [raw])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase())
    .filter((entry) => Object.hasOwn(SUPPORTED_TYPES, entry)))];
  if (types.length === 1) result.type = types[0];
  else if (types.length > 1 && types.every((type) => type === "number" || type === "integer")) result.type = "number";
  else {
    delete result.type;
    if (types.length > 1) for (const key of TYPE_SPECIFIC_KEYS) delete result[key];
  }
}

/**
 * Collapse anyOf/oneOf to the supported field set. Object and same-type enum
 * unions retain structure; mixed types widen instead of selecting one branch.
 */
function collapseUnion(node: JsonObject, variants: JsonObject[]): JsonObject {
  if (variants.length === 0 || variants.some((variant) => Object.keys(variant).length === 0)) return node;
  if (variants.every((variant) => variant.type === "object")) {
    mergeObjectVariants(node, variants);
    return node;
  }

  const types = new Set(variants.map((variant) => variant.type));
  if (types.size > 1) {
    if (![...types].every((type) => type === "number" || type === "integer")) return node;
    variants = variants.map((variant) => ({ ...variant, type: "number" }));
  }
  const type = variants[0]!.type;
  if (type === undefined) return node;

  const collapsed: JsonObject = { type };
  for (const [field, value] of Object.entries(variants[0]!)) {
    if (field !== "enum" && variants.every((variant) => Bun.deepEquals(variant[field], value, true))) collapsed[field] = value;
  }
  if (variants.every((variant) => Array.isArray(variant.enum))) {
    collapsed.enum = [...new Set(variants.flatMap((variant) => variant.enum as string[]))];
  }
  return intersectAllOfSchemas(node, collapsed);
}

function mergeObjectVariants(node: JsonObject, variants: JsonObject[]): void {
  const ownProperties = isPlainObject(node.properties) ? node.properties : {};
  const broad = variants.find(
    (variant) =>
      isPlainObject(variant.properties) &&
      Object.keys(variant.properties).length === 0 &&
      stringArray(variant.required).length === 0,
  );
  if (broad) {
    node.type = "object";
    node.properties = { ...ownProperties };
    const parentRequired = stringArray(node.required).filter((name) => Object.hasOwn(ownProperties, name));
    if (parentRequired.length > 0) node.required = [...new Set(parentRequired)];
    else delete node.required;
    for (const key of ["title", "description", "default"] as const) {
      if (node[key] === undefined && broad[key] !== undefined) node[key] = broad[key];
    }
    return;
  }
  const props: JsonObject = { ...ownProperties };
  for (const variant of variants) {
    const variantProps = isPlainObject(variant.properties) ? variant.properties : {};
    for (const [name, schema] of Object.entries(variantProps)) {
      setOwn(props, name, Object.hasOwn(props, name) ? mergePropertySchemas(props[name], schema) : schema);
    }
  }

  let intersection: Set<string> | undefined;
  for (const variant of variants) {
    const required = new Set(stringArray(variant.required));
    if (!intersection) intersection = required;
    else intersection = new Set([...intersection].filter((name) => required.has(name)));
  }
  const safe = new Set<string>();
  for (const name of intersection ?? []) {
    if (Object.hasOwn(props, name)) safe.add(name);
  }
  // Parent-required names stay required only when present in both the parent's
  // own properties and the merged result (OMP's stale-required guard).
  for (const name of stringArray(node.required)) {
    if (Object.hasOwn(ownProperties, name) && Object.hasOwn(props, name)) safe.add(name);
  }

  node.type = "object";
  node.properties = props;
  const ordered = Object.keys(props).filter((name) => safe.has(name));
  if (ordered.length > 0) node.required = ordered;
  else delete node.required;
}

/**
 * Encode the final enum for the wire: CCA's Schema proto declares enum as
 * repeated string even for numeric/boolean schema types, so finite numbers and
 * booleans are stringified while their (declared or inferred) type is kept. An
 * enum containing null/non-scalar/unrepresentable values is dropped entirely
 * rather than narrowed; a typeless scalar enum gets its type inferred.
 */
function finalizeEnum(result: JsonObject): void {
  if (!("enum" in result)) return;
  const values = Array.isArray(result.enum) ? result.enum : [];

  if (values.length > 0 && values.every((value) => value === null)) {
    result.type ??= "null";
    delete result.enum;
    return;
  }

  const scalar = values.every(
    (value) =>
      typeof value === "string" ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value)),
  );
  if (values.length === 0 || !scalar) {
    delete result.enum; // contains null/object/array/non-finite: unrepresentable
    return;
  }

  if (!("type" in result)) {
    const inferred = new Set(values.map((value) => typeof value));
    if (inferred.size !== 1) {
      delete result.enum; // mixed scalar kinds cannot pick one type: drop, don't narrow
      return;
    }
    result.type = typeof values[0];
  }
  if (result.type === "null") {
    delete result.enum;
    return;
  }
  result.enum = [...new Set(values.map(String))];
}

/** Post-collapse shape guarantees: clean required, object properties, item form. */
function finalizeStructure(result: JsonObject): void {
  if (result.type === undefined) {
    if (isPlainObject(result.properties) || Array.isArray(result.required) || Array.isArray(result.propertyOrdering)) {
      result.type = "object";
    } else if (isPlainObject(result.items)) {
      result.type = "array";
    }
  }
  for (const key of ["required", "propertyOrdering"] as const) {
    const properties = isPlainObject(result.properties) ? result.properties : {};
    const names = [...new Set(stringArray(result[key]))].filter((name) => Object.hasOwn(properties, name));
    if (names.length > 0) result[key] = names;
    else delete result[key];
  }
  if (result.type === "object") {
    if (!isPlainObject(result.properties)) result.properties = {};
    delete result.items;
  } else {
    delete result.properties;
    delete result.required;
    delete result.propertyOrdering;
    if (result.type !== "array") delete result.items;
  }
}

/**
 * Normalize one tool parameter schema for Cloud Code Assist. Malformed input
 * or an unrepresentable root returns the object fallback. Nested failures are
 * repaired at property and item boundaries.
 */
export function normalizeSchemaForCCA(value: unknown): JsonObject {
  try {
    if (isPlainObject(value) && (value.$defs !== undefined || value.definitions !== undefined)) {
      value = dereferenceNode(value, value, new Set());
    }
    return normalizeNode(value);
  } catch (error) {
    if (!(error instanceof UnrepresentableSchema)) throw error;
    return { ...CCA_FALLBACK_SCHEMA };
  }
}

/**
 * Function-declaration parameters must be object-rooted even when a scalar
 * schema is otherwise valid. The result is in the native client's protojson
 * shape.
 */
export function normalizeToolSchemaForCCA(value: unknown): unknown {
  const normalized = normalizeSchemaForCCA(value);
  return toNativeSchema(
    normalized.type === "object" ? normalized : CCA_FALLBACK_SCHEMA,
  );
}

/**
 * The native schema converter's output: enum-name types, fields in Schema
 * proto order, sorted property maps, int64 bounds as protojson strings, and
 * no `title`/`propertyOrdering` (the converter never sets them).
 */
function toNativeSchema(node: JsonObject): JsonObject {
  const result: JsonObject = {};
  if (typeof node.type === "string") result.type = node.type.toUpperCase();
  if (node.format !== undefined) result.format = node.format;
  if (node.description !== undefined) result.description = node.description;
  if (node.default !== undefined) result.default = node.default;
  if (isPlainObject(node.items)) result.items = toNativeSchema(node.items);
  if (node.minItems !== undefined) result.minItems = String(node.minItems);
  if (node.maxItems !== undefined) result.maxItems = String(node.maxItems);
  if (node.enum !== undefined) result.enum = node.enum;
  if (isPlainObject(node.properties)) {
    const properties = node.properties;
    result.properties = Object.fromEntries(
      Object.keys(properties).sort().map((name) => [name, toNativeSchema(properties[name] as JsonObject)]),
    );
  }
  if (node.required !== undefined) result.required = node.required;
  if (node.minimum !== undefined) result.minimum = node.minimum;
  if (node.maximum !== undefined) result.maximum = node.maximum;
  if (node.minLength !== undefined) result.minLength = String(node.minLength);
  if (node.maxLength !== undefined) result.maxLength = String(node.maxLength);
  if (node.pattern !== undefined) result.pattern = node.pattern;
  return result;
}
