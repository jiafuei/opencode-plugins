// CCA rejects unknown schema fields. Convert JSON tool schemas to its supported
// subset, widening incompatible parameters without discarding their siblings.

type JsonObject = Record<string, unknown>;

/** A normalized node: only fields the CCA converter emits, with normalized children. */
type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  enum?: unknown[];
  [key: string]: unknown;
};

class UnrepresentableSchema extends Error {}

const CCA_FALLBACK_SCHEMA: Schema = { type: "object", properties: {} };

const SUPPORTED_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

const TYPE_SPECIFIC_KEYS = [
  "items", "minItems", "maxItems", "properties", "required",
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
    const resolved = visitingRefs.has(ref) ? undefined : resolveLocalRef(ref, root);
    // A cyclic or unresolvable ref widens to its siblings.
    if (!resolved) return dereferenceSchemaEntries(node, root, visitingRefs);
    visitingRefs.add(ref);
    const inlined = dereferenceNode(resolved, root, visitingRefs);
    visitingRefs.delete(ref);
    return { allOf: [dereferenceSchemaEntries(node, root, visitingRefs), inlined] };
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
    const normalizedKey = key === "any_of" ? "anyOf" : key;
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

function normalizeNode(value: unknown): Schema {
  if (value === true) return {};
  if (!isPlainObject(value)) throw new UnrepresentableSchema("Expected a schema object");
  if (!Object.hasOwn(value, "any_of")) return normalizeObjectNode(value);
  // python-genai-style SDKs and MCP servers send any_of; it wins over anyOf.
  const { any_of: anyOf, ...rest } = value;
  return normalizeObjectNode({ ...rest, anyOf });
}

function normalizeSubschema(value: unknown): Schema {
  try {
    return normalizeNode(value);
  } catch (error) {
    if (!(error instanceof UnrepresentableSchema)) throw error;
    return {};
  }
}

function normalizeObjectNode(obj: JsonObject): Schema {
  let result: Schema = {};

  for (const [key, entry] of Object.entries(obj)) {
    switch (key) {
      case "default":
        result.default = entry;
        break;
      case "enum": // entries are literals, never walked as schemas
        if (Array.isArray(entry)) result.enum = entry;
        break;
      case "required":
        result.required = stringArray(entry);
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

  resolveTypeKeyword(result, obj.type);
  if (Object.hasOwn(obj, "const")) {
    if (result.enum && !result.enum.some((value) => Bun.deepEquals(value, obj.const, true))) {
      throw new UnrepresentableSchema("Conflicting const and enum constraints");
    }
    result.enum = [obj.const];
  }
  finalizeEnum(result);

  for (const entry of Array.isArray(obj.allOf) ? obj.allOf : []) {
    const branch = normalizeNode(entry);
    // A branch may require names whose properties a later branch declares.
    // Keep them until the full intersection is built.
    const required = stringArray((entry as JsonObject).required);
    if (required.length > 0) branch.required = required;
    result = intersectAllOfSchemas(result, branch);
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(obj[key])) result = collapseUnion(result, obj[key].map(normalizeSubschema));
  }
  finalizeStructure(result);
  if (obj.nullable === true && result.type !== "null") {
    delete result.type;
    delete result.enum;
    for (const key of TYPE_SPECIFIC_KEYS) delete result[key];
  }
  return result;
}

function intersectAllOfSchemas(left: Schema, right: Schema): Schema {
  if (Object.keys(left).length === 0) return { ...right };
  if (Object.keys(right).length === 0) return { ...left };
  if (
    left.type !== undefined &&
    right.type !== undefined &&
    left.type !== right.type &&
    ![left.type, right.type].every((type) => type === "number" || type === "integer")
  ) {
    throw new UnrepresentableSchema("Conflicting allOf types");
  }

  const result: Schema = { ...left };
  if (result.type === undefined && right.type !== undefined) result.type = right.type;
  if (left.type === "number" && right.type === "integer") result.type = "integer";

  const rightEnum = right.enum;
  if (rightEnum) {
    result.enum = left.enum ? left.enum.filter((value) => rightEnum.includes(value)) : rightEnum;
    if (result.enum.length === 0) throw new UnrepresentableSchema("Conflicting allOf enums");
  }

  if (left.properties || right.properties) {
    const properties = { ...left.properties };
    for (const [name, schema] of Object.entries(right.properties ?? {})) {
      setOwn(
        properties,
        name,
        Object.hasOwn(properties, name) ? intersectAllOfPropertySchemas(properties[name]!, schema) : schema,
      );
    }
    result.type = "object";
    result.properties = properties;
  }
  const required = [...new Set([...(left.required ?? []), ...(right.required ?? [])])];
  if (required.length > 0) result.required = required;

  if (right.items) result.items = left.items ? intersectAllOfPropertySchemas(left.items, right.items) : right.items;

  for (const key of ["description", "default", "format", "pattern"] as const) {
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

function intersectAllOfPropertySchemas(left: Schema, right: Schema): Schema {
  if (Bun.deepEquals(left, right, true)) return left;
  try {
    return intersectAllOfSchemas(left, right);
  } catch (error) {
    if (!(error instanceof UnrepresentableSchema)) throw error;
    return {};
  }
}

/** Keep representable type unions; otherwise widen without inferring a branch's type. */
function resolveTypeKeyword(result: Schema, raw: unknown): void {
  const types = [...new Set((Array.isArray(raw) ? raw : [raw])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.toLowerCase())
    .filter((entry) => SUPPORTED_TYPES.has(entry)))];
  if (types.length === 1) result.type = types[0];
  else if (types.length > 1 && types.every((type) => type === "number" || type === "integer")) result.type = "number";
  else if (types.length > 1) for (const key of TYPE_SPECIFIC_KEYS) delete result[key];
}

/**
 * Intersect a node with its anyOf/oneOf union. Same-type branches keep shared
 * fields, enum members, and unioned object properties; mixed types widen
 * instead of selecting one branch.
 */
function collapseUnion(node: Schema, variants: Schema[]): Schema {
  if (variants.length === 0 || variants.some((variant) => Object.keys(variant).length === 0)) return node;
  const types = new Set(variants.map((variant) => variant.type));
  if (types.size > 1) {
    if (![...types].every((type) => type === "number" || type === "integer")) return node;
    variants = variants.map((variant) => ({ ...variant, type: "number" }));
  }
  const [first, ...rest] = variants as [Schema, ...Schema[]];
  if (first.type === undefined) return node;

  const union: Schema = {};
  for (const [field, value] of Object.entries(first)) {
    if (rest.every((variant) => Bun.deepEquals(variant[field], value, true))) union[field] = value;
  }
  if (variants.every((variant) => variant.enum)) union.enum = [...new Set(variants.flatMap((variant) => variant.enum!))];
  if (first.type === "object") {
    const properties: Record<string, Schema> = {};
    // A branch without properties accepts any object, absorbing the others.
    if (variants.every((variant) => Object.keys(variant.properties!).length > 0)) {
      for (const variant of variants) {
        for (const [name, schema] of Object.entries(variant.properties!)) {
          const shared = Object.hasOwn(properties, name) && !Bun.deepEquals(properties[name], schema, true);
          setOwn(properties, name, shared ? collapseUnion({}, [properties[name]!, schema]) : schema);
        }
      }
    }
    union.properties = properties;
    const required = (first.required ?? []).filter((name) => rest.every((variant) => variant.required?.includes(name)));
    if (required.length > 0) union.required = required;
  }
  return intersectAllOfSchemas(node, union);
}

/**
 * Encode the final enum for the wire: CCA's Schema proto declares enum as
 * repeated string even for numeric/boolean schema types, so finite numbers and
 * booleans are stringified while their (declared or inferred) type is kept. An
 * enum containing null/non-scalar/unrepresentable values is dropped entirely
 * rather than narrowed; a typeless scalar enum gets its type inferred.
 */
function finalizeEnum(result: Schema): void {
  const values = result.enum;
  if (!values) return;

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

  if (result.type === undefined) {
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
function finalizeStructure(result: Schema): void {
  if (result.type === undefined) {
    if (result.properties || result.required) result.type = "object";
    else if (result.items) result.type = "array";
  }
  const properties = result.properties ?? {};
  const required = [...new Set(result.required)].filter((name) => Object.hasOwn(properties, name));
  if (required.length > 0) result.required = required;
  else delete result.required;
  if (result.type === "object") {
    result.properties ??= {};
    delete result.items;
  } else {
    delete result.properties;
    delete result.required;
    if (result.type !== "array") delete result.items;
  }
}

/**
 * Normalize one tool parameter schema for Cloud Code Assist. Malformed input
 * or an unrepresentable root returns the object fallback. Nested failures are
 * repaired at property, item, and union-branch boundaries.
 */
export function normalizeSchemaForCCA(value: unknown): Schema {
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
function toNativeSchema(node: Schema): JsonObject {
  const result: JsonObject = {};
  if (node.type !== undefined) result.type = node.type.toUpperCase();
  if (node.format !== undefined) result.format = node.format;
  if (node.description !== undefined) result.description = node.description;
  if (node.default !== undefined) result.default = node.default;
  if (node.items) result.items = toNativeSchema(node.items);
  if (node.minItems !== undefined) result.minItems = String(node.minItems);
  if (node.maxItems !== undefined) result.maxItems = String(node.maxItems);
  if (node.enum !== undefined) result.enum = node.enum;
  if (node.properties) {
    result.properties = Object.fromEntries(
      Object.entries(node.properties).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, schema]) => [name, toNativeSchema(schema)]),
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
