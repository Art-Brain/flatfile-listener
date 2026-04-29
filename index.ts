import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import api from "@flatfile/api";
import { mapValues } from "./utils";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import { clearInvalidCodeField, setReferenceFields } from "./references";

export default function (listener: FlatfileListener) {
  // Shared promise to prevent "Thundering Herd" API polling in the same container
  let readyPromise: Promise<void> | null = null;

  listener.use(
    automap({
      accuracy: "confident",
      defaultTargetSheet: "Import",
      matchFilename: /^.*\.(csv|xlsx|xls)$/gi,
      debug: true,
      onFailure: (err) => console.error("error:", err),
    }),
  );

  // 1. Handle Workbook Creation & Data Sync
  listener.on("workbook:created", async (event) => {
    const workbookId = event.context.workbookId;
    try {
      const sheets = (await api.sheets.list({ workbookId })).data;
      const copyDataSheets = sheets.filter(
        ({ config: { metadata } }) => metadata?.dataSheetId,
      );

      // Track sheet IDs that need to finish committing before we are "Ready"
      const pendingSheetIds = copyDataSheets.map((s) => s.id);

      // Initialize metadata with the pending list
      await api.workbooks.update(workbookId, {
        metadata: {
          referenceDataReady: pendingSheetIds.length === 0,
          pendingReferenceSheets: pendingSheetIds,
        },
      });

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
            // This insert triggers the commit that commit:completed will catch
            await api.records.insert(newSheetId, records);
          } else {
            // If no records, manually remove it from pending via a metadata update
            const { data: currentWorkbook } =
              await api.workbooks.get(workbookId);
            const remaining = (
              currentWorkbook.metadata?.pendingReferenceSheets || []
            ).filter((id: string) => id !== newSheetId);
            await api.workbooks.update(workbookId, {
              metadata: {
                ...currentWorkbook.metadata,
                pendingReferenceSheets: remaining,
                referenceDataReady: remaining.length === 0,
              },
            });
          }
        }),
      );
    } catch (err) {
      console.error("Reference copy failed:", err);
    }
  });

  // 2. Monitor Commits to toggle readiness
  listener.on("commit:completed", async (event) => {
    const { workbookId, sheetId } = event.context;
    try {
      const { data: workbook } = await api.workbooks.get(workbookId);

      if (workbook.metadata?.referenceDataReady) return;

      const pending: string[] = workbook.metadata?.pendingReferenceSheets ?? [];
      if (!pending.includes(sheetId)) return;

      const remaining = pending.filter((id) => id !== sheetId);

      await api.workbooks.update(workbookId, {
        metadata: {
          ...workbook.metadata,
          pendingReferenceSheets: remaining,
          referenceDataReady: remaining.length === 0,
        },
      });
      console.log(`Sheet ${sheetId} committed. Remaining: ${remaining.length}`);
    } catch (err) {
      console.error("Error in commit:completed:", err);
    }
  });

  // 3. Record Hook with Singleton Polling
  listener.use(
    bulkRecordHook(
      "*",
      async (records: FlatfileRecord[], event) => {
        try {
          const { workbookId } = event.context;

          // Ensure only ONE poll loop runs per container instance
          if (!readyPromise) {
            readyPromise = (async () => {
              const start = Date.now();
              while (Date.now() - start < 15_000) {
                // 15s timeout for safety
                const { data: wb } = await api.workbooks.get(workbookId);
                if (wb.metadata?.referenceDataReady) return;
                await new Promise((r) => setTimeout(r, 1000));
              }
              console.warn("Reference data polling timed out after 15s");
            })();
          }

          // All batches wait here for the same promise to resolve
          await readyPromise;

          return records.map((record) => {
            setReferenceFields(record);
            clearInvalidCodeField(record);
            return record;
          });
        } catch (error) {
          console.error(`Error at bulkRecordHook: ${error}`);
          return records; // Always return records to avoid UI hang
        }
      },
      { debug: true },
    ),
  );
}
