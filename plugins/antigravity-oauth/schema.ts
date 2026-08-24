/**
 * Tool-schema normalization for the Cloud Code Assist (`daily-cloudcode-pa`)
 * Schema proto, ported from oh-my-pi's `utils/schema` CCA profile.
 *
 * CCA protojson rejects unknown Schema fields outright ("Cannot find field"),
 * so normalization is driven by an explicit output-key allowlist rather than a
 * blacklist: local JSON Pointer `$ref`s are inlined from `$defs`/`definitions`,
 * snake_case SDK/MCP keys are renamed, validators/annotations the wire cannot
 * express are stripped, unions are collapsed to one representable schema, and
 * the final tree is structurally validated — a malformed or unrepresentable
 * tool falls back to an empty object schema so one bad tool cannot 400 the
 * whole request.
 */

type JsonObject = Record<string, unknown>;

/** Safe terminal schema for tools whose parameters cannot be represented. */
const CCA_FALLBACK_SCHEMA: JsonObject = { type: "object", properties: {} };

/** snake_case keys used by python-genai-style SDKs and MCP servers. */
const SNAKE_TO_CAMEL_RENAMES: Record<string, string> = {
  additional_properties: "additionalProperties",
  any_of: "anyOf",
  prefix_items: "prefixItems",
  property_ordering: "propertyOrdering",
};

/** Type names the CCA Schema proto understands (never "null" on this wire). */
const SUPPORTED_TYPES: Readonly<Record<string, true>> = {
  string: true,
  number: true,
  integer: true,
  boolean: true,
  object: true,
  array: true,
};

/**
 * Keys permitted on the final CCA wire schema; everything else is stripped.
 * This allowlist is the single source of truth for wire safety: meta/reference
 * keywords ($schema/$ref/$defs/$comment/...), annotations (deprecated,
 * readOnly, writeOnly), MCP transport annotations (x-mcp-header), object-key
 * validators (additionalProperties, propertyNames), and value validators
 * (pattern, format, min/max bounds) all fail it and are dropped.
 */
const OUTPUT_KEYS: Readonly<Record<string, true>> = {
  type: true,
  description: true,
  title: true,
  default: true,
  enum: true,
  properties: true,
  required: true,
  propertyOrdering: true,
  items: true,
};

/** Output keys valid on every type (subset of OUTPUT_KEYS). */
const SHARED_KEYS: Readonly<Record<string, true>> = {
  title: true,
  description: true,
  default: true,
  enum: true,
};

/** Type-specific output keys that survive normalization per chosen type. */
const TYPE_KEYS: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  array: { items: true },
  object: { properties: true, required: true, propertyOrdering: true },
  string: {},
  number: {},
  integer: {},
  boolean: {},
};

/** Flat set of every type-specific key across types. */
const ALL_TYPE_KEYS: Readonly<Record<string, true>> = buildAllTypeKeys();

function buildAllTypeKeys(): Record<string, true> {
  const all: Record<string, true> = {};
  for (const keys of Object.values(TYPE_KEYS)) {
    for (const key in keys) all[key] = true;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Small JSON helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function setOwn(target: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

/** Deep structural equality of two JSON-shaped values. */
function jsonEquals(left: unknown, right: unknown, seen = new Map<object, Set<object>>()): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    let rights = seen.get(left);
    if (rights?.has(right)) return true;
    if (!rights) seen.set(left, (rights = new Set()));
    rights.add(right);
    return left.every((entry, i) => jsonEquals(entry, right[i], seen));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  let rights = seen.get(left);
  if (rights?.has(right)) return true;
  if (!rights) seen.set(left, (rights = new Set()));
  rights.add(right);
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && jsonEquals(left[key], right[key], seen));
}

// ---------------------------------------------------------------------------
// $ref dereferencing (local JSON Pointers into $defs / definitions)
// ---------------------------------------------------------------------------

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

const SINGLE_SUBSCHEMA_KEYS: Readonly<Record<string, true>> = {
  items: true,
  not: true,
  if: true,
  then: true,
  else: true,
  contains: true,
  propertyNames: true,
  contentSchema: true,
};

const SUBSCHEMA_ARRAY_KEYS: Readonly<Record<string, true>> = {
  anyOf: true,
  oneOf: true,
  allOf: true,
  prefixItems: true,
};

/** Inline local refs while never descending into enum/default/example literals. */
function dereferenceNode(
  node: unknown,
  root: JsonObject,
  visitingRefs: Set<string>,
  visitingObjects: Set<object>,
): unknown {
  if (!isPlainObject(node)) return node;
  if (visitingObjects.has(node)) return {};
  visitingObjects.add(node);
  try {
    const ref = node["$ref"];
    if (typeof ref === "string") {
      if (visitingRefs.has(ref)) return {};
      const resolved = resolveLocalRef(ref, root);
      if (!resolved) return node;
      visitingRefs.add(ref);
      const inlined = dereferenceNode(resolved, root, visitingRefs, visitingObjects);
      visitingRefs.delete(ref);
      if (!isPlainObject(inlined)) return inlined;
      const siblings = dereferenceSchemaEntries(node, root, visitingRefs, visitingObjects, true);
      return { ...inlined, ...siblings };
    }
    return dereferenceSchemaEntries(node, root, visitingRefs, visitingObjects, false);
  } finally {
    visitingObjects.delete(node);
  }
}

function dereferenceSchemaEntries(
  node: JsonObject,
  root: JsonObject,
  visitingRefs: Set<string>,
  visitingObjects: Set<object>,
  skipRef: boolean,
): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$defs" || key === "definitions" || (skipRef && key === "$ref")) continue;
    const normalizedKey = SNAKE_TO_CAMEL_RENAMES[key] ?? key;
    if (normalizedKey === "properties" || normalizedKey === "patternProperties" || normalizedKey === "dependentSchemas") {
      if (!isPlainObject(value)) {
        result[key] = value;
        continue;
      }
      const map: JsonObject = {};
      for (const [name, subschema] of Object.entries(value)) {
        setOwn(map, name, dereferenceNode(subschema, root, visitingRefs, visitingObjects));
      }
      result[key] = map;
      continue;
    }
    if (Object.hasOwn(SUBSCHEMA_ARRAY_KEYS, normalizedKey) && Array.isArray(value)) {
      result[key] = value.map((entry) => dereferenceNode(entry, root, visitingRefs, visitingObjects));
      continue;
    }
    if (
      Object.hasOwn(SINGLE_SUBSCHEMA_KEYS, normalizedKey) ||
      (normalizedKey === "additionalProperties" && isPlainObject(value))
    ) {
      result[key] = dereferenceNode(value, root, visitingRefs, visitingObjects);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function dereferenceJsonSchema(schema: unknown): unknown {
  if (!isPlainObject(schema)) return schema;
  if (schema["$defs"] === undefined && schema["definitions"] === undefined) return schema;
  return dereferenceNode(schema, schema, new Set(), new Set());
}

// ---------------------------------------------------------------------------
// Normalization walk
// ---------------------------------------------------------------------------

/**
 * Rename known snake_case schema keys (python-genai collision rule: snake wins
 * over an existing camelCase entry). Only applied at schema nodes; property
 * map iteration never renames arbitrary property names.
 */
function renameSnakeKeys(obj: JsonObject): JsonObject {
  let needsRename = false;
  for (const key of Object.keys(obj)) {
    if (Object.hasOwn(SNAKE_TO_CAMEL_RENAMES, key)) {
      needsRename = true;
      break;
    }
  }
  if (!needsRename) return obj;
  const out: JsonObject = {};
  for (const key of Object.keys(obj)) {
    const renamed = SNAKE_TO_CAMEL_RENAMES[key];
    if (renamed !== undefined) setOwn(out, renamed, obj[key]);
    else if (!Object.hasOwn(out, key)) setOwn(out, key, obj[key]);
  }
  return out;
}

function normalizeNode(value: unknown, visiting: Set<object>): unknown {
  // A bare boolean is a JSON Schema subschema only in subschema slots, which
  // is where this function is called. `true` is open; `false` cannot be
  // represented without CCA's forbidden `not`, so fail the whole tool safely.
  if (value === true) return {};
  if (value === false) throw new Error("False schemas are not representable by CCA");
  if (typeof value !== "object" || value === null) return value; // malformed: caught by validation
  if (visiting.has(value)) return {}; // cyclic JS object graph: widen
  visiting.add(value);
  try {
    return normalizeObjectNode(renameSnakeKeys(value as JsonObject), visiting);
  } finally {
    visiting.delete(value);
  }
}

function normalizePropertiesMap(map: unknown, visiting: Set<object>): JsonObject | undefined {
  if (!isPlainObject(map)) return undefined;
  const result: JsonObject = {};
  for (const [name, subschema] of Object.entries(map)) {
    // Property names are literal payload keys, not schema keywords.
    setOwn(result, name, normalizeNode(subschema, visiting));
  }
  return result;
}

function normalizeObjectNode(obj: JsonObject, visiting: Set<object>): JsonObject {
  const result: JsonObject = {};
  const unions: Partial<Record<"anyOf" | "oneOf", unknown[]>> = {};
  const allOfEntries: unknown[] = [];
  let constValue: unknown;
  let hasConst = false;

  for (const [key, entry] of Object.entries(obj)) {
    if (key === "anyOf" || key === "oneOf") {
      if (Array.isArray(entry)) unions[key] = entry;
      continue;
    }
    if (key === "allOf") {
      if (Array.isArray(entry)) allOfEntries.push(...entry);
      continue;
    }
    if (key === "const") {
      constValue = entry;
      hasConst = true;
      continue;
    }
    // Nullability is dropped outright on this wire; `not` has no field.
    if (key === "nullable" || key === "not") continue;

    switch (key) {
      case "type":
      case "description":
      case "title":
      case "default":
      case "enum": // entries are literals, never walked as schemas
      case "required":
      case "propertyOrdering":
        result[key] = entry;
        break;
      case "properties":
        if (isPlainObject(entry)) result.properties = normalizePropertiesMap(entry, visiting);
        break;
      case "items":
        // Tuple-form (array) items are not representable: omit them, widening.
        if (isPlainObject(entry) || typeof entry === "boolean") result.items = normalizeNode(entry, visiting);
        break;
      default:
        break; // everything else fails the OUTPUT_KEYS allowlist: stripped
    }
  }

  // allOf intersection: inline branches before union collapsing so merged
  // results participate in collapse. Never becomes anyOf.
  for (const entry of allOfEntries) {
    const branch = normalizeNode(entry, visiting);
    // A branch may declare required/order names while a later branch declares
    // their properties. Keep those names until the full intersection is built.
    if (isPlainObject(entry) && isPlainObject(branch)) {
      const source = renameSnakeKeys(entry);
      const required = [...new Set(stringArray(source.required))];
      const propertyOrdering = [...new Set(stringArray(source.propertyOrdering))];
      if (required.length > 0) branch.required = required;
      if (propertyOrdering.length > 0) branch.propertyOrdering = propertyOrdering;
    }
    mergeAllOfBranch(result, branch);
  }

  if (hasConst) applyConst(result, constValue);
  resolveTypeKeyword(result);
  collapseUnionsFixpoint(result, unions, visiting);
  finalizeEnum(result);
  finalizeStructure(result);
  return result;
}

/** Merge a normalized allOf branch into the node without weakening conflicts. */
function mergeAllOfBranch(node: JsonObject, branch: unknown): void {
  if (!isPlainObject(branch)) throw new Error("Malformed allOf branch");
  replaceNodeKeys(node, intersectAllOfSchemas(node, branch));
}

function intersectAllOfSchemas(left: JsonObject, right: JsonObject): JsonObject {
  if (Object.keys(left).length === 0) return { ...right };
  if (Object.keys(right).length === 0) return { ...left };
  if (
    typeof left.type === "string" &&
    typeof right.type === "string" &&
    left.type !== right.type
  ) {
    throw new Error("Conflicting allOf types");
  }

  const result: JsonObject = { ...left };
  if (result.type === undefined && right.type !== undefined) result.type = right.type;

  if (Array.isArray(left.enum) || Array.isArray(right.enum)) {
    if (Array.isArray(left.enum) && Array.isArray(right.enum)) {
      const rightEnum = right.enum as unknown[];
      const intersection = left.enum.filter((value) => rightEnum.some((candidate) => jsonEquals(value, candidate)));
      if (intersection.length === 0) throw new Error("Conflicting allOf enums");
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
      throw new Error("Malformed allOf properties");
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

  for (const key of ["title", "description", "default", "propertyOrdering"] as const) {
    if (result[key] === undefined && right[key] !== undefined) result[key] = right[key];
  }
  return result;
}

function intersectAllOfPropertySchemas(left: unknown, right: unknown): unknown {
  if (jsonEquals(left, right)) return left;
  if (!isPlainObject(left) || !isPlainObject(right)) throw new Error("Malformed allOf property");
  return intersectAllOfSchemas(left, right);
}

/**
 * Merge two conflicting property schemas during an object-union merge:
 * identical shapes keep as-is; compatible enum schemas union their members;
 * anything else widens to `{}` rather than emitting a forbidden combiner.
 */
function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (jsonEquals(existing, incoming)) return existing;
  if (
    isPlainObject(existing) &&
    isPlainObject(incoming) &&
    Array.isArray(existing.enum) &&
    Array.isArray(incoming.enum)
  ) {
    const rest = Object.keys(existing).filter((key) => key !== "enum");
    const sameShape =
      rest.length === Object.keys(incoming).filter((key) => key !== "enum").length &&
      rest.every(
        (key) =>
          key !== "enum" && Object.hasOwn(incoming, key) && !Array.isArray(incoming[key]) && jsonEquals(existing[key], incoming[key]),
      );
    if (sameShape) {
      const mergedEnum = [...(existing.enum as unknown[])];
      for (const value of incoming.enum as unknown[]) {
        if (!mergedEnum.some((candidate) => jsonEquals(candidate, value))) mergedEnum.push(value);
      }
      return { ...existing, enum: mergedEnum };
    }
  }
  return {}; // unrepresentable intersection: widen the property
}

function applyConst(result: JsonObject, constValue: unknown): void {
  if (Array.isArray(result.enum)) {
    if (!result.enum.some((candidate) => jsonEquals(candidate, constValue))) {
      throw new Error("Conflicting const and enum constraints");
    }
  }
  result.enum = [constValue];
}

/** Reduce type arrays/null tokens to one supported non-null scalar type name. */
function resolveTypeKeyword(result: JsonObject): void {
  const raw = result.type;
  if (Array.isArray(raw)) {
    const types = raw.filter(
      (entry): entry is string => typeof entry === "string" && Object.hasOwn(SUPPORTED_TYPES, entry),
    );
    const nonNull = types.filter((entry) => entry !== "null");
    if (nonNull.length > 0) result.type = nonNull[0];
    else delete result.type; // pure-null or empty array: widen
    return;
  }
  if (typeof raw !== "string" || !Object.hasOwn(SUPPORTED_TYPES, raw)) delete result.type; // "null"/unknown token: widen
}

// ---------------------------------------------------------------------------
// Union collapsing (anyOf / oneOf must not survive anywhere)
// ---------------------------------------------------------------------------

interface CollapseOutcome {
  applied: boolean;
  stuck?: boolean;
}

/**
 * Repeatedly collapse anyOf/oneOf until stable. Strategies in order: bare-null
 * extraction, ⊤ (empty) branch absorption, bare-const folding, object-union
 * merging, mixed-type narrowing, same-type picking. When no strategy applies
 * the combiner stays and final validation falls back.
 */
function collapseUnionsFixpoint(
  node: JsonObject,
  unions: Partial<Record<"anyOf" | "oneOf", unknown[]>>,
  visiting: Set<object>,
): void {
  for (const key of ["anyOf", "oneOf"] as const) {
    const rawList = unions[key];
    if (!rawList) continue;
    // Bare {type:"null"} variants must be extracted before branch
    // normalization (which widens them to {}) so X|null collapses to X.
    const kept = rawList.filter((entry) => !isRawNullSchema(entry));
    if (kept.length === rawList.length) {
      node[key] = rawList.map((branch) => normalizeNode(branch, visiting));
    } else if (kept.length === 0) {
      // Pure-null union: unconstrained on this wire.
    } else if (kept.length === 1) {
      const sole = normalizeNode(kept[0], visiting);
      if (!isPlainObject(sole) || !adoptBranchKeys(node, key, sole)) {
        node[key] = [sole]; // unadoptable: leave for the fixpoint/validator
      }
    } else {
      node[key] = kept.map((branch) => normalizeNode(branch, visiting));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const key of ["anyOf", "oneOf"] as const) {
      const outcome = collapseOneUnion(node, key);
      if (outcome.applied) changed = true;
      if (outcome.stuck) return; // residual combiner: validator will fall back
    }
  }
}

function isRawNullSchema(value: unknown): boolean {
  return isPlainObject(value) && value["type"] === "null";
}

/** Collapse one step of `node[key]`; returns whether progress was made. */
function collapseOneUnion(node: JsonObject, key: "anyOf" | "oneOf"): CollapseOutcome {
  if (!(key in node)) return { applied: false };
  const raw = node[key];
  if (!Array.isArray(raw)) {
    delete node[key];
    return { applied: true };
  }
  if (raw.length === 0) {
    delete node[key];
    return { applied: true };
  }
  const variants: JsonObject[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return { applied: false, stuck: true }; // malformed branch
    variants.push(entry);
  }

  // ⊤ branch: a fully-empty variant admits anything (or is a widened
  // {type:"null"} already extracted upstream), so the whole union does.
  if (variants.some((variant) => Object.keys(variant).length === 0)) {
    delete node[key];
    return { applied: true };
  }

  // Every branch a bare const: fold into a deduplicated typed enum.
  if (variants.every((variant) => "const" in variant)) {
    const values: unknown[] = [];
    for (const variant of variants) {
      if (!values.some((candidate) => jsonEquals(candidate, variant.const))) values.push(variant.const);
    }
    const existing = Array.isArray(node.enum) ? (node.enum as unknown[]) : [];
    for (const value of values) {
      if (!existing.some((candidate) => jsonEquals(candidate, value))) existing.push(value);
    }
    delete node[key];
    node.enum = existing;
    if (!("type" in node)) {
      const inferredTypes = [...new Set(values.map(jsonTypeOf).filter((t) => t !== "null"))];
      if (inferredTypes.length === 1) node.type = inferredTypes[0];
    }
    return { applied: true };
  }

  // Object union: merge properties, intersect required across variants.
  if (variants.every(isObjectShapeVariant)) {
    delete node[key];
    mergeObjectVariants(node, variants);
    return { applied: true };
  }

  const mixed = tryMixedTypeCollapse(node, key, variants);
  if (mixed) return { applied: true };
  if (mixed === false) return { applied: false, stuck: true };

  const same = trySameTypeCollapse(node, key, variants);
  if (same) return { applied: true };
  if (same === false) return { applied: false, stuck: true };

  return { applied: false }; // nothing applicable this pass
}

function isObjectShapeVariant(variant: JsonObject): boolean {
  if (variant.type === "object") return true;
  if (variant.type !== undefined) return false;
  return isPlainObject(variant.properties) || Array.isArray(variant.required);
}

/**
 * Adopt a sole non-null branch's keys into the parent (X|null ≡ X). Parent
 * sibling keys win; conflicting values bail so the residual combiner falls
 * back instead of being silently narrowed.
 */
function adoptBranchKeys(node: JsonObject, key: "anyOf" | "oneOf", branch: JsonObject): boolean {
  for (const [k, value] of Object.entries(branch)) {
    if (!(k in node)) continue;
    if (jsonEquals(node[k], value)) continue;
    if (k === "description" && typeof node.description === "string" && typeof value === "string") continue;
    return false;
  }
  delete node[key];
  for (const [k, value] of Object.entries(branch)) {
    if (k in node) continue;
    node[k] = value;
  }
  return true;
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
 * Mixed-type union with distinct supported types whose fields each fit their
 * own type: pick the first non-null type and keep only fields valid for it.
 * Returns true (collapsed), false (conflict → residual), undefined (n/a).
 */
function tryMixedTypeCollapse(node: JsonObject, key: "anyOf" | "oneOf", variants: JsonObject[]): boolean | undefined {
  const types: string[] = [];
  for (const variant of variants) {
    const variantType = variant.type;
    if (typeof variantType !== "string" || !Object.hasOwn(SUPPORTED_TYPES, variantType)) return undefined;
    if (types.includes(variantType)) return undefined; // duplicate type: same-type path
    types.push(variantType);
  }
  if (types.length < 2) return undefined;

  for (const variant of variants) {
    const allowed = { ...SHARED_KEYS, ...TYPE_KEYS[variant.type as string] };
    for (const k of Object.keys(variant)) {
      if (k !== "type" && !Object.hasOwn(allowed, k)) return undefined;
    }
  }

  const chosen = types.find((t) => t !== "null") ?? types[0]!;
  const chosenAllowed = { ...SHARED_KEYS, ...TYPE_KEYS[chosen] };

  const next: JsonObject = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === key) continue;
    // Strip sibling keys copied from the parent that belong to another type.
    if (Object.hasOwn(ALL_TYPE_KEYS, k) && !Object.hasOwn(chosenAllowed, k)) continue;
    next[k] = v;
  }
  next.type = chosen;
  for (const variant of variants) {
    for (const [k, v] of Object.entries(variant)) {
      if (k === "type" || !Object.hasOwn(chosenAllowed, k) || Object.hasOwn(next, k)) continue;
      next[k] = v;
    }
  }
  replaceNodeKeys(node, next);
  return true;
}

/**
 * Same-type union: union pure enum branches' members when their other keys
 * agree; otherwise broaden to the common type. Returns true (collapsed),
 * false (conflict → residual), undefined (n/a).
 */
function trySameTypeCollapse(node: JsonObject, key: "anyOf" | "oneOf", variants: JsonObject[]): boolean | undefined {
  const commonType = variants[0]!.type;
  if (typeof commonType !== "string" || !Object.hasOwn(SUPPORTED_TYPES, commonType)) return undefined;
  if (!variants.every((variant) => variant.type === commonType)) return undefined;

  let collapsed: JsonObject;
  if (variants.every((variant) => Array.isArray(variant.enum))) {
    const base = variants[0]!;
    for (const variant of variants.slice(1)) {
      for (const [k, v] of Object.entries(variant)) {
        if (k === "enum") continue;
        if (!(k in base) || !jsonEquals(base[k], v)) return false;
      }
      for (const k of Object.keys(base)) {
        if (k !== "enum" && !(k in variant)) return false;
      }
    }
    const mergedEnum: unknown[] = [];
    for (const variant of variants) {
      for (const value of variant.enum as unknown[]) {
        if (!mergedEnum.some((candidate) => jsonEquals(candidate, value))) mergedEnum.push(value);
      }
    }
    collapsed = { ...base, enum: mergedEnum };
  } else {
    // A same-type union that cannot be merged losslessly broadens to the type
    // itself rather than selecting one branch and silently narrowing inputs.
    collapsed = { type: commonType };
  }

  const next: JsonObject = {};
  for (const [k, v] of Object.entries(node)) {
    if (k !== key) next[k] = v;
  }
  for (const [k, v] of Object.entries(collapsed)) {
    if (!(k in next)) next[k] = v;
  }
  replaceNodeKeys(node, next);
  return true;
}

function replaceNodeKeys(node: JsonObject, next: JsonObject): void {
  for (const key of Object.keys(node)) delete node[key];
  Object.assign(node, next);
}

// ---------------------------------------------------------------------------
// Enum / structural finalization
// ---------------------------------------------------------------------------

/**
 * Encode the final enum for the wire: CCA's Schema proto declares enum as
 * repeated string even for numeric/boolean schema types, so finite numbers and
 * booleans are stringified while their (declared or inferred) type is kept. An
 * enum containing null/non-scalar/unrepresentable values is dropped entirely
 * rather than narrowed; a typeless scalar enum gets its type inferred.
 */
function finalizeEnum(result: JsonObject): void {
  if (!("enum" in result)) return;
  const valuesRaw = Array.isArray(result.enum) ? result.enum : [];

  // Deduplicate by deep equality.
  const values: unknown[] = [];
  for (const value of valuesRaw) {
    if (!values.some((candidate) => jsonEquals(candidate, value))) values.push(value);
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
    const inferred = new Set(values.map(jsonTypeOf));
    if (inferred.size !== 1) {
      delete result.enum; // mixed scalar kinds cannot pick one type: drop, don't narrow
      return;
    }
    result.type = values.map(jsonTypeOf)[0];
  }
  if (result.type === "null") {
    delete result.enum;
    delete result.type;
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
  if ("propertyOrdering" in result) {
    const properties = isPlainObject(result.properties) ? result.properties : {};
    const seen = new Set<string>();
    const clean = stringArray(result.propertyOrdering).filter((name) => {
      if (seen.has(name) || !Object.hasOwn(properties, name)) return false;
      seen.add(name);
      return true;
    });
    if (clean.length > 0) result.propertyOrdering = clean;
    else delete result.propertyOrdering;
  }
  if (Array.isArray(result.required)) {
    const props = isPlainObject(result.properties) ? result.properties : {};
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const name of stringArray(result.required)) {
      if (seen.has(name) || !Object.hasOwn(props, name)) continue;
      seen.add(name);
      clean.push(name);
    }
    if (clean.length > 0) result.required = clean;
    else delete result.required;
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
  if ("items" in result && !isPlainObject(result.items)) delete result.items;
}

// ---------------------------------------------------------------------------
// Final structural validation
// ---------------------------------------------------------------------------

/**
 * Recursively verify the produced tree only contains allowed keys with valid
 * value shapes (cycle-safe). Any violation — including a residual forbidden
 * combiner — disqualifies the whole tool schema.
 */
function isValidCcaSchema(value: unknown, seen: Set<object>): boolean {
  if (!isPlainObject(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(OUTPUT_KEYS, key)) return false;
  }
  if (value.type !== undefined && !(typeof value.type === "string" && Object.hasOwn(SUPPORTED_TYPES, value.type))) return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.title !== undefined && typeof value.title !== "string") return false;
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.some((entry) => typeof entry !== "string")) return false;
  }
  if (value.required !== undefined) {
    if (
      !Array.isArray(value.required) ||
      value.required.some((entry) => typeof entry !== "string") ||
      new Set(value.required as string[]).size !== (value.required as string[]).length
    ) {
      return false;
    }
  }
  if (value.propertyOrdering !== undefined) {
    if (
      !Array.isArray(value.propertyOrdering) ||
      (value.propertyOrdering as unknown[]).some((entry) => typeof entry !== "string")
    ) {
      return false;
    }
  }
  if (value.properties !== undefined) {
    if (!isPlainObject(value.properties)) return false;
    for (const subschema of Object.values(value.properties)) {
      if (!isValidCcaSchema(subschema, seen)) return false;
    }
  }
  if (value.items !== undefined && !isValidCcaSchema(value.items, seen)) return false;
  return true;
}

/**
 * Normalize one tool parameter schema for Cloud Code Assist. Malformed input
 * or an unrepresentable construct returns the safe fallback schema instead of
 * a payload that would 400 the entire request.
 */
export function normalizeSchemaForCCA(value: unknown): unknown {
  try {
    const normalized = normalizeNode(dereferenceJsonSchema(value), new Set());
    return isValidCcaSchema(normalized, new Set()) ? normalized : { ...CCA_FALLBACK_SCHEMA };
  } catch {
    return { ...CCA_FALLBACK_SCHEMA };
  }
}

/** Function-declaration parameters must be object-rooted even when a scalar schema is otherwise valid. */
export function normalizeToolSchemaForCCA(value: unknown): unknown {
  const normalized = normalizeSchemaForCCA(value);
  return isPlainObject(normalized) && normalized.type === "object"
    ? normalized
    : { ...CCA_FALLBACK_SCHEMA };
}
