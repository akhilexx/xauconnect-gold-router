// Minimal JSON Schema (2020-12 subset) validator, zero dependencies. Supports the keywords the agent
// tool manifest uses: type, properties, required, additionalProperties:false, items, minItems, maxItems,
// enum, const, pattern, minLength, maxLength, minimum, maximum. Unknown keywords are ignored.

export type Schema = {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  enum?: readonly unknown[];
  const?: unknown;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
  [k: string]: unknown;
};

/** Returns a list of "path: problem" strings; empty means valid. */
export function validate(schema: Schema, v: unknown, path = "$"): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return [`${path}: expected object`];
    const o = v as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in o)) errs.push(`${path}.${r}: required`);
    for (const [k, val] of Object.entries(o)) {
      const ps = schema.properties?.[k];
      if (ps) errs.push(...validate(ps, val, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
    }
  } else if (t === "array") {
    if (!Array.isArray(v)) return [`${path}: expected array`];
    if (schema.minItems !== undefined && v.length < schema.minItems) errs.push(`${path}: at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && v.length > schema.maxItems) errs.push(`${path}: at most ${schema.maxItems} items`);
    if (schema.items) v.forEach((x, i) => errs.push(...validate(schema.items!, x, `${path}[${i}]`)));
  } else if (t === "string") {
    if (typeof v !== "string") return [`${path}: expected string`];
    if (schema.minLength !== undefined && v.length < schema.minLength) errs.push(`${path}: too short`);
    if (schema.maxLength !== undefined && v.length > schema.maxLength) errs.push(`${path}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) errs.push(`${path}: does not match ${schema.pattern}`);
  } else if (t === "integer" || t === "number") {
    if (typeof v !== "number" || !Number.isFinite(v) || (t === "integer" && !Number.isInteger(v))) return [`${path}: expected ${t}`];
    if (schema.minimum !== undefined && v < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && v > schema.maximum) errs.push(`${path}: above ${schema.maximum}`);
  } else if (t === "boolean") {
    if (typeof v !== "boolean") return [`${path}: expected boolean`];
  }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${path}: must be one of ${schema.enum.join(", ")}`);
  if ("const" in schema && schema.const !== v) errs.push(`${path}: must equal ${String(schema.const)}`);
  return errs;
}
