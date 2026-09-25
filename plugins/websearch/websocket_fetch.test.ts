import { afterEach, describe, expect, test } from "bun:test";
import type { Server, ServerWebSocket } from "bun";
import { createWebSocketFetch } from "./websocket_fetch.ts";

const servers: Server<undefined>[] = [];
const transports: Array<ReturnType<typeof createWebSocketFetch>> = [];

afterEach(() => {
  for (const transport of transports.splice(0)) transport.close();
  for (const server of servers.splice(0)) server.stop(true);
});

function createServer(onMessage: (socket: ServerWebSocket<undefined>, message: string) => void, onUpgrade = (_request: Request) => {}) {
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      onUpgrade(request);
      server.upgrade(request);
    },
    websocket: { message: (socket, message) => onMessage(socket, String(message)) },
  });
  servers.push(server);
  const transport = createWebSocketFetch(`ws://127.0.0.1:${server.port}/responses`);
  transports.push(transport);
  return transport;
}

describe("OpenAI WebSocket fetch", () => {
  test("forwards subscription headers and exposes frames as SSE", async () => {
    let headers = new Headers();
    const transport = createServer(
      (socket, message) => {
        expect(JSON.parse(message)).toEqual({ type: "response.create", model: "gpt-5.6-luna" });
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "hello" }));
        socket.send(JSON.stringify({ type: "response.completed" }));
      },
      (request) => (headers = request.headers),
    );

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
    expect(headers.get("authorization")).toBe("Bearer token");
    expect(headers.get("chatgpt-account-id")).toBe("account");
    expect(headers.get("x-openai-internal-codex-residency")).toBe("eu");
    expect(headers.get("openai-beta")).toBe("responses_websockets=2026-02-06");
  });

  test("serializes concurrent requests on the WebSocket", async () => {
    let messages = 0;
    let connections = 0;
    const transport = createServer(
      (socket) => {
        messages++;
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: String(messages) }));
        socket.send(JSON.stringify({ type: "response.completed" }));
      },
      () => connections++,
    );

    const request = () => transport("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ model: "gpt-5.6-luna", stream: true }),
    });
    const [first, second] = await Promise.all([request(), request()]);

    expect(await first.text()).toContain('"delta":"1"');
    expect(await second.text()).toContain('"delta":"2"');
    expect(connections).toBe(1);
  });
});
