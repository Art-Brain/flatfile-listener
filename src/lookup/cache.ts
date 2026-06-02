import { FlatfileRecord } from "@flatfile/plugin-record-hook";
import { LOOKUP_FIELDS } from "../config/lookups";
import { mapValues } from "../utils/object";
import api from "@flatfile/api";

/** Stored on workbook metadata so record hooks can reuse data without refetching sheets/records. */
const LOOKUP_DATA_METADATA_KEY = "listenerLookupData";

/** Per lookup sheet: refKey cell value -> row slice (lookup columns only). */
export type LookupSheetCache = Map<string, Record<string, unknown>>;
/** workbookId -> { refKey column name -> Map(ref value -> row) } */
export type LookupDataCache = Record<string, LookupSheetCache>;

// Cache: workbookId -> { refKey -> Map(ref value, row) }
const lookupCache = new Map<string, LookupDataCache>();
const cacheLoading = new Map<string, Promise<LookupDataCache>>();

function buildLookupRow(
  refKey: string,
  flatRow: Record<string, unknown>,
): Record<string, unknown> {
  const config = LOOKUP_FIELDS[refKey];
  const out: Record<string, unknown> = {};
  for (const { lookupField } of config.fields) {
    if (lookupField in flatRow) out[lookupField] = flatRow[lookupField];
  }
  return out;
}

function rowsArrayToMap(
  refKey: string,
  rows: Record<string, unknown>[],
): LookupSheetCache {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const raw = row[refKey];
    if (raw === undefined || raw === null || raw === "") continue;
    map.set(String(raw), row);
  }
  return map;
}

/** Plain object for JSON metadata (Map is not JSON-serializable). */
export function lookupDataToMetadataJson(
  cache: LookupDataCache,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [refKey, m] of Object.entries(cache)) {
    out[refKey] = Object.fromEntries(m);
  }
  return out;
}

/** Restore Maps after reading metadata; migrates legacy array-of-rows shape. */
export function lookupDataFromMetadataJson(
  raw: Record<string, unknown>,
): LookupDataCache {
  const out: LookupDataCache = {};
  for (const [refKey, entry] of Object.entries(raw)) {
    if (Array.isArray(entry)) {
      out[refKey] = rowsArrayToMap(refKey, entry as Record<string, unknown>[]);
      continue;
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      out[refKey] = new Map(
        Object.entries(entry as Record<string, unknown>).map(([k, v]) => [
          k,
          typeof v === "object" && v !== null && !Array.isArray(v)
            ? (v as Record<string, unknown>)
            : {},
        ]),
      );
    }
  }
  return out;
}

export async function getLookupData(
  workbookId: string,
  dataSheetsIds: string[],
  refresh: boolean = false,
) {
  if (lookupCache.has(workbookId) && !refresh)
    return lookupCache.get(workbookId)!;
  if (cacheLoading.has(workbookId) && !refresh)
    return cacheLoading.get(workbookId)!;
  const promise = (async () => {
    const result: LookupDataCache = {};
    await Promise.all(
      dataSheetsIds.map(async (sourceId) => {
        // Read directly from the source dataSheetId — bypasses any copy timing
        const { data } = await api.records.get(sourceId);
        const recs = data.records ?? [];
        if (recs.length === 0) return;
        const columns = Object.keys(recs[0].values);
        const refKey = Object.keys(LOOKUP_FIELDS).find((key) =>
          columns.includes(key),
        );
        if (!refKey) return;
        const map = new Map<string, Record<string, unknown>>();
        for (const r of recs) {
          const flatRow = mapValues(r.values, ({ value }) => value) as Record<
            string,
            unknown
          >;
          const keyVal = flatRow[refKey];
          if (keyVal === undefined || keyVal === null || keyVal === "")
            continue;
          map.set(String(keyVal), buildLookupRow(refKey, flatRow));
        }
        result[refKey] = map;
      }),
    );
    lookupCache.set(workbookId, result);
    cacheLoading.delete(workbookId);
    return result;
  })();

  cacheLoading.set(workbookId, promise);
  return promise;
}

export async function getLookupDataByWorkbook(workbookId: string) {
  if (lookupCache.has(workbookId)) return lookupCache.get(workbookId)!;
  if (cacheLoading.has(workbookId)) return cacheLoading.get(workbookId)!;

  const { data: sheets } = await api.sheets.list({ workbookId });
  const refSheets = sheets.filter(
    ({ config: { metadata } }) => metadata?.dataSheetId,
  );
  const dataSheetsIds = refSheets.map(
    (sheet) => sheet.config.metadata.dataSheetId,
  );
  return getLookupData(workbookId, dataSheetsIds);
}

export async function saveLookupDataOnWorkbookMetadata(
  workbookId: string,
  lookupData: LookupDataCache,
) {
  const { data: workbook } = await api.workbooks.get(workbookId);
  const existingMeta =
    workbook.metadata != null &&
    typeof workbook.metadata === "object" &&
    !Array.isArray(workbook.metadata)
      ? { ...(workbook.metadata as Record<string, unknown>) }
      : {};
  await api.workbooks.update(workbookId, {
    metadata: {
      ...existingMeta,
      [LOOKUP_DATA_METADATA_KEY]: lookupDataToMetadataJson(lookupData),
    },
  });
}

export async function getLookupDataFromWorkbookMetadata(
  workbookId: string,
): Promise<LookupDataCache | null> {
  const { data: workbook } = await api.workbooks.get(workbookId);

  const raw = (workbook.metadata as Record<string, unknown> | undefined)?.[
    LOOKUP_DATA_METADATA_KEY
  ];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return lookupDataFromMetadataJson(raw as Record<string, unknown>);
}

export function setReferenceFieldsFromCache(
  record: FlatfileRecord,
  cache: LookupDataCache,
) {
  Object.keys(LOOKUP_FIELDS).forEach((field) => {
    if (
      typeof record.originalValue === "object" &&
      !record.originalValue.hasOwnProperty(field)
    ) {
      return;
    }

    const value = record.get(field);
    if (!value) return;

    const lookupMap = cache[field];
    const match =
      lookupMap instanceof Map ? lookupMap.get(String(value)) : undefined;
    if (!match) return;

    LOOKUP_FIELDS[field].fields.forEach(({ targetField, lookupField }) => {
      const lookupValue = match[lookupField];
      if (lookupValue !== undefined) {
        record.compute(
          targetField,
          () => lookupValue as string | number | boolean | null,
          "From linked file",
        );
      }
    });
  });
}

export function clearInvalidCodeFieldSafe(
  record: FlatfileRecord,
  cache: LookupDataCache,
) {
  const code = record.get("code");
  if (!code) return;

  const departments = record.get("departments");
  if (!departments) {
    record.setMetadata({ disableTransformer: false });
  }

  const codeMap = cache["code"];
  const codeExists = codeMap instanceof Map && codeMap.has(String(code));

  if (!codeExists) {
    const comment = `${code} N/A. auto set to empty string`;
    record
      .set("code", null)
      .addComment("code", comment)
      .addInfo("code", comment)
      .addWarning("code", comment);
    record.setMetadata({ disableTransformer: true });
  }
}
