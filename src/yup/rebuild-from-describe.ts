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
};

export type YupSchemaMetadata = {
  fields?: Record<string, FieldSchemaDescription>;
};

const unknownTestNamesLogged = new Set<string>();
const unknownTypesLogged = new Set<string>();

/** WeakMap keyed by yupSchema object identity → field key → rebuilt validator. */
const validatorCache = new WeakMap<object, Map<string, Yup.AnySchema | null>>();

/**
 * Yup describe() omits custom messages. Mirror Artbrain IMPORT_MESSAGES for
 * matches()-based fields until Artbrain serializes messages into the describe payload.
 * Keys are normalizeImportFieldKey() results (same as Artbrain importFieldSchemas).
 */
const MATCHES_MESSAGES_BY_FIELD: Record<string, string> = {
  lotno: "Can only contain letters and numbers",
  smsnumber:
    "Must be a valid phone number including country code (e.g. +12345678900)",
  saletime: "Must be a valid date (ISO 8601 or DD/MM/YYYY)",
  entrytime: "Must be a valid date (ISO 8601 or DD/MM/YYYY)",
  joinedat: "Must be a valid date (ISO 8601 or DD/MM/YYYY)",
  imageurl: "Must be a valid URL",
};

/** Same normalization as Artbrain removeAstrixAndMoveToLowerCase. */
export function normalizeImportFieldKey(key: string): string {
  return key
    .replace("*", "")
    .replace(".", "")
    .replace(/\s/g, "")
    .replace("/", "")
    .toLowerCase();
}

function matchesMessageForField(fieldKey?: string): string | undefined {
  if (!fieldKey) return undefined;
  return MATCHES_MESSAGES_BY_FIELD[normalizeImportFieldKey(fieldKey)];
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

function applyTest(
  schema: Yup.AnySchema | null,
  test: SchemaTestDescription,
  schemaType: string,
  fieldKey?: string,
): Yup.AnySchema | null {
  if (!schema) return null;
  const name = test.name;
  const params = test.params || {};

  switch (name) {
    case "matches":
      if (schemaType === "string") {
        const regex = toRegExp(params.regex);
        const message = matchesMessageForField(fieldKey);
        return message
          ? (schema as Yup.StringSchema).matches(regex, message)
          : (schema as Yup.StringSchema).matches(regex);
      }
      return schema;
    case "email":
      if (schemaType === "string") {
        return (schema as Yup.StringSchema).email();
      }
      return schema;
    case "url":
      if (schemaType === "string") {
        return (schema as Yup.StringSchema).url();
      }
      return schema;
    case "min":
      if (schemaType === "string") {
        return (schema as Yup.StringSchema).min(params.min as number);
      }
      if (schemaType === "number") {
        return (schema as Yup.NumberSchema).min(params.min as number);
      }
      if (schemaType === "array") {
        return (schema as Yup.ArraySchema<unknown[], Yup.AnyObject>).min(
          params.min as number,
        );
      }
      if (schemaType === "date") {
        return (schema as Yup.DateSchema).min(params.min as Date | string);
      }
      return schema;
    case "max":
      if (schemaType === "string") {
        return (schema as Yup.StringSchema).max(params.max as number);
      }
      if (schemaType === "number") {
        return (schema as Yup.NumberSchema).max(params.max as number);
      }
      if (schemaType === "array") {
        return (schema as Yup.ArraySchema<unknown[], Yup.AnyObject>).max(
          params.max as number,
        );
      }
      if (schemaType === "date") {
        return (schema as Yup.DateSchema).max(params.max as Date | string);
      }
      return schema;
    case "length":
      if (params.length == null) return schema;
      if (schemaType === "string") {
        return (schema as Yup.StringSchema).length(params.length as number);
      }
      if (schemaType === "array") {
        return (schema as Yup.ArraySchema<unknown[], Yup.AnyObject>).length(
          params.length as number,
        );
      }
      return schema;
    case "integer":
      if (schemaType === "number") {
        return (schema as Yup.NumberSchema).integer();
      }
      return schema;
    case "positive":
      if (schemaType === "number") {
        return (schema as Yup.NumberSchema).positive();
      }
      return schema;
    case "negative":
      if (schemaType === "number") {
        return (schema as Yup.NumberSchema).negative();
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
 * @param fieldKey Flatfile field key — used for matches() message overrides.
 */
export function rebuildFieldValidator(
  desc: FieldSchemaDescription,
  fieldKey?: string,
): Yup.AnySchema | null {
  if (!desc || !desc.type) return null;

  let schema = baseSchemaForType(desc.type);
  if (!schema) return null;

  if (desc.type === "array" && desc.innerType) {
    const inner = rebuildFieldValidator(desc.innerType, fieldKey);
    if (inner) {
      schema = (schema as Yup.ArraySchema<unknown[], Yup.AnyObject>).of(inner);
    }
  }

  if (desc.nullable) {
    schema = schema.nullable();
  }
  if (desc.optional) {
    schema = schema?.optional();
  }

  if (desc.oneOf?.length) {
    schema = schema?.oneOf(desc.oneOf as never[]) || null;
  }
  if (desc.notOneOf?.length) {
    schema = schema?.notOneOf(desc.notOneOf as never[]) || null;
  }

  for (const test of desc.tests || []) {
    schema = applyTest(schema, test, desc.type, fieldKey);
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
  const validator = rebuildFieldValidator(fieldDescription, key);
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
