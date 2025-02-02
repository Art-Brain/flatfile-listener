import api from "@flatfile/api";
import { FlatfileRecord } from "@flatfile/plugin-record-hook";
import { TPrimitive } from "@flatfile/hooks";
import { RecordsWithLinks, Sheet, ValidationType } from "@flatfile/api/api";
import { LOOKUP_FIELDS } from "./lookups";

export async function updateRecords(
  sheetId: string,
  records: { recordId: string; values: { key: string; value: TPrimitive }[] }[]
) {
  if (!records.length) return;
  try {
    const request = records.map(({ recordId, values }) => ({
      id: recordId,
      values: values.reduce((acc, { key, value }) => {
        acc[key] = {
          value,
          messages: [],
        };
        return acc;
      }, {}),
      messages: values.map(({ key }) => ({
        field: key,
        message: "From linked file",
        type: ValidationType.Info,
      })),
    }));
    await api.records.update(sheetId, request);
  } catch (error) {
    console.error("Error updating record:", error);
  }
}

export function isRecordHasLookupField(record: FlatfileRecord) {
  const lookupFields = Object.keys(LOOKUP_FIELDS);
  return lookupFields.some((field) => record.get(field));
}

export function isSheetHasReferenceField(
  sheet: Sheet,
  updatedSheetSlug: string
) {
  const lookupFieldsLower = Object.keys(LOOKUP_FIELDS).map((field) =>
    field.toLowerCase()
  );
  return sheet.config.fields.some(
    (field) =>
      field.type === "reference" &&
      lookupFieldsLower.includes(field.key.toLowerCase()) &&
      field.config.ref === updatedSheetSlug
  );
}

export async function getRecordsMap(sheetsIds: string[]) {
  const allRecords = await Promise.all(
    sheetsIds.map(
      async (sheetId) => (await api.records.get(sheetId)).data.records
    )
  );
  return sheetsIds.reduce((acc, sheetId, index) => {
    acc[sheetId] = allRecords[index];
    return acc;
  }, {} as Record<string, RecordsWithLinks>);
}

/**
 * Return the update of the sheets that reference and lookup to the updated record -
 * creates Bidirectional relationship that is missing on Flatfile
 */
export function getReferencedFieldChange(
  updatedSheetId: string,
  sheets: Sheet[],
  sheetToRecords: Record<string, RecordsWithLinks>,
  updatedRecord: FlatfileRecord
) {
  if (!sheets || !isRecordHasLookupField(updatedRecord)) return;

  const lookupFieldsLower = Object.keys(LOOKUP_FIELDS).map((field) =>
    field.toLowerCase()
  );
  const updatedSheet = sheets.find(({ id }) => id === updatedSheetId);

  if (sheets.length < 2 || !updatedSheet) return;
  const hasReferencedField = updatedSheet.config.fields.some(({ key }) =>
    lookupFieldsLower.includes(key.toLowerCase())
  );
  if (!hasReferencedField) return;

  const updatedSheetSlug = updatedSheet.slug;

  return sheets
    .flatMap((sheet) => {
      // Skip the current sheet
      if (sheet.id === updatedSheetId) return;

      // Check if the sheet has a reference field to the updated sheet
      const hasLookupField = sheet.config.fields.some(
        (field) =>
          field.type === "reference" &&
          lookupFieldsLower.includes(field.key.toLowerCase()) &&
          field.config.ref === updatedSheetSlug
      );

      if (!hasLookupField) return;
      const sheetRecords = sheetToRecords[sheet.id] || [];
      const targetRecords = sheetRecords.flatMap((record) =>
        Object.keys(LOOKUP_FIELDS)
          .map((field) => {
            if (
              !updatedRecord.get(field) ||
              record.values[field].value !== updatedRecord.get(field)
            )
              return;

            const values: { key: string; value: TPrimitive }[] = LOOKUP_FIELDS[
              field
            ]
              .map(({ targetField, lookupField }) => {
                const value = updatedRecord.get(lookupField);
                if (value === undefined || Array.isArray(value)) {
                  return;
                }
                return {
                  key: targetField,
                  value,
                };
              })
              .filter((record) => record !== undefined);
            return {
              sheetId: sheet.id,
              recordId: record.id,
              values,
            };
          })
          .filter((record) => record !== undefined)
      );
      return targetRecords;
    })
    .filter((record) => !!record);
}

export function setReferenceFields(record: FlatfileRecord) {
  Object.keys(LOOKUP_FIELDS).forEach((field) => {
    if (!record.get(field)) return;
    const links = record.getLinks(field);
    LOOKUP_FIELDS[field].forEach(({ targetField, lookupField }) => {
      const lookupValue = links?.[0]?.[lookupField];
      if (lookupValue !== undefined) {
        record.set(targetField, lookupValue);
        record.addInfo(targetField, "From linked file");
      }
    });
  });
}

export function clearInvalidCodeField(record: FlatfileRecord) {
  const isDepartmentsValid = !!record.getLinks("departments");
  const code = record.get("code");
  const codeLinks = record.getLinks("code");
  const isCodeInvalid = code && !codeLinks;

  if (isDepartmentsValid && isCodeInvalid) {
    const comment = `${code} N/A. auto set to empty string`;
    record
      .set("code", null)
      .addComment("code", comment)
      .addInfo("code", comment)
      .addWarning("code", comment);
  }
}
