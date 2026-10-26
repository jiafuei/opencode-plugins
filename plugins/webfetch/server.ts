import { Plugin } from "@opencode/plugin";
import { Schema } from "effect";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { exaContents } from "./exa.ts";
import { WebFetcher } from "./fetch.ts";
import { NATIVE_PROFILES } from "./profiles.ts";

export default Plugin.define({
  id: "webfetch_enhanced",
  async setup(ctx) {
    async function exaKey() {
      const connection = await ctx.integration.connection.active("exa");
      const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined;
      return credential?.type === "key" ? credential.key : undefined;
    }
    let exaEnabled = Boolean(await exaKey());
    async function refresh() {
      const enabled = Boolean(await exaKey());
      if (enabled === exaEnabled) return;
      exaEnabled = enabled;
      await ctx.tool.reload();
    }
    await ctx.tool.transform((tools) => {
      const profiles = [...NATIVE_PROFILES, ...(exaEnabled ? ["exa" as const] : [])];
      const Input = Schema.Struct({
        url: Schema.String.annotate({ description: "HTTP or HTTPS URL to read." }),
        fresh: Schema.optional(Schema.Boolean).annotate({ description: "Ignore cached results and fetch the page again." }),
        profile: Schema.optional(Schema.Literals(profiles)).annotate({ description: "Omit for standard local HTTP. Browser profiles impersonate a browser locally; exa sends the URL to the Exa service. Call webfetch_profile to list profiles." }),
        cookies: Schema.optional(Schema.String).annotate({ description: "Path to a cookies.txt file for this fetch. Ignored by exa." }),
      });
      tools.add({
        name: "webfetch_profile",
        description: "List the profiles available to webfetch. Omit profile from a fetch to use standard local HTTP.",
        input: Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Schema.Struct({}))),
        options: { codemode: false },
        async execute() {
          return { content: [...NATIVE_PROFILES, ...(exaEnabled ? ["exa"] : [])].join("\n") };
        },
      });
      tools.add({
        name: ctx.options.replace === true ? "webfetch" : "webfetch_enhanced",
        description: "Read a webpage as Markdown. Fetches locally by default. Does not run JavaScript.",
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
          const signal = AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]);
          if (input.profile === "exa") {
            const key = await exaKey();
            if (!key) throw new Error("Connect the Exa integration in OpenCode before selecting profile exa.");
            return { content: await exaContents(ctx.storage, url, key, input.fresh ?? false, signal) };
          }
          let cookieFile: string | undefined;
          if (input.cookies) {
            cookieFile = resolve(ctx.location.directory, input.cookies);
            await ctx.permission.assert({
              sessionID: context.sessionID,
              agent: context.agent,
              source: { type: "tool", messageID: context.messageID, id: context.id },
              action: "read",
              resources: [cookieFile],
              save: [cookieFile],
              metadata: { path: cookieFile },
            });
            // libcurl silently ignores unreadable cookie files; fail before fetching.
            await access(cookieFile, constants.R_OK);
          }
          const fetcher = new WebFetcher(ctx.storage, input.profile, cookieFile);
          return { content: await fetcher.read(url, input.fresh ?? false, signal) };
        },
      });
    });
    const subscription = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: subscription.signal })) {
        if (event.type === "credential.updated" || event.type === "credential.switched" || event.type === "integration.updated") await refresh();
      }
    })().catch((error) => {
      if (!subscription.signal.aborted) console.error("Webfetch profile refresh failed:", error);
    });
    return () => subscription.abort();
  },
});
