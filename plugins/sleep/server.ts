import { Plugin } from "@opencode/plugin";
import { setTimeout } from "node:timers/promises";
import { Schema } from "effect";

export default Plugin.define({
  id: "sleep",
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "sleep",
        description: "Wait for the specified number of milliseconds. Cancelling the tool stops the wait.",
        input: Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Schema.Struct({
          ms: Schema.Number.annotate({ description: "Duration to wait in milliseconds." }),
        }))),
        output: Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Schema.Struct({
          ms: Schema.Number,
        }))),
        options: { codemode: true },
        execute: async ({ ms }, context) => {
          await setTimeout(ms, undefined, { signal: context.signal });
          return { output: { ms } };
        },
      });
    });
  },
});
