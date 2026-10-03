import { Plugin } from "@opencode/plugin";
import { CodexUsageRpc } from "./rpc.ts";

// Configure in `opencode.json` like:
//
// {
//   "plugins": ["@jiafuei/opencode-codex-usage"]
// }
//
// Then connect OpenAI with a ChatGPT login and run /codex-usage.

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

type Window = { used_percent: number; limit_window_seconds: number; reset_at: number };

export default Plugin.define({
  id: "codex-usage",
  setup: async (ctx) => {
    // The Codex CLI's usage request (September 26 capture).
    await ctx.rpc.register(CodexUsageRpc, {
      usage: async () => {
        const connection = await ctx.integration.connection.active("openai");
        // Resolving refreshes a token close to expiry.
        const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined;
        if (credential?.type !== "oauth") throw new Error("OpenAI is not connected with a ChatGPT login.");
        const response = await fetch(USAGE_URL, {
          headers: {
            Authorization: `Bearer ${credential.access}`,
            "chatgpt-account-id": credential.metadata?.accountID as string,
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Codex usage request failed: ${response.status}`);
        const usage = (await response.json()) as {
          plan_type: string;
          rate_limit: { primary_window: Window | null; secondary_window: Window | null };
        };
        return {
          plan: usage.plan_type,
          windows: [usage.rate_limit.primary_window, usage.rate_limit.secondary_window]
            .filter((window) => window !== null)
            .map((window) => ({ usedPercent: window.used_percent, windowSeconds: window.limit_window_seconds, resetAt: window.reset_at })),
        };
      },
    });
  },
});
