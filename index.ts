import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import api from "@flatfile/api";
import { mapValues } from "./utils";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import { clearInvalidCodeField, setReferenceFields } from "./references";

export default function (listener: FlatfileListener) {
  listener.use(
    automap({
      accuracy: "confident",
      defaultTargetSheet: "Import",
      matchFilename: /^.*\.(csv|xlsx|xls)$/gi,
      debug: true,
      onFailure: (err) => console.error("error:", err),
    }),
  );

  listener.on("workbook:created", async (event) => {
    const workbookId = event.context.workbookId;
    try {
      const sheets = (await api.sheets.list({ workbookId })).data;
      const copyDataSheets = sheets.filter(
        ({ config: { metadata } }) => metadata?.dataSheetId,
      );
      await Promise.all(
        copyDataSheets.map(async ({ id: newSheetId, config: { metadata } }) => {
          // Fetch data from the source sheet
          const sourceRecords = await api.records.get(metadata.dataSheetId);
          // Copy data to the new sheet
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
      // Persist readiness so any container can see it
      const { data: currentWorkbook } = await api.workbooks.get(workbookId);
      await api.workbooks.update(workbookId, {
        metadata: {
          ...currentWorkbook.metadata,
          referenceDataReady: true,
        },
      });
    } catch (err) {
      console.error("Reference copy failed:", err);
    }
  });

  // Local cache to avoid API calls once we know it's ready
  let localReferenceReady = false;

  listener.use(
    bulkRecordHook("*", async (records: FlatfileRecord[], event) => {
      try {
        const { workbookId } = event.context;

        // 1. Check local cache first (Fastest)
        if (!localReferenceReady) {
          const start = Date.now();

          while (Date.now() - start < 30_000) {
            const { data: workbook } = await api.workbooks.get(workbookId);

            if (workbook.metadata?.referenceDataReady) {
              localReferenceReady = true; // Set local cache
              break;
            }
            // Increase delay slightly to be gentler on the API
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        // 2. Proceed with logic
        return records.map((record) => {
          setReferenceFields(record);
          clearInvalidCodeField(record);
          return record;
        });
      } catch (error) {
        console.error(`Error at bulkRecordHook: ${error}`);
        return records;
      }
    }),
  );
}
