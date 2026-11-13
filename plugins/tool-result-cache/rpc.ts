import { Rpc } from "@opencode/plugin";
import { z } from "zod";

export const ToolResultCacheRpc = Rpc.define({
  id: "tool-result-cache",
  methods: {
    clear: {
      input: z.object({ sessionID: z.string() }),
      output: z.object({ cleared: z.number() }),
    },
  },
  events: {},
});
