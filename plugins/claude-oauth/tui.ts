import { Plugin } from "@opencode/plugin/tui";
import { ClaudeOAuthRpc } from "./rpc.ts";

const LIMIT_LABELS: Record<string, string> = { session: "5-hour session", weekly_all: "Weekly (all models)" };

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
                const lines = usage.limits.map((limit) => {
                  const reset = limit.resetsAt
                    ? ` · resets ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "";
                  return `${LIMIT_LABELS[limit.kind] ?? limit.kind}: ${limit.percent}%${reset}`;
                });
                lines.push(`Extra usage: ${usage.extraUsage ? "enabled" : "disabled"}`);
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
