import { Rpc } from "@opencode/plugin";
import { Schema } from "effect";

// The TUI's /codex-usage command reads plan limits through the server, which can resolve the OpenAI credential.
export const CodexUsageRpc = Rpc.define({
  id: "codex-usage",
  methods: {
    usage: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Schema.Struct({
        plan: Schema.String,
        windows: Schema.Array(Schema.Struct({
          usedPercent: Schema.Number,
          windowSeconds: Schema.Number,
          resetAt: Schema.Number,
        })),
      })),
    },
  },
});
