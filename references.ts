import { FlatfileRecord } from "@flatfile/plugin-record-hook";
import { LOOKUP_FIELDS } from "./lookups";
import { mapValues } from "./utils";
import api from "@flatfile/api";

/** Stored on workbook metadata so record hooks can reuse data without refetching sheets/records. */
const LOOKUP_DATA_METADATA_KEY = "listenerLookupData";

// Cache: workbookId -> { sheetSlug -> rows[] }
const lookupCache = new Map<string, Record<string, any[]>>();
const cacheLoading = new Map<string, Promise<Record<string, any[]>>>();

export async function getLookupData(workbookId: string) {
  if (lookupCache.has(workbookId)) return lookupCache.get(workbookId)!;
  if (cacheLoading.has(workbookId)) return cacheLoading.get(workbookId)!;

  const promise = (async () => {
    const { data: sheets } = await api.sheets.list({ workbookId });
    const refSheets = sheets.filter(
      ({ config: { metadata } }) => metadata?.dataSheetId,
    );
    const result: Record<string, any[]> = {};
    await Promise.all(
      refSheets.map(async (sheet) => {
        // Read directly from the source dataSheetId — bypasses any copy timing
        const sourceId = sheet.config.metadata.dataSheetId;
        const { data } = await api.records.get(sourceId);
        const columns = Object.keys((data.records ?? [])[0].values);
        const refKey = Object.keys(LOOKUP_FIELDS).find((key) =>
          columns.includes(key),
        );
        if (!refKey) return;
        result[refKey] = (data.records ?? []).map((r) =>
          mapValues(r.values, (cell: any) => cell.value),
        );
      }),
    );
    lookupCache.set(workbookId, result);
    cacheLoading.delete(workbookId);
    return result;
  })();

  cacheLoading.set(workbookId, promise);
  return promise;
}

export async function saveLookupDataOnWorkbookMetadata(
  workbookId: string,
  lookupData: Record<string, any[]>,
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
      [LOOKUP_DATA_METADATA_KEY]: lookupData,
    },
  });
}

export async function getLookupDataFromWorkbookMetadata(
  workbookId: string,
): Promise<Record<string, any[]> | null> {
  console.log("getLookupDataFromWorkbookMetadata", workbookId);
  const start = Date.now();
  const { data: workbook } = await api.workbooks.get(workbookId);

  const raw = (workbook.metadata as Record<string, unknown> | undefined)?.[
    LOOKUP_DATA_METADATA_KEY
  ];
  console.log("has metadata?", !!raw, "took", Date.now() - start);
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, any[]>;
}

export function setReferenceFieldsFromCache(
  record: FlatfileRecord,
  cache: Record<string, any[]>,
): boolean {
  let recordChanged = false;
  Object.keys(LOOKUP_FIELDS).forEach((field) => {
    if (
      typeof record.originalValue === "object" &&
      !record.originalValue.hasOwnProperty(field)
    ) {
      return;
    }

    const value = record.get(field);

    if (field === "code" && !value) {
      console.log("code is null", record.originalValue);
    }
    if (!value) return;

    // Look up the row in the cached lookup sheet (field name == sheet slug, adjust if needed)
    const rows = cache[field] ?? [];

    const match = rows.find((row) => Object.values(row).includes(value));
    if (!match) return;

    LOOKUP_FIELDS[field].forEach(({ targetField, lookupField }) => {
      const lookupValue = match[lookupField];
      if (lookupValue !== undefined) {
        record.compute(targetField, () => lookupValue, "From linked file");
        recordChanged = true;
      }
    });
  });
  return recordChanged;
}

export function clearInvalidCodeFieldSafe(
  record: FlatfileRecord,
  cache: Record<string, any[]>,
): boolean {
  let recordChanged = false;
  const code = record.get("code");
  if (!code) return;

  const departments = record.get("departments");
  if (!departments) {
    record.setMetadata({ disableTransformer: false });
    recordChanged = true;
  }

  // Definitive check via cached API data — no dependency on getLinks timing
  const codeRows = cache["code"] ?? [];
  const codeExists = codeRows.some((row) => Object.values(row).includes(code));

  if (!codeExists) {
    const comment = `${code} N/A. auto set to empty string`;
    record
      .set("code", null)
      .addComment("code", comment)
      .addInfo("code", comment)
      .addWarning("code", comment);
    record.setMetadata({ disableTransformer: true });
    recordChanged = true;
  }
  return recordChanged;
}
