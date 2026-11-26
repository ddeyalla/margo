import { isObject } from "../validate";

/* A tool's input, described once: the same fields make the JSON Schema an agent reads and the check its
   arguments pass before the handler runs. */

interface FieldBase {
  description: string;
  optional?: true;
}

export type Field =
  | (FieldBase & { type: "string"; max: number; oneOf?: readonly string[] })
  | (FieldBase & { type: "integer"; min: number; max: number })
  | (FieldBase & { type: "number"; min: number; max: number })
  /** Checked further by the handler, with the parser the app already has for that shape. `shape` is what the agent is told. */
  | (FieldBase & { type: "object"; shape: Record<string, unknown> })
  | (FieldBase & { type: "list"; max: number; item: Record<string, unknown> });

export type Fields = Record<string, Field>;

type ValueOf<F extends Field> = F extends { type: "string"; oneOf: readonly (infer Choice)[] }
  ? Choice
  : F extends { type: "string" }
    ? string
    : F extends { type: "integer" | "number" }
      ? number
      : F extends { type: "object" }
        ? Record<string, unknown>
        : unknown[];

type OptionalKeys<S extends Fields> = { [K in keyof S]: S[K] extends { optional: true } ? K : never }[keyof S];

/** What a handler receives: every required field, and the optional ones that were sent. */
export type InputOf<S extends Fields> = { [K in Exclude<keyof S, OptionalKeys<S>>]: ValueOf<S[K]> } & { [K in OptionalKeys<S>]?: ValueOf<S[K]> };

/** Something the caller got wrong or asked for that isn't there, worded for the caller to fix. */
export class ToolError extends Error {
  override name = "ToolError";
}

const propertyOf = (field: Field): Record<string, unknown> => {
  const { description } = field;
  switch (field.type) {
    case "string":
      return { type: "string", description, maxLength: field.max, ...(field.oneOf ? { enum: field.oneOf } : {}) };
    case "integer":
    case "number":
      return { type: field.type, description, minimum: field.min, maximum: field.max };
    case "object":
      return { type: "object", description, ...field.shape };
    case "list":
      return { type: "array", description, maxItems: field.max, items: field.item };
  }
};

/** The fields as a JSON Schema object, the form MCP's `inputSchema` takes. */
export const jsonSchema = (fields: Fields): Record<string, unknown> => ({
  type: "object",
  properties: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, propertyOf(field)])),
  required: Object.entries(fields).flatMap(([name, field]) => (field.optional ? [] : [name])),
  additionalProperties: false,
});

const problemWith = (name: string, field: Field, value: unknown): string | null => {
  switch (field.type) {
    case "string":
      if (typeof value !== "string" || !value.trim()) return `"${name}" must be text.`;
      if (value.length > field.max) return `"${name}" is longer than ${field.max} characters.`;
      if (field.oneOf && !field.oneOf.includes(value)) return `"${name}" must be one of: ${field.oneOf.join(", ")}.`;
      return null;
    case "integer":
    case "number": {
      const ok = typeof value === "number" && (field.type === "integer" ? Number.isInteger(value) : Number.isFinite(value));
      return ok && value >= field.min && value <= field.max ? null : `"${name}" must be ${field.type === "integer" ? "a whole number" : "a number"} from ${field.min} to ${field.max}.`;
    }
    case "object":
      return isObject(value) ? null : `"${name}" must be an object.`;
    case "list":
      return Array.isArray(value) && value.length <= field.max ? null : `"${name}" must be a list of at most ${field.max}.`;
  }
};

/** The arguments in the fields' exact shape, or a `ToolError` naming the first thing wrong. Unknown names are refused, so a typo is heard. */
export const parseInput = <S extends Fields>(fields: S, raw: unknown): InputOf<S> => {
  const sent = raw === undefined || raw === null ? {} : raw;
  if (!isObject(sent)) throw new ToolError("The arguments must be a JSON object.");
  const unknown = Object.keys(sent).find((name) => !Object.hasOwn(fields, name));
  if (unknown) throw new ToolError(`Unknown argument "${unknown}". This tool takes: ${Object.keys(fields).join(", ") || "nothing"}.`);
  const input: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = sent[name];
    if (value === undefined || value === null) {
      if (!field.optional) throw new ToolError(`"${name}" is required.`);
      continue;
    }
    const problem = problemWith(name, field, value);
    if (problem) throw new ToolError(problem);
    input[name] = field.type === "string" ? (value as string).trim() : value;
  }
  return input as InputOf<S>;
};
