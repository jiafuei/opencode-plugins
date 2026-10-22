import { Rpc } from "@opencode/plugin";
import { Schema } from "effect";

// Usage and search preparation run on the server, which holds the OAuth credential.
export const ClaudeOAuthRpc = Rpc.define({
  id: "claude-oauth",
  events: {},
  methods: {
    prepareSearch: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ integrationID: Schema.String, body: Schema.String, beta: Schema.optional(Schema.String) })),
      output: Schema.toStandardSchemaV1(Schema.Struct({ url: Schema.String })),
    },
    usage: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Schema.Struct({
        limits: Schema.Array(Schema.Struct({
          kind: Schema.String,
          percent: Schema.Number,
          resetsAt: Schema.NullOr(Schema.String),
        })),
        extraUsage: Schema.Boolean,
      })),
    },
  },
});
