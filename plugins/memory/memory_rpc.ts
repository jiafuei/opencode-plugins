import { Rpc } from "@opencode/plugin";
import { Schema } from "effect";

// Shared server <-> TUI contract. The TUI requests manual dreams and listens
// for review, save, and dream status events instead of watching files.
export const MemoryRpc = Rpc.define({
  id: "memory",
  methods: {
    dream: {
      input: Schema.toStandardSchemaV1(Schema.Struct({ requestID: Schema.String, sessionID: Schema.optional(Schema.String) })),
      output: Schema.toStandardSchemaV1(Schema.Struct({})),
    },
  },
  events: {
    review: { schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String })) },
    saved: { schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, title: Schema.String })) },
    dream: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({
        requestID: Schema.NullOr(Schema.String),
        runID: Schema.String,
        state: Schema.Literals(["running", "changed", "noop", "failed"]),
        sessionID: Schema.optional(Schema.String),
        startedAt: Schema.optional(Schema.String),
        finishedAt: Schema.optional(Schema.String),
        counts: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
        message: Schema.optional(Schema.String),
      })),
    },
  },
});

export type DreamStatus = Rpc.EventData<typeof MemoryRpc.events.dream.schema>;
