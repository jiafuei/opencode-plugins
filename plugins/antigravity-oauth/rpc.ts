import { Rpc } from "@opencode/plugin";
import { Schema } from "effect";

// The TUI's /antigravity-usage command reads quota through the server, which holds the OAuth credential.
export const AntigravityRpc = Rpc.define({
  id: "antigravity-oauth",
  methods: {
    usage: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Schema.Struct({
        groups: Schema.Array(Schema.Struct({
          name: Schema.String,
          buckets: Schema.Array(Schema.Struct({
            window: Schema.String,
            remainingFraction: Schema.Number,
            resetTime: Schema.String,
          })),
        })),
      })),
    },
  },
});
