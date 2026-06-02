import type { FlatfileEvent } from "@flatfile/listener";
import { FlatfileRecord } from "@flatfile/plugin-record-hook";
import {
  clearInvalidCodeFieldSafe,
  getLookupDataFromWorkbookMetadata,
  setReferenceFieldsFromCache,
} from "../lookup/cache";

export async function referenceLookupHook(
  records: FlatfileRecord[],
  event: FlatfileEvent,
) {
  try {
    const { workbookId } = event.context;
    let cache = await getLookupDataFromWorkbookMetadata(workbookId);
    if (!cache) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      cache = await getLookupDataFromWorkbookMetadata(workbookId);
    }
    if (!cache) {
      throw new Error(
        `Lookup cache missing for workbook ${workbookId} after retry`,
      );
    }

    return records.map((record) => {
      setReferenceFieldsFromCache(record, cache);
      clearInvalidCodeFieldSafe(record, cache);
      return record;
    });
  } catch (error) {
    console.error(`Error at bulkRecordHook: ${error}`);
    return records;
  }
}
