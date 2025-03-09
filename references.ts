import { FlatfileRecord } from "@flatfile/plugin-record-hook";
import { LOOKUP_FIELDS } from "./lookups";

export function setReferenceFields(record: FlatfileRecord) {
  Object.keys(LOOKUP_FIELDS).forEach((field) => {
    if (!record.get(field)) return;
    const links = record.getLinks(field);
    LOOKUP_FIELDS[field].forEach(({ targetField, lookupField }) => {
      const lookupValue = links?.[0]?.[lookupField];
      if (lookupValue !== undefined) {
        record.compute(targetField, () => lookupValue, "From linked file");
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
