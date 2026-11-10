import { Plugin } from "@opencode/plugin/tui";
import { ClaudeOAuthRpc } from "./rpc.ts";

const LIMIT_LABELS: Record<string, string> = { session: "5-hour session", weekly_all: "Weekly (all models)", weekly_scoped: "Weekly" };
const GROUP_LABELS: Record<string, string> = { session: "Session limits", weekly: "Weekly limits" };

export default Plugin.define({
  id: "claude-oauth",
  setup(ctx) {
    return ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "claude-oauth.usage",
            title: "Anthropic usage",
            group: "Anthropic",
            palette: true,
            slash: { name: "anthropic-usage" },
            run: async () => {
              try {
                const location = ctx.location ?? ctx.data.location.default();
                const usage = await ctx.client.rpc(ClaudeOAuthRpc).usage({}, { location });
                const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
                const dateOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } as const;
                const lines: string[] = [];
                for (const [index, limit] of usage.limits.entries()) {
                  if (index === 0 || limit.group !== usage.limits[index - 1].group) {
                    if (index > 0) lines.push("");
                    lines.push(GROUP_LABELS[limit.group] ?? limit.group);
                  }
                  const scope = [limit.model, limit.surface].filter(Boolean).join(", ");
                  const label = `${LIMIT_LABELS[limit.kind] ?? limit.kind}${scope ? ` (${scope})` : ""}`;
                  const reset = limit.resetsAt
                    ? ` · resets ${new Date(limit.resetsAt).toLocaleString(undefined, dateOptions)}`
                    : "";
                  const status = limit.severity === "normal" ? "" : ` · ${limit.severity}`;
                  lines.push(`${label}: ${percent.format(limit.percent)}%${reset}${status}${limit.isActive ? " · current limit" : ""}`);
                  if (limit.weeklyShare) {
                    lines.push(`  Share of weekly total: ${percent.format(limit.weeklyShare.usedPercent)}% used · ${percent.format(limit.weeklyShare.allowancePercent)}% allowance`);
                  }
                }
                if (usage.weeklyBreakdown) {
                  const breakdown = usage.weeklyBreakdown;
                  lines.push("", "Weekly usage breakdown");
                  lines.push(`Since ${new Date(breakdown.windowStartedAt).toLocaleString(undefined, dateOptions)} · as of ${new Date(breakdown.asOf).toLocaleString(undefined, dateOptions)}`);
                  for (const row of breakdown.rows) lines.push(`${row.displayName}: ${percent.format(row.percent)}%`);
                }
                lines.push("", `Extra usage: ${usage.extraUsage.enabled ? "enabled" : "disabled"}`);
                if (usage.extraUsage.disabledReason) lines.push(`Reason: ${usage.extraUsage.disabledReason.replaceAll("_", " ")}`);
                if (usage.extraUsage.userDisabled) lines.push("Disabled by you");
                if (usage.extraUsage.spendLimitReached) lines.push("Spending limit reached");
                for (const [label, amount] of [["Spent", usage.spend.used], ["Spending limit", usage.spend.limit]] as const) {
                  if (amount === null) continue;
                  const formatted = new Intl.NumberFormat(undefined, {
                    style: "currency", currency: amount.currency,
                    minimumFractionDigits: amount.exponent, maximumFractionDigits: amount.exponent,
                  }).format(amount.amountMinor / 10 ** amount.exponent);
                  lines.push(`${label}: ${formatted}`);
                }
                if (usage.spend.limit) lines.push(`Spending limit used: ${percent.format(usage.spend.percent)}%`);
                if (usage.spend.severity !== "normal") lines.push(`Spending status: ${usage.spend.severity}`);
                await ctx.ui.dialog.alert({ title: "Anthropic usage", message: lines.join("\n") });
              } catch (error) {
                ctx.ui.toast.show({ variant: "error", title: "Anthropic usage", message: error instanceof Error ? error.message : String(error) });
              }
            },
          }],
        }));
        return null;
      },
    });
  },
});
