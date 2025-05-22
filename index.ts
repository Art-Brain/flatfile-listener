import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import api from "@flatfile/api";
import { mapValues } from "./utils";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";
import { clearInvalidCodeField, setReferenceFields } from "./references";

function sleepSync(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait
  }
}

export default function (listener: FlatfileListener) {
  listener.use(
    automap({
      accuracy: "confident",
      defaultTargetSheet: "Import",
      matchFilename: /^.*\.(csv|xlsx|xls)$/gi,
      debug: true,
      onFailure: (err) => console.error("error:", err),
    })
  );

  listener.on("workbook:created", async (event) => {
    try {
      const workbookId = event?.context?.workbookId;
      const sheets = (await api.sheets.list({ workbookId })).data;
      const copyDataSheets = sheets.filter(
        ({ config: { metadata } }) => metadata?.dataSheetId
      );
      await Promise.all(
        copyDataSheets.map(async ({ id: newSheetId, config: { metadata } }) => {
          const dataSheetId = metadata.dataSheetId;
          console.log("copying data from", dataSheetId, "to", newSheetId);

          // Fetch data from the source sheet
          const sourceRecords = await api.records.get(dataSheetId);

          // Copy data to the new sheet
          if (
            sourceRecords?.data?.records &&
            sourceRecords.data.records.length > 0
          ) {
            const records = sourceRecords.data.records.map(({ values }) =>
              mapValues(values, ({ value, messages, valid }) => ({
                value,
                messages,
                valid,
              }))
            );
            await api.records.insert(newSheetId, records);
            console.log(
              `Data copied from sheet ${dataSheetId} to sheet ${newSheetId}`
            );
          } else {
            console.error(`No data found in source sheet ${dataSheetId}`);
          }
        })
      );
    } catch (error) {
      console.error(`Error copying sheet data: ${error}`);
    }
  });

  listener.use(
    bulkRecordHook("*", async (records: FlatfileRecord[]) => {
      try {
        // Add a delay to have time to load sheets data (for example categories)
        const delay = Math.min(Math.max(1000, records.length), 5000);
        await new Promise((res) => setTimeout(() => res(null), delay));
        return records.map((record) => {
          setReferenceFields(record);
          clearInvalidCodeField(record);
          return record;
        });
      } catch (error) {
        console.error(`Error at bulkRecordHook: ${error}`);
      }
      return records;
    })
  );
}
