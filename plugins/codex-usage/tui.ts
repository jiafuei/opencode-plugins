import { Plugin } from "@opencode/plugin/tui";
import { CodexUsageRpc } from "./rpc.ts";

const WINDOW_LABELS: Record<number, string> = { 18000: "5-hour", 604800: "Weekly" };

export default Plugin.define({
  id: "codex-usage",
  setup(ctx) {
    return ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "codex-usage.usage",
            title: "Codex usage",
            group: "OpenAI",
            palette: true,
            slash: { name: "codex-usage" },
            run: async () => {
              try {
                const location = ctx.location ?? ctx.data.location.default();
                const usage = await ctx.client.rpc(CodexUsageRpc).usage({}, { location });
                const lines = [
                  `Plan: ${usage.plan}`,
                  ...usage.windows.map((window) => {
                    const reset = new Date(window.resetAt * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
                    return `${WINDOW_LABELS[window.windowSeconds] ?? `${window.windowSeconds / 3600}-hour`}: ${window.usedPercent}% · resets ${reset}`;
                  }),
                ];
                await ctx.ui.dialog.alert({ title: "Codex usage", message: lines.join("\n") });
              } catch (error) {
                ctx.ui.toast.show({ variant: "error", title: "Codex usage", message: error instanceof Error ? error.message : String(error) });
              }
            },
          }],
        }));
        return null;
      },
    });
  },
});
