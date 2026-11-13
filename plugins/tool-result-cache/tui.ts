import { Plugin } from "@opencode/plugin/tui";
import { ToolResultCacheRpc } from "./rpc.ts";

export default Plugin.define({
  id: "tool-result-cache",
  setup(ctx) {
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "tool-result-cache.clear",
        title: "Clear tool result cache",
        group: "Tools",
        palette: true,
        slash: { name: "clear-tool-result-cache" },
        enabled: () => ctx.ui.router.current().type === "session",
        run: async () => {
          const route = ctx.ui.router.current();
          if (route.type !== "session") return;
          try {
            const session = ctx.data.session.get(route.sessionID);
            const location = session?.location ?? ctx.location ?? ctx.data.location.default();
            const { cleared } = await ctx.client.rpc(ToolResultCacheRpc).clear({ sessionID: route.sessionID }, { location });
            ctx.ui.toast.show({ variant: "success", message: `Cleared ${cleared} cached tool results.` });
          } catch (error) {
            ctx.ui.toast.show({ variant: "error", message: error instanceof Error ? error.message : String(error) });
          }
        },
      }],
    }));
  },
});
