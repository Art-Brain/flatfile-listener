import * as Yup from "yup";

/** Serialized RegExp from Artbrain serializeYupDescribe. */
export type SerializedRegex = { source: string; flags?: string };

export type SchemaTestDescription = {
  name?: string;
  params?: Record<string, unknown>;
};

/** Leaf (or array) field description from schema.describe() JSON. */
export type FieldSchemaDescription = {
  type?: string;
  optional?: boolean;
  nullable?: boolean;
  oneOf?: unknown[];
  notOneOf?: unknown[];
  tests?: SchemaTestDescription[];
  innerType?: FieldSchemaDescription;
  meta?: { messages?: Record<string, string> };
};

export type YupSchemaMetadata = {
  fields?: Record<string, FieldSchemaDescription>;
};

const unknownTestNamesLogged = new Set<string>();
const unknownTypesLogged = new Set<string>();

/** WeakMap keyed by yupSchema object identity → field key → rebuilt validator. */
const validatorCache = new WeakMap<object, Map<string, Yup.AnySchema | null>>();

/** Same normalization as Artbrain removeAstrixAndMoveToLowerCase. */
export function normalizeImportFieldKey(key: string): string {
  return key
    .replace("*", "")
    .replace(".", "")
    .replace(/\s/g, "")
    .replace("/", "")
    .toLowerCase();
}

/**
 * Find a field description saved under the raw column key or its normalized form.
 * New Artbrain snapshots key fields by normalizeImportFieldKey. Older snapshots
 * keep the original Flatfile key (for example "Lot No." or "PrimaryItemURL").
 */
export function findFieldSchemaDescription(
  fields: Record<string, FieldSchemaDescription>,
  key: string,
): FieldSchemaDescription | undefined {
  const exact = fields[key];
  if (exact) return exact;

  const normalized = normalizeImportFieldKey(key);
  const normalizedHit = fields[normalized];
  if (normalizedHit) return normalizedHit;

  // Backwards compatibility for older snapshots. (legacy keys)
  for (const [storedKey, description] of Object.entries(fields)) {
    if (normalizeImportFieldKey(storedKey) === normalized) return description;
  }
  return undefined;
}

/**
 * Normalize Flatfile empty cells to null so optional/nullable Yup schemas pass
 * (Yup describe() does not include Artbrain's empty→null transforms).
 */
export function coerceEmptyToNull(value: unknown): unknown {
  if (value === "" || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

function coerceBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return value;
}

/** Coerce empties to null; map common boolean string forms when type is boolean. */
export function coerceValueForField(
  value: unknown,
  fieldType?: string,
): unknown {
  const coerced = coerceEmptyToNull(value);
  if (coerced === null) return null;
  if (fieldType === "boolean") return coerceBoolean(coerced);
  return coerced;
}

export function toRegExp(regex: unknown): RegExp {
  if (regex instanceof RegExp) return regex;
  if (regex && typeof regex === "object" && "source" in (regex as object)) {
    const { source, flags } = regex as SerializedRegex;
    return new RegExp(source, flags || "");
  }
  if (typeof regex === "string") return new RegExp(regex);
  throw new Error("Invalid regex in yupSchema");
}

function baseSchemaForType(type: string | undefined): Yup.AnySchema | null {
  switch (type) {
    case "string":
      return Yup.string();
    case "number":
      return Yup.number();
    case "boolean":
      return Yup.boolean();
    case "mixed":
      return Yup.mixed();
    case "date":
      return Yup.date();
    case "array":
      return Yup.array();
    case "object":
      // Per-field validation only needs leaf schemas.
      return null;
    default:
      if (type && !unknownTypesLogged.has(type)) {
        unknownTypesLogged.add(type);
        console.warn(`yup-runtime: unknown schema type "${type}", skipping`);
      }
      return null;
  }
}

function messageFor(
  messages: Record<string, string> | undefined,
  name: string | undefined,
): string | undefined {
  if (!name || !messages) return undefined;
  const message = messages[name];
  return typeof message === "string" ? message : undefined;
}

function applyTest(
  schema: Yup.AnySchema | null,
  test: SchemaTestDescription,
  schemaType: string,
  messages?: Record<string, string>,
): Yup.AnySchema | null {
  if (!schema) return null;
  const name = test.name;
  const params = test.params || {};
  const message = messageFor(messages, name);

  switch (name) {
    case "matches":
      if (schemaType === "string") {
        const regex = toRegExp(params.regex);
        const next = schema as Yup.StringSchema;
        return message ? next.matches(regex, message) : next.matches(regex);
      }
      return schema;
    case "email":
      if (schemaType === "string") {
        const next = schema as Yup.StringSchema;
        return message ? next.email(message) : next.email();
      }
      return schema;
    case "url":
      if (schemaType === "string") {
        const next = schema as Yup.StringSchema;
        return message ? next.url(message) : next.url();
      }
      return schema;
    case "min":
      if (schemaType === "string") {
        const next = schema as Yup.StringSchema;
        return message
          ? next.min(params.min as number, message)
          : next.min(params.min as number);
      }
      if (schemaType === "number") {
        const next = schema as Yup.NumberSchema;
        return message
          ? next.min(params.min as number, message)
          : next.min(params.min as number);
      }
      if (schemaType === "array") {
        const next = schema as Yup.ArraySchema<unknown[], Yup.AnyObject>;
        return message
          ? next.min(params.min as number, message)
          : next.min(params.min as number);
      }
      if (schemaType === "date") {
        const next = schema as Yup.DateSchema;
        return message
          ? next.min(params.min as Date | string, message)
          : next.min(params.min as Date | string);
      }
      return schema;
    case "max":
      if (schemaType === "string") {
        const next = schema as Yup.StringSchema;
        return message
          ? next.max(params.max as number, message)
          : next.max(params.max as number);
      }
      if (schemaType === "number") {
        const next = schema as Yup.NumberSchema;
        return message
          ? next.max(params.max as number, message)
          : next.max(params.max as number);
      }
      if (schemaType === "array") {
        const next = schema as Yup.ArraySchema<unknown[], Yup.AnyObject>;
        return message
          ? next.max(params.max as number, message)
          : next.max(params.max as number);
      }
      if (schemaType === "date") {
        const next = schema as Yup.DateSchema;
        return message
          ? next.max(params.max as Date | string, message)
          : next.max(params.max as Date | string);
      }
      return schema;
    case "length":
      if (params.length == null) return schema;
      if (schemaType === "string") {
        const next = schema as Yup.StringSchema;
        return message
          ? next.length(params.length as number, message)
          : next.length(params.length as number);
      }
      if (schemaType === "array") {
        const next = schema as Yup.ArraySchema<unknown[], Yup.AnyObject>;
        return message
          ? next.length(params.length as number, message)
          : next.length(params.length as number);
      }
      return schema;
    case "integer":
      if (schemaType === "number") {
        const next = schema as Yup.NumberSchema;
        return message ? next.integer(message) : next.integer();
      }
      return schema;
    case "positive":
      if (schemaType === "number") {
        const next = schema as Yup.NumberSchema;
        return message ? next.positive(message) : next.positive();
      }
      return schema;
    case "negative":
      if (schemaType === "number") {
        const next = schema as Yup.NumberSchema;
        return message ? next.negative(message) : next.negative();
      }
      return schema;
    default:
      if (name && !unknownTestNamesLogged.has(name)) {
        unknownTestNamesLogged.add(name);
        console.warn(
          `yup-runtime: ignoring unknown test "${name}" (v1 serializable rules only)`,
        );
      }
      return schema;
  }
}

/**
 * Rebuild a Yup field schema from a SchemaDescription (Artbrain yupSchema.fields[key]).
 * Does not use eval / new Function — only Yup APIs.
 * Custom messages come from desc.meta.messages when Artbrain serialized them.
 */
export function rebuildFieldValidator(
  desc: FieldSchemaDescription,
): Yup.AnySchema | null {
  if (!desc || !desc.type) return null;

  let schema = baseSchemaForType(desc.type);
  if (!schema) return null;

  if (desc.type === "array" && desc.innerType) {
    const inner = rebuildFieldValidator(desc.innerType);
    if (inner) {
      schema = (schema as Yup.ArraySchema<unknown[], Yup.AnyObject>).of(inner);
    }
  }

  // Saved sheet metadata drops Yup describe() booleans (`nullable`, `optional`).
  // Empty Flatfile cells are null, and a bare Yup schema is non-nullable, so a
  // missing flag must allow null. An explicit `false` still rejects null.
  if (desc.nullable !== false) {
    schema = schema.nullable();
  }
  if (desc.optional !== false) {
    schema = schema?.optional();
  }

  const messages = desc.meta?.messages;
  const typeError = messageFor(messages, "typeError");
  if (typeError) {
    schema = schema?.typeError(typeError) || null;
  }

  if (desc.oneOf?.length) {
    const oneOfMessage = messageFor(messages, "oneOf");
    schema = oneOfMessage
      ? schema?.oneOf(desc.oneOf as never[], oneOfMessage) || null
      : schema?.oneOf(desc.oneOf as never[]) || null;
  }
  if (desc.notOneOf?.length) {
    const notOneOfMessage = messageFor(messages, "notOneOf");
    schema = notOneOfMessage
      ? schema?.notOneOf(desc.notOneOf as never[], notOneOfMessage) || null
      : schema?.notOneOf(desc.notOneOf as never[]) || null;
  }

  for (const test of desc.tests || []) {
    schema = applyTest(schema, test, desc.type, messages);
  }

  return schema;
}

/** Memoized rebuild keyed by yupSchema object identity + Flatfile field key. */
export function getCachedFieldValidator(
  schemaMetadata: object,
  key: string,
  fieldDescription: FieldSchemaDescription,
): Yup.AnySchema | null {
  let byField = validatorCache.get(schemaMetadata);
  if (!byField) {
    byField = new Map();
    validatorCache.set(schemaMetadata, byField);
  }
  if (byField.has(key)) {
    return byField.get(key)!;
  }
  const validator = rebuildFieldValidator(fieldDescription);
  byField.set(key, validator);
  return validator;
}

export function formatYupValidationError(error: Yup.ValidationError): string {
  if (error.inner?.length) {
    const joined = [
      ...new Set(error.inner.map((e) => e.message).filter(Boolean)),
    ].join("; ");
    return joined || error.message;
  }
  return error.message;
}
