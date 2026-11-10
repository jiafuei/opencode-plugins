import { Rpc } from "@opencode/plugin";
import { Schema } from "effect";

const Money = Schema.Struct({ amountMinor: Schema.Number, currency: Schema.String, exponent: Schema.Number });

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
          group: Schema.String,
          percent: Schema.Number,
          resetsAt: Schema.NullOr(Schema.String),
          model: Schema.NullOr(Schema.String),
          surface: Schema.NullOr(Schema.String),
          severity: Schema.String,
          isActive: Schema.Boolean,
          weeklyShare: Schema.NullOr(Schema.Struct({
            usedPercent: Schema.Number,
            allowancePercent: Schema.Number,
          })),
        })),
        weeklyBreakdown: Schema.NullOr(Schema.Struct({
          asOf: Schema.String,
          windowStartedAt: Schema.String,
          rows: Schema.Array(Schema.Struct({ key: Schema.String, displayName: Schema.String, percent: Schema.Number })),
        })),
        spend: Schema.Struct({
          used: Money,
          limit: Schema.NullOr(Money),
          percent: Schema.Number,
          severity: Schema.String,
        }),
        extraUsage: Schema.Struct({
          enabled: Schema.Boolean,
          disabledReason: Schema.NullOr(Schema.String),
          userDisabled: Schema.Boolean,
          spendLimitReached: Schema.Boolean,
        }),
      })),
    },
  },
});
