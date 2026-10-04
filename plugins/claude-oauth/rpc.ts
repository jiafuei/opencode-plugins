import { Rpc } from "@opencode/plugin";
import { Schema } from "effect";

// The TUI's /anthropic-usage command reads plan limits through the server, which holds the OAuth credential.
export const ClaudeOAuthRpc = Rpc.define({
  id: "claude-oauth",
  events: {},
  methods: {
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
