import { afterEach, describe, expect, test } from "bun:test";
import { WebSocketServer } from "ws";
import { createWebSocketFetch } from "./websocket_fetch.ts";

const servers: WebSocketServer[] = [];
const transports: Array<ReturnType<typeof createWebSocketFetch>> = [];

afterEach(() => {
  for (const transport of transports.splice(0)) transport.close();
  for (const server of servers.splice(0)) server.close();
});

async function createServer() {
  const server = new WebSocketServer({ port: 0 });
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string") throw new Error("Expected an internet socket");
  return { server, url: `ws://127.0.0.1:${address.port}/responses` };
}

describe("OpenAI WebSocket fetch", () => {
  test("forwards subscription headers and exposes frames as SSE", async () => {
    const { server, url } = await createServer();
    let headers: Record<string, string | string[] | undefined> = {};
    server.on("connection", (socket, request) => {
      headers = request.headers;
      socket.once("message", (data) => {
        expect(JSON.parse(data.toString())).toEqual({ type: "response.create", model: "gpt-5.6-luna" });
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "hello" }));
        socket.send(JSON.stringify({ type: "response.completed" }));
      });
    });

    const transport = createWebSocketFetch(url);
    transports.push(transport);
    const response = await transport("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "ChatGPT-Account-Id": "account",
        "x-openai-internal-codex-residency": "eu",
      },
      body: JSON.stringify({ model: "gpt-5.6-luna", stream: true }),
    });

    expect(await response.text()).toContain('data: {"type":"response.output_text.delta","delta":"hello"}');
    expect(headers.authorization).toBe("Bearer token");
    expect(headers["chatgpt-account-id"]).toBe("account");
    expect(headers["x-openai-internal-codex-residency"]).toBe("eu");
    expect(headers["openai-beta"]).toBe("responses_websockets=2026-02-06");
  });

  test("serializes concurrent requests on the WebSocket", async () => {
    const { server, url } = await createServer();
    let messages = 0;
    let connections = 0;
    server.on("connection", (socket) => {
      connections++;
      socket.on("message", () => {
        messages++;
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: String(messages) }));
        socket.send(JSON.stringify({ type: "response.completed" }));
      });
    });

    const transport = createWebSocketFetch(url);
    transports.push(transport);
    const request = () => transport("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ model: "gpt-5.6-luna", stream: true }),
    });
    const [first, second] = await Promise.all([request(), request()]);

    expect(await first.text()).toContain('"delta":"1"');
    expect(await second.text()).toContain('"delta":"2"');
    expect(messages).toBe(2);
    expect(connections).toBe(1);
  });
});
