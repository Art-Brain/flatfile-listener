import type { FlatfileListener } from "@flatfile/listener";
import { automap } from "@flatfile/plugin-automap";
import { ExcelExtractor } from "@flatfile/plugin-xlsx-extractor";
import { externalConstraint } from "@flatfile/plugin-constraints";

export default function (listener: FlatfileListener) {
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
      onFailure: (err) => console.error(err),
    })
  );
}
