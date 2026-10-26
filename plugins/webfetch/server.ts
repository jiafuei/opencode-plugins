import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import { WebFetcher } from "./fetch.ts";

const Input = Schema.Struct({
  url: Schema.String.annotate({ description: "Public HTTP or HTTPS URL to read as Markdown." }),
  fresh: Schema.optional(Schema.Boolean).annotate({ description: "Bypass content and Markdown/llms.txt discovery caches and update them with fresh results." }),
});

export default Plugin.define({
  id: "webfetch_enhanced",
  async setup(ctx) {
    const fetcher = new WebFetcher(ctx.storage);
    await ctx.tool.transform((tools) => {
      tools.add({
        name: ctx.options.replace === true ? "webfetch" : "webfetch_enhanced",
        description: "Read a public webpage as clean Markdown. Tries a .md version first; otherwise prunes HTML clutter while preserving code, tables, and links. Reports the nearest llms.txt index URL without including its contents. Content uses HTTP caching or a 15-minute default; discovery is cached for 30 days. Use fresh to bypass both. No browser rendering or authenticated access.",
        input: Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Input)),
        options: { codemode: false, permission: "webfetch" },
        async execute(input, context) {
          const url = new URL(input.url);
          if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must use http:// or https://");
          url.hash = "";
          await ctx.permission.assert({
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.messageID, id: context.id },
            action: "webfetch",
            resources: [input.url],
            save: ["*"],
            metadata: input,
          });
          return { content: await fetcher.read(url, input.fresh ?? false, AbortSignal.any([context.signal, AbortSignal.timeout(30_000)])) };
        },
      });
    });
  },
});
