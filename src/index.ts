import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import api from "@flatfile/api";
import { mapValues } from "./utils/object";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import {
  getLookupData,
  getLookupDataByWorkbook,
  saveLookupDataOnWorkbookMetadata,
} from "./lookup/cache";
import { xlsxExtractorPlugin } from "@flatfile/plugin-xlsx-extractor";
import { CATEGORIES_SHEET_NAME, LOOKUP_FIELDS } from "./config/lookups";
import { runDynamicHooks } from "./hooks/dynamic";
import { referenceLookupHook } from "./hooks/reference-lookup";

export default function (listener: FlatfileListener) {
  listener.use(xlsxExtractorPlugin());
  listener.use(
    automap({
      accuracy: "confident",
      defaultTargetSheet: "Import",
      matchFilename: /^.*\.(csv|xlsx|xls)$/gi,
      debug: true,
      onFailure: async (event) => {
        console.error("error: oh!", event);
      },
    }),
  );
  listener.use(runDynamicHooks);

  // Still copy data into the categories sheet so the UI/links work for the user
  listener.on("workbook:created", async (event) => {
    const workbookId = event.context.workbookId;
    try {
      const { data: sheets } = await api.sheets.list({ workbookId });
      const copyDataSheets = sheets.filter(
        ({ config: { metadata } }) => metadata?.dataSheetId,
      );
      await Promise.all(
        copyDataSheets.map(async ({ id: newSheetId, config: { metadata } }) => {
          const sourceRecords = await api.records.get(metadata.dataSheetId);
          if (sourceRecords?.data?.records?.length) {
            const records = sourceRecords.data.records.map(({ values }) =>
              mapValues(values, ({ value, messages, valid }) => ({
                value,
                messages,
                valid,
              })),
            );
            await api.records.insert(newSheetId, records);
          }
        }),
      );
      const lookupData = await getLookupDataByWorkbook(workbookId);
      await saveLookupDataOnWorkbookMetadata(workbookId, lookupData);
    } catch (err) {
      console.error("Reference copy failed:", err);
    }
  });

  // registration sheets refresh lookup cache when uploaded/updated
  Object.values(LOOKUP_FIELDS).forEach(({ refSheetName }) => {
    if (!refSheetName) return;
    listener.use(
      bulkRecordHook(refSheetName, async (records: FlatfileRecord[], event) => {
        try {
          const { workbookId, sheetId } = event.context;
          const lookupData = await getLookupData(workbookId, [sheetId], true);

          await saveLookupDataOnWorkbookMetadata(workbookId, lookupData);
        } catch (error) {
          console.error(
            `Error updating lookup data from ${refSheetName}: ${error}`,
          );
        }
        return records;
      }),
    );
  });

  // reference lookup hooks
  Object.keys(LOOKUP_FIELDS).forEach((sheetSlug) => {
    listener.use(
      bulkRecordHook(sheetSlug.toLowerCase(), referenceLookupHook, {
        debug: true,
      }),
    );
  });

  // Make sure categories sheet is always processed and the submit button is enabled
  listener.use(bulkRecordHook(CATEGORIES_SHEET_NAME, (records) => records));
}
