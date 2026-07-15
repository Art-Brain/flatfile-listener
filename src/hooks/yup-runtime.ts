import FlatfileListener from "@flatfile/listener";
import { externalConstraint } from "@flatfile/plugin-constraints";
import api, { Flatfile } from "@flatfile/api";
import * as Yup from "yup";
import {
  coerceValueForField,
  formatYupValidationError,
  getCachedFieldValidator,
  type FieldSchemaDescription,
  type YupSchemaMetadata,
} from "../yup/rebuild-from-describe";

/** externalConstraint support has no `sheet`, so fetch it once per sheetId. */
const sheetCache = new Map<string, Flatfile.Sheet>();

async function getSheet(sheetId: string): Promise<Flatfile.Sheet> {
  let sheet = sheetCache.get(sheetId);
  if (!sheet) {
    const { data } = await api.sheets.get(sheetId);
    sheet = data;
    sheetCache.set(sheetId, sheet);
  }
  return sheet;
}

async function getSheetYupSchema(
  sheetId: string,
): Promise<YupSchemaMetadata | undefined> {
  const sheet = await getSheet(sheetId);
  return sheet?.config?.metadata?.yupSchema ?? sheet?.metadata?.yupSchema;
}

/**
 * Flatfile externalConstraint "yup-runtime": rebuild Yup validators from
 * sheet metadata.yupSchema (Artbrain SchemaDescription JSON) and validate cells.
 */
export function registerYupRuntimeConstraint(listener: FlatfileListener) {
  listener.use(
    externalConstraint("yup-runtime", async (value, key, support) => {
      const schemaMetadata = await getSheetYupSchema(
        support.event.context.sheetId,
      );
      if (!schemaMetadata?.fields) return;

      const fieldDescription = schemaMetadata.fields[key] as
        | FieldSchemaDescription
        | undefined;
      if (!fieldDescription) return;

      try {
        const validator = getCachedFieldValidator(
          schemaMetadata,
          key,
          fieldDescription,
        );
        if (!validator) return;

        const coerced = coerceValueForField(value, fieldDescription.type);
        validator.validateSync(coerced, { abortEarly: false });
      } catch (error) {
        if (error instanceof Yup.ValidationError) {
          support.record.addError(key, formatYupValidationError(error));
        } else {
          console.error(
            `yup-runtime evaluation failed for field: ${key}`,
            error,
          );
        }
      }
    }),
  );
}
