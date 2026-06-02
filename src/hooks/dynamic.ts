import FlatfileListener from "@flatfile/listener";
import { externalConstraint } from "@flatfile/plugin-constraints";
import { asDate, asNumber, asString } from "../utils/casting";
import { Flatfile } from "@flatfile/api";

export function runDynamicHooks(listener: FlatfileListener) {
  listener.use(
    externalConstraint("code-transformer", (value, key, support) => {
      const code = support.config.code;

      // @ts-ignore
      const simpleRecord = support.record.mutated;

      try {
        const fn = new Function(
          "asString",
          "asNumber",
          "asDate",
          `return ${code}`,
        )(asString, asNumber, asDate);
        fn(value, simpleRecord, {
          set(value: string) {
            support.record.set(key, value);
          },
          setByKey(otherKey: string, value: string) {
            support.record.set(otherKey, value);
          },
          enumMeta(value: string) {
            if ((support.property as Flatfile.Property.Enum).config?.options) {
              return (
                support.property as Flatfile.Property.Enum
              ).config.options.find((option) => option.value === value)?.meta;
            }
            return undefined;
          },
        });
      } catch (e) {
        console.log("invalid code somehow", e, code);
      }
    }),
  );
  listener.use(
    externalConstraint("code", (value, key, support) => {
      const code = support.config.code;
      // @ts-ignore
      const simpleRecord = support.record.mutated;
      if (!value && !support.config.allow_nulls) {
        return;
      }
      try {
        const fn = new Function(
          "asString",
          "asNumber",
          "asDate",
          `return ${code}`,
        )(asString, asNumber, asDate);
        fn(value, simpleRecord, {
          err(msg: string) {
            support.record.addError(key, msg);
          },
          enumMeta(value: string) {
            if ((support.property as Flatfile.Property.Enum).config?.options) {
              return (
                support.property as Flatfile.Property.Enum
              ).config.options.find((option) => option.value === value)?.meta;
            }
            return undefined;
          },
        });
      } catch (e) {
        console.log("invalid code somehow", e, code);
      }
    }),
  );
}
