import { BrowserSession } from "./browser.ts";
import type { Reply, Request } from "./protocol.ts";

if (!process.send) throw new Error("The browser worker must be started by the plugin with IPC enabled.");
const send = process.send.bind(process);
const browser = new BrowserSession();

process.on("message", async (request: Request) => {
  let reply: Reply;
  try {
    reply = { id: request.id, ok: true, result: await browser.execute(request.command) };
  } catch (error) {
    reply = { id: request.id, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 4000) };
  }
  send(reply, () => {
    if (request.command.method === "close") process.exit(0);
  });
});

process.on("disconnect", () => {
  browser.close().then(() => process.exit(0), (error) => {
    console.error("browser: worker cleanup failed", error);
    process.exit(1);
  });
});
