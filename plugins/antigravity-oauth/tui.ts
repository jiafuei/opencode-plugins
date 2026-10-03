import { Plugin } from "@opencode/plugin/tui";
import { AntigravityRpc } from "./rpc.ts";

const WINDOW_LABELS: Record<string, string> = { "5h": "5-hour", weekly: "Weekly" };

export default Plugin.define({
  id: "antigravity-oauth",
  setup(ctx) {
    return ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "antigravity-oauth.usage",
            title: "Antigravity usage",
            group: "Antigravity",
            palette: true,
            slash: { name: "antigravity-usage" },
            run: async () => {
              try {
                const location = ctx.location ?? ctx.data.location.default();
                const usage = await ctx.client.rpc(AntigravityRpc).usage({}, { location });
                const lines = usage.groups.flatMap((group) => [
                  group.name,
                  ...group.buckets.map((bucket) => {
                    const used = Math.round((1 - bucket.remainingFraction) * 100);
                    const reset = new Date(bucket.resetTime).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
                    return `  ${WINDOW_LABELS[bucket.window] ?? bucket.window}: ${used}% · resets ${reset}`;
                  }),
                ]);
                await ctx.ui.dialog.alert({ title: "Antigravity usage", message: lines.join("\n") });
              } catch (error) {
                ctx.ui.toast.show({ variant: "error", title: "Antigravity usage", message: error instanceof Error ? error.message : String(error) });
              }
            },
          }],
        }));
        return null;
      },
    });
  },
});
