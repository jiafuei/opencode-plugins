import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";

export default Plugin.define({
  id: "model_glob",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "model_glob",
        description: "Search model IDs from connected providers using a case-insensitive substring and return each model's available variants. Use when user asks for a specific model for subagents or 'task' tool.",
        input: Schema.Struct({
          text: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "Case-insensitive substring to find in provider/model IDs." }),
        }),
        execute: async ({ text }) => {
          const { data } = await ctx.model.list();
          const query = text.toLowerCase();
          const matches = data
            .map((model) => ({
              id: `${model.providerID}/${model.id}`,
              variants: model.variants.map((variant) => variant.id),
            }))
            .filter((model) => model.id.toLowerCase().includes(query))
            .sort((a, b) => a.id.localeCompare(b.id));

          return { content: JSON.stringify(matches) };
        },
      });
    });
  },
});
