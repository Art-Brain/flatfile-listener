import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import api from "@flatfile/api";
import { mapValues } from "./utils";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import {
  clearInvalidCodeFieldSafe,
  getLookupData,
  getLookupDataFromWorkbookMetadata,
  saveLookupDataOnWorkbookMetadata,
  setReferenceFieldsFromCache,
} from "./references";

export default function (listener: FlatfileListener) {
  listener.use(
    automap({
      accuracy: "exact",
      defaultTargetSheet: "Import",
      matchFilename: /^.*\.(csv|xlsx|xls)$/gi,
      debug: true,
      onFailure: async (event) => {
        console.error("error: oh!", event);
        const { spaceId, fileId } = event.context;
        await api.documents.create(spaceId, {
          title: "Action Required: Manual Mapping Needed",
          body:
            "# Upload could not be auto-mapped\n\n" +
            `Your file (\`${fileId}\`) didn't match the expected schema exactly. ` +
            "Please contact support or re-upload using the original template.",
          treatments: ["ephemeral"], // full-screen takeover for focus
        });
      },
    }),
  );

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
      const lookupData = await getLookupData(workbookId);
      await saveLookupDataOnWorkbookMetadata(workbookId, lookupData);
    } catch (err) {
      console.error("Reference copy failed:", err);
    }
  });

  listener.use(
    bulkRecordHook(
      "*",
      async (records: FlatfileRecord[], event) => {
        try {
          const { workbookId } = event.context;
          let anyChanges = false;
          const cache =
            (await getLookupDataFromWorkbookMetadata(workbookId)) ??
            (await getLookupData(workbookId));

          const newRecords = records.map((record) => {
            const recordChanged = setReferenceFieldsFromCache(record, cache);
            const recordChanged2 = clearInvalidCodeFieldSafe(record, cache);
            anyChanges = anyChanges || recordChanged || recordChanged2;
            return record;
          });
          console.log("anyChanges", anyChanges);
          if (anyChanges) {
            return newRecords;
          }
          // return newRecords;
        } catch (error) {
          console.error(`Error at bulkRecordHook: ${error}`);
          throw error;
        }
      },
      { debug: true },
    ),
  );
}
