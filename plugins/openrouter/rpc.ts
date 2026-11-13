import { Rpc } from "@opencode/plugin";
import { z } from "zod";

export const OpenRouterRpc = Rpc.define({
  id: "openrouter-settings",
  methods: {
    open: {
      input: z.object({}),
      output: z.object({ url: z.string() }),
    },
  },
  events: {},
});
