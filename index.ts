import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import { ExcelExtractor } from "@flatfile/plugin-xlsx-extractor";
import { externalConstraint } from "@flatfile/plugin-constraints";
import api from "@flatfile/api";
import { mapValues } from "./utils";
import { FlatfileRecord, bulkRecordHook } from "@flatfile/plugin-record-hook";

export default function (listener: FlatfileListener) {
  listener.use(
    externalConstraint(
      "transformer",
      (value: any, key: string, { config, record }) => {
        if (config.allow_nulls && value === null) {
          return; // Allow null values if specified in config
        }

        // Get the transformation code from the config
        const code = config.code;

        // Create a function from the code string
        const transform = new Function("value", "record", "return " + code);

        try {
          // Apply the transformation
          const transformedValue = transform(value, record.toJSON());

          // Set the transformed value
          record.set(key, transformedValue);

          // Optionally, add info about the transformation
          record.addInfo(key, "Value has been transformed");
        } catch (error) {
          // If there's an error in the transformation, add an error to the record
          record.addError(key, "Transformation failed: " + error.message);
        }
      }
    )
  );

  listener.use(
    externalConstraint(
      "code",
      (value: any, key: string, { config, record }) => {
        if (config.allow_nulls && value === null) {
          return; // Allow null values if specified in config
        }

        // Adjust AI generated code to be compatible and run
        const code = config.code
          .replaceAll("asString", "String")
          .replaceAll("asNumber", "Number");
        const validate = new Function("return " + code)();
        const res = {
          err: (message: string) => {
            record.addError(key, message);
          },
        };

        validate(value, record.toJSON(), res);
      }
    )
  );

  listener.on("job:ready", { job: "space:configure" }, async (event) => {
    // const { spaceId } = event.context;
    // console.log('job:ready', 'spaceId', spaceId,)
  });

  listener.use(
    ExcelExtractor({ rawNumbers: true, raw: true, skipEmptyLines: true })
  );

  listener.use(
    automap({
      accuracy: "confident",
      defaultTargetSheet: "Import",
      matchFilename: /^.*\.(csv|xlsx)$/gi,
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
    bulkRecordHook("*", async (records: FlatfileRecord[], event) => {
      records.map((record) => {
        if (record.get("paddleNumber")) {
          const links = record.getLinks("paddleNumber");
          const lookupValue = links?.[0]?.["email"];
          const targetField = "bidder";
          if (lookupValue !== undefined) {
            record.set(targetField, lookupValue);
            record.addInfo(targetField, "From linked file");
          }
        }

        if (record.get("code")) {
          const links = record.getLinks("code");
          const lookupValue = links?.[0]?.["departments"];
          const targetField = "departments";
          if (lookupValue !== undefined) {
            record.set(targetField, lookupValue);
            record.addInfo(targetField, "From linked file");
          }
        }

        if (record.get("code")) {
          const links = record.getLinks("code");
          const lookupValue = links?.[0]?.["categories"];
          const targetField = "categories";
          if (lookupValue !== undefined) {
            record.set(targetField, lookupValue);
            record.addInfo(targetField, "From linked file");
          }
        }

        if (record.get("code")) {
          const links = record.getLinks("code");
          const lookupValue = links?.[0]?.["optionalTags"];
          const targetField = "optionalTags";
          if (lookupValue !== undefined) {
            record.set(targetField, lookupValue);
            record.addInfo(targetField, "From linked file");
          }
        }

        return record;
      });
    })
  );
}
