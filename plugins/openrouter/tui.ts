import { Plugin } from "@opencode/plugin/tui";
import { OpenRouterRpc } from "./rpc.ts";

export default Plugin.define({
  id: "openrouter-settings",
  setup(ctx) {
    return ctx.ui.slot({
      append: "app",
      render: () => {
        ctx.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "openrouter.settings",
            title: "OpenRouter settings",
            group: "OpenRouter",
            palette: true,
            slash: { name: "openrouter" },
            run: async () => {
              try {
                const route = ctx.ui.router.current();
                const session = route.type === "session" ? ctx.data.session.get(route.sessionID) : undefined;
                const location = session?.location ?? ctx.location ?? ctx.data.location.default();
                const { url } = await ctx.client.rpc(OpenRouterRpc).open({
                  sessionID: route.type === "session" ? route.sessionID : undefined,
                }, { location });
                const command = process.platform === "darwin" ? ["open", url]
                  : process.platform === "win32" ? ["rundll32.exe", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
                const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
                if (await child.exited !== 0) {
                  await ctx.ui.dialog.alert({ title: "OpenRouter settings", message: `Open this URL in your browser:\n${url}` });
                }
              } catch (error) {
                ctx.ui.toast.show({ variant: "error", title: "OpenRouter settings", message: error instanceof Error ? error.message : String(error) });
              }
            },
          }],
        }));
        return null;
      },
    });
  },
});
