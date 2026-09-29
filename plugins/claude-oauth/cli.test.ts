import { expect, test } from "bun:test";
import net from "node:net";
import { gzipSync } from "node:zlib";
import { CLI_PROFILE, SDK_CLI_PROFILE, cliHeaders, patchCliCch, rewriteCliBody } from "./cli_wire.ts";
import { createCliRelay } from "./cli_transport.ts";
import { setupPlugin } from "./test_harness.ts";

const BODY = {
  model: "claude-opus-5-5",
  messages: [{ role: "user", content: "hello" }],
  system: [{ type: "text", text: "You are an AI agent running in OpenCode, a coding agent harness. Help the user.\n\nPreserve my OpenCode instructions." }],
  tools: [{ name: "shell", input_schema: { type: "object", properties: { command: { type: "string" } } } }],
  thinking: { type: "adaptive", display: "summarized" },
  max_tokens: 128000,
  stream: true,
};

test("native CCH golden vector includes nested model/max_tokens, fallback arrays, and UTF-8", () => {
  // Expected checksum computed independently by the native RE reference cch_repro.py.
  const body = '{"model":"claude-opus-5-5","messages":[{"role":"assistant","content":[{"type":"tool_use","name":"Agent","input":{"model":"sonnet","max_tokens":100}}]}],"system":[{"type":"text","text":"x-anthropic-billing-header: cch=00000; — λ"}],"fallbacks":[{"model":"fallback","nested":["x]",["y"]]}],"fallback_credit_token":"credit","max_tokens":128000,"stream":true}';
  expect(patchCliCch(body)).toBe(body.replace("cch=00000", "cch=d5c1f"));
});

test("CLI preserves instruction and tool semantics while namespacing definitions, choice, and history", () => {
  const input = {
    ...BODY,
    system: [...BODY.system, { type: "text", text: "Instructions from AGENTS.md: Always use OpenCode.\nDo not modify this text." },
      { type: "text", text: "Here is some useful information about the environment you are running in:\n<env>\n</env>" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "<system-reminder>Keep this exactly.</system-reminder>" }, { type: "text", text: "My OpenCode request" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "shell", input: { command: "echo OpenCode" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "OpenCode output" }] },
    ],
    tools: [...BODY.tools, { type: "web_search_20250305", name: "web_search" }],
    tool_choice: { type: "tool", name: "shell" },
  };
  const rewritten = rewriteCliBody(JSON.stringify(input), { sessionId: "session", requestClass: "main", promptId: "prompt", turnOrigin: "human" });
  const body = JSON.parse(rewritten.json);
  expect(body.tools[0]).toEqual({ ...BODY.tools[0], name: "mcp__opencode__shell" });
  expect(body.tools[1]).toEqual(input.tools[1]);
  expect(body.tool_choice.name).toBe("mcp__opencode__shell");
  expect(body.messages[1].content[0]).toEqual({ ...input.messages[1]!.content[0], name: "mcp__opencode__shell" });
  expect(body.messages[0]).toEqual(input.messages[0]);
  expect(body.messages[2].content[0].content).toBe("OpenCode output");
  expect(body.system.at(-1).text).toContain(input.system[1]!.text);
  expect(body.system.at(-1).text).toContain("Preserve my OpenCode instructions.");
  expect(body.system.at(-1).text).not.toContain("running in OpenCode");
  expect(body.system.at(-1).text).toContain("You have been invoked in the following environment:\n<env>");
  expect(rewriteCliBody(JSON.stringify(input), { sessionId: "s", requestClass: "main" }, false).json).not.toContain("cch=");
});

test("SDK billing skips leading reminders and retains legacy model thinking options", () => {
  const input = {
    ...BODY,
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: [
      { type: "text", text: "<system-reminder>metadata</system-reminder>" },
      { type: "text", text: "actual user prompt" },
    ] }],
    thinking: { type: "adaptive", display: "summarized", budget_tokens: 2048 },
  };
  const body = JSON.parse(rewriteCliBody(JSON.stringify(input), { sessionId: "s", requestClass: "main" }, true, SDK_CLI_PROFILE).json);
  expect(body.system[0].text).toContain("cc_version=2.1.280.11c;");
  expect(body.thinking).toEqual(input.thinking);
});

test("relay controls actual header order/casing, drops late trace headers, and decompresses responses", async () => {
  let capture = "";
  const compressed = gzipSync("upstream response");
  const upstream = net.createServer((socket) => {
    let bytes = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      const end = bytes.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(bytes.subarray(0, end).toString().match(/Content-Length: (\d+)/)?.[1]);
      if (bytes.length < end + 4 + length) return;
      capture = bytes.toString();
      socket.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Encoding: gzip\r\nContent-Length: ${compressed.length}\r\nConnection: close\r\n\r\n`), compressed]));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const relay = createCliRelay();
  try {
    const body = rewriteCliBody(JSON.stringify(BODY), { sessionId: "s", requestClass: "main" });
    const headers = cliHeaders(new Headers({ authorization: "Bearer test" }), { sessionId: "s", requestClass: "main" }, body, "request", 0);
    const port = (upstream.address() as net.AddressInfo).port;
    const request = relay.forward(new URL(`http://127.0.0.1:${port}/v1/messages?beta=true`), headers, body.json, new AbortController().signal);
    request.headers.set("traceparent", "must-not-leak");
    request.headers.set("b3", "must-not-leak");
    const response = await fetch(request);
    expect(await response.text()).toBe("upstream response");
    const lines = capture.split("\r\n\r\n")[0]!.split("\r\n");
    expect(lines[0]).toBe("POST /v1/messages?beta=true HTTP/1.1");
    expect(lines.slice(1).map((line) => line.split(":")[0])).toEqual([
      ...Object.keys(headers), "Connection", "Host", "Accept-Encoding", "Content-Length",
    ]);
    expect(capture).not.toContain("must-not-leak");
    expect(capture.split("\r\n\r\n")[1]).toBe(body.json);
    expect((await fetch(request.url, { method: "POST" })).status).toBe(404);
  } finally {
    relay.close();
    upstream.close();
  }
});

async function fixture(options: Record<string, unknown> = { spoofingProfile: "cli" }) {
  const plugin = await setupPlugin(options);
  const captures: Array<{ body: any; headers: Headers }> = [];
  let reply: ((index: number) => Response) | undefined;
  const upstream = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      captures.push({ body: await request.json(), headers: request.headers });
      const index = captures.length;
      return reply?.(index) ?? new Response([
        { type: "message_start", message: { type: "message", id: `msg_${index}`, content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "mcp__opencode__shell", input: {} } },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream", "request-id": `req_${index}` },
      });
    },
  });
  const prepare = async (sessionID = "ses_root", kind = "primary", turn = "msg_user1", synthetic = false) => {
    const scope = { sessionID, agent: sessionID === "ses_child" ? "explore" : "build", model: { providerID: "anthropic", id: BODY.model }, kind };
    if (kind === "primary") await plugin.hooks.context!({ ...scope, messages: [{ id: turn, role: "user", content: [{ type: "text", text: "hello" }], ...(!synthetic ? { metadata: {} } : {}) }] });
    const modelEvent = { ...scope, headers: {} as Record<string, string> };
    await plugin.hooks["model.request"]!(modelEvent);
    return { scope, modelEvent };
  };
  const send = async (prepared?: Awaited<ReturnType<typeof prepare>>, consume = true) => {
    prepared ??= await prepare();
    const event = { ...prepared.scope, request: new Request(`${upstream.url}v1/messages?beta=true`, {
      method: "POST", headers: { ...prepared.modelEvent.headers, authorization: "Bearer test", "content-type": "application/json" }, body: JSON.stringify(BODY),
    }) };
    await plugin.hooks["http.request"]!(event);
    const after = { ...prepared.scope, request: event.request, response: await fetch(event.request) };
    await plugin.hooks["http.response"]!(after);
    const text = consume ? await after.response.text() : undefined;
    return { response: after.response, text, capture: captures.at(-1)! };
  };
  return { plugin, prepare, send, reply(value: typeof reply) { reply = value; }, close() { plugin.cleanup?.(); upstream.stop(true); } };
}

test.each(["cli", "sdk-cli"] as const)("%s selects its captured identity and tracks separate parent/child chains", async (profile) => {
  // An omitted option must use the updated SDK profile, not the retired path.
  const f = await fixture(profile === "sdk-cli" ? {} : { spoofingProfile: profile });
  try {
    f.plugin.state.sessions.ses_child = { parentID: "ses_root" };
    const first = await f.send();
    expect(first.capture.headers.get("user-agent")).toBe(`claude-cli/2.1.280 (external, ${profile})`);
    expect(first.capture.body.system[0].text).toContain(`cc_entrypoint=${profile};`);
    expect(first.capture.body.system[0].text).toContain(`cc_turn_origin=${profile === "sdk-cli" ? "sdk" : "human"};`);
    expect(first.capture.body.system[1].text).toBe(profile === "sdk-cli"
      ? "You are a Claude agent, built on Anthropic's Claude Agent SDK."
      : "You are Claude Code, Anthropic's official CLI for Claude.");
    expect(first.capture.body.thinking).toEqual({ type: "adaptive", display: profile === "sdk-cli" ? "omitted" : "updates" });
    const betas = first.capture.headers.get("anthropic-beta")!.split(",");
    expect(betas.includes("fallback-credit-2026-06-01")).toBe(profile === "cli");
    expect(betas.includes("thinking-display-updates-2026-08-18")).toBe(profile === "cli");
    expect(first.capture.body.max_tokens).toBe(128000);
    expect(first.capture.body.tools[0].name).toBe("mcp__opencode__shell");
    expect(first.text).toContain('"name":"shell"');
    expect(first.text).not.toContain(CLI_PROFILE.toolPrefix);
    const child = await f.send(await f.prepare("ses_child"));
    expect(child.capture.headers.get("x-claude-code-session-id")).toBe(first.capture.headers.get("x-claude-code-session-id"));
    expect(child.capture.headers.get("x-claude-code-agent-type")).toBe("explore");
    expect(child.capture.body.system[0].text.match(/cc_prompt_id=([^;]+)/)[1]).toBe(first.capture.body.system[0].text.match(/cc_prompt_id=([^;]+)/)[1]);
    expect(child.capture.body.diagnostics.previous_message_id).toBeNull();
    await f.send(await f.prepare("ses_root", "generate"));
    const root = await f.send();
    expect(root.capture.headers.get("x-claude-code-session-id")).toBe(first.capture.headers.get("x-claude-code-session-id"));
    expect(root.capture.body.diagnostics.previous_message_id).toBe("msg_1");
    expect(root.capture.body.system[0].text).toContain("cc_prev_req=req_1;");
    const childNext = await f.send(await f.prepare("ses_child"));
    expect(childNext.capture.body.diagnostics.previous_message_id).toBe("msg_2");
    const notification = await f.send(await f.prepare("ses_root", "primary", "msg_notify", true));
    expect(notification.capture.body.system[0].text).toContain(`cc_turn_origin=${profile === "sdk-cli" ? "sdk" : "task_notification"};`);
    expect(notification.capture.body.system[0].text.match(/cc_prompt_id=([^;]+)/)[1]).not.toBe(first.capture.body.system[0].text.match(/cc_prompt_id=([^;]+)/)[1]);
  } finally { f.close(); }
});

test("retries retain logical IDs and failed/truncated streams do not advance attribution", async () => {
  const f = await fixture();
  try {
    await f.send();
    const logical = await f.prepare();
    f.reply((i) => new Response(`data: {"type":"message_start","message":{"type":"message","id":"msg_${i}"}}\n\n`, { headers: { "content-type": "text/event-stream", "request-id": `req_${i}` } }));
    const truncated = await f.send(logical);
    f.reply(undefined);
    const retry = await f.send(logical);
    expect(retry.capture.headers.get("x-client-request-id")).toBe(truncated.capture.headers.get("x-client-request-id"));
    expect(retry.capture.headers.get("x-stainless-retry-count")).toBe("1");
    expect(retry.capture.body.diagnostics.previous_message_id).toBe("msg_1");
    expect(retry.capture.body).toEqual(truncated.capture.body);
    f.reply((i) => new Response(`data: {"type":"message_start","message":{"type":"message","id":"msg_${i}"}}\n\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\ndata: {"type":"message_stop"}\n\n`, { headers: { "content-type": "text/event-stream", "request-id": `req_${i}` } }));
    await f.send();
    f.reply(undefined);
    expect((await f.send()).capture.body.diagnostics.previous_message_id).toBe("msg_3");
  } finally { f.close(); }
});

test("late completions cannot overwrite a newer chain or revive deleted/credential-switched state", async () => {
  const f = await fixture({});
  try {
    const old = await f.send(await f.prepare(), false);
    await f.send();
    await old.response.text();
    expect((await f.send()).capture.body.diagnostics.previous_message_id).toBe("msg_2");
    const deleted = await f.send(await f.prepare(), false);
    await f.plugin.emit({ type: "session.deleted", data: { sessionID: "ses_root" } });
    await deleted.response.text();
    const revived = await f.send();
    expect(revived.capture.body.diagnostics.previous_message_id).toBeNull();
    expect(revived.capture.headers.get("x-claude-code-session-id")).not.toBe(deleted.capture.headers.get("x-claude-code-session-id"));
    const switched = await f.send(await f.prepare(), false);
    await f.plugin.emit({ type: "credential.switched", data: { integrationID: "anthropic", credentialID: "cred_2" } });
    await switched.response.text();
    expect((await f.send()).capture.body.diagnostics.previous_message_id).toBeNull();
  } finally { f.close(); }
});

test("malformed JSON cannot advance attribution and compaction starts a fresh chain", async () => {
  const f = await fixture();
  try {
    f.reply((i) => Response.json({ type: "message", id: `msg_${i}`, stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_1", name: "mcp__opencode__shell", input: {} }] }, { headers: { "request-id": `req_${i}` } }));
    const first = await f.send();
    expect(JSON.parse(first.text!).content[0].name).toBe("shell");
    f.reply(() => new Response('{"type":"message","id":"broken"', { headers: { "content-type": "application/json", "request-id": "req_broken" } }));
    await expect(f.send()).rejects.toThrow(SyntaxError);
    f.reply(undefined);
    expect((await f.send()).capture.body.diagnostics.previous_message_id).toBe("msg_1");
    const pending = await f.send(await f.prepare(), false);
    await f.plugin.emit({ type: "session.compacted", data: { sessionID: "ses_root" } });
    await pending.response.text();
    const compacted = await f.send();
    expect(compacted.capture.body.diagnostics.previous_message_id).toBeNull();
    expect(compacted.capture.headers.get("x-claude-code-session-id")).toBe(first.capture.headers.get("x-claude-code-session-id"));
  } finally { f.close(); }
});

test("cancelling a relayed response closes the upstream streaming connection", async () => {
  let closed!: () => void;
  const upstreamClosed = new Promise<void>((resolve) => { closed = resolve; });
  const sockets = new Set<net.Socket>();
  const upstream = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => { sockets.delete(socket); closed(); });
    socket.once("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nhello\n\r\n"));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const relay = createCliRelay();
  try {
    const port = (upstream.address() as net.AddressInfo).port;
    const controller = new AbortController();
    const request = relay.forward(new URL(`http://127.0.0.1:${port}/v1/messages`), { Authorization: "Bearer test" }, "{}", controller.signal);
    const response = await fetch(request);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await Promise.race([upstreamClosed, Bun.sleep(1000).then(() => { throw new Error("upstream stream stayed open"); })]);
  } finally {
    relay.close();
    for (const socket of sockets) socket.destroy();
    upstream.close();
  }
});
