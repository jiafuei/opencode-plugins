import { Rpc } from "@opencode/plugin";
import { z } from "zod";

export const OpenRouterRpc = Rpc.define({
  id: "openrouter-settings",
  methods: {
    open: {
      input: z.object({ sessionID: z.string().optional() }),
      output: z.object({ url: z.string() }),
    },
  },
});
