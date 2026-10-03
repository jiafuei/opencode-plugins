import { z } from "zod";

export const fields = [
  { key: "order", label: "Provider order", group: "Routing", type: "list", hint: "Provider slugs in priority order, one per line. Full endpoint slugs are supported." },
  { key: "only", label: "Allowed providers", group: "Routing", type: "list", hint: "Only route to these provider slugs." },
  { key: "ignore", label: "Ignored providers", group: "Routing", type: "list", hint: "Exclude these provider slugs." },
  { key: "allow_fallbacks", label: "Allow fallbacks", group: "Routing", type: "boolean", hint: "Allow other providers if the preferred providers are unavailable." },
  { key: "require_parameters", label: "Require parameter support", group: "Routing", type: "boolean", hint: "Only route to providers supporting every requested parameter." },
  { key: "sort", label: "Provider sorting", group: "Routing", type: "json", hint: '"price", "throughput", "latency", or {"by":"price","partition":"model"}. Partition can also be "none".' },
  { key: "data_collection", label: "Data collection", group: "Privacy", type: "enum", hint: "Deny excludes providers that collect user data." },
  { key: "zdr", label: "Zero data retention", group: "Privacy", type: "boolean", hint: "Require ZDR endpoints. False does not override account-level ZDR." },
  { key: "enforce_distillable_text", label: "Distillable text", group: "Privacy", type: "boolean", hint: "Only route to models whose authors allow text distillation." },
  { key: "quantizations", label: "Quantizations", group: "Performance & price", type: "list", hint: "Allowed quantizations, one per line; e.g. fp16, bf16, int8, int4." },
  { key: "preferred_min_throughput", label: "Preferred minimum throughput", group: "Performance & price", type: "json", hint: 'Tokens/sec, e.g. 50 or {"p50":100,"p90":50}. A preference, not a hard limit.' },
  { key: "preferred_max_latency", label: "Preferred maximum latency", group: "Performance & price", type: "json", hint: 'Seconds, e.g. 3 or {"p50":1,"p99":5}. A preference, not a hard limit.' },
  { key: "max_price", label: "Maximum price", group: "Performance & price", type: "json", hint: 'E.g. {"prompt":1,"completion":2}. Token prices are USD per million; "request" and "image" are per unit. A hard limit.' },
] as const;

const sort = z.enum(["price", "throughput", "latency"]);
const threshold = z.union([z.number(), z.object({
  p50: z.number().optional(), p75: z.number().optional(), p90: z.number().optional(), p99: z.number().optional(),
})]);
const price = z.union([z.number(), z.string()]);
const values = {
  order: z.array(z.string()),
  only: z.array(z.string()),
  ignore: z.array(z.string()),
  allow_fallbacks: z.boolean(),
  require_parameters: z.boolean(),
  sort: z.union([sort, z.object({ by: sort, partition: z.enum(["model", "none"]).optional() })]),
  data_collection: z.enum(["allow", "deny"]),
  zdr: z.boolean(),
  enforce_distillable_text: z.boolean(),
  quantizations: z.array(z.string()),
  preferred_min_throughput: threshold,
  preferred_max_latency: threshold,
  max_price: z.object({
    prompt: price.optional(), completion: price.optional(), request: price.optional(), image: price.optional(), audio: price.optional(),
  }),
};

export type Field = keyof typeof values;
export type Value = string | number | boolean | string[] | Record<string, string | number>;
export type Patch = Partial<Record<Field, { mode: "remove" } | { mode: "set"; value: Value } | { mode: "append"; value: string[] }>>;

// Validate edits once, at the browser API boundary. Stored values use the same format.
export const patchSchema = z.object(Object.fromEntries(fields.map((field) => {
  const rules: z.ZodType[] = [z.object({ mode: z.literal("remove") }), z.object({ mode: z.literal("set"), value: values[field.key] })];
  if (field.type === "list") rules.push(z.object({ mode: z.literal("append"), value: z.array(z.string()) }));
  return [field.key, z.union(rules).optional()];
}))) as z.ZodType<Patch>;

export type Layer = { name: string; key: string; patch: Patch };

export function resolveSettings(base: Record<string, unknown>, layers: Layer[]) {
  const provider = { ...base };
  const sources: Record<string, string> = Object.fromEntries(Object.keys(base).map((key) => [key, "OpenCode"]));
  for (const layer of layers) {
    for (const [key, rule] of Object.entries(layer.patch)) {
      if (rule.mode === "remove") {
        delete provider[key];
        sources[key] = `${layer.name} · removed`;
      } else if (rule.mode === "append") {
        const previous = provider[key] as string[] | undefined;
        provider[key] = [...new Set([...(previous ?? []), ...rule.value])];
        sources[key] = previous?.length ? `${sources[key]} + ${layer.name}` : layer.name;
      } else {
        provider[key] = rule.value;
        sources[key] = layer.name;
      }
    }
  }
  return { provider, sources };
}

export function settingsKey(scope: string, modelID: string) {
  return `config/${scope}/${encodeURIComponent(modelID || "*")}`;
}
