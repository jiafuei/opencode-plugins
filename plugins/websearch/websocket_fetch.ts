import WebSocket from "ws";

type WebSocketFetch = typeof globalThis.fetch & { close(): void };

const DEFAULT_URL = "wss://chatgpt.com/backend-api/codex/responses";

function normalizeHeaders(headers: HeadersInit | undefined) {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function isTerminalEvent(event: unknown): event is { type: string } {
  return !!event && typeof event === "object" && "type" in event && typeof event.type === "string" &&
    ["response.completed", "response.done", "response.failed", "response.incomplete", "error"].includes(event.type);
}

export function createWebSocketFetch(url = DEFAULT_URL): WebSocketFetch {
  let socket: WebSocket | undefined;
  let opening: WebSocket | undefined;
  let credentialKey: string | undefined;
  let queue = Promise.resolve();

  const closeSocket = () => {
    opening?.terminate();
    opening = undefined;
    socket?.terminate();
    socket = undefined;
    credentialKey = undefined;
  };

  const connect = (headers: Record<string, string>, nextCredentialKey: string) => {
    if (socket?.readyState === WebSocket.OPEN && credentialKey === nextCredentialKey) return Promise.resolve(socket);

    closeSocket();
    return new Promise<WebSocket>((resolve, reject) => {
      let settled = false;
      const next = new WebSocket(url, {
        headers: {
          Authorization: headers.authorization ?? "",
          ...(headers["chatgpt-account-id"] ? { "ChatGPT-Account-Id": headers["chatgpt-account-id"] } : {}),
          ...(headers["x-openai-internal-codex-residency"]
            ? { "x-openai-internal-codex-residency": headers["x-openai-internal-codex-residency"] }
            : {}),
          "OpenAI-Beta": "responses_websockets=2026-02-06",
        },
      });
      opening = next;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        opening = undefined;
        next.terminate();
        reject(error);
      };
      next.once("error", fail);
      next.once("unexpected-response", (_request, response) => fail(new Error(`WebSocket handshake failed (${response.statusCode})`)));
      next.once("open", () => {
        if (settled) return;
        settled = true;
        next.off("error", fail);
        opening = undefined;
        socket = next;
        credentialKey = nextCredentialKey;
        resolve(next);
      });
    });
  };

  const websocketFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const requestUrl = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    if (init?.method !== "POST" || !requestUrl.endsWith("/responses") || typeof init.body !== "string") {
      return globalThis.fetch(input, init);
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return globalThis.fetch(input, init);
    }
    if (body.stream !== true) return globalThis.fetch(input, init);

    const previous = queue;
    let releaseQueue!: () => void;
    queue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;
    if (init.signal?.aborted) {
      releaseQueue();
      throw init.signal.reason;
    }

    const headers = normalizeHeaders(init.headers);
    const nextCredentialKey = `${headers.authorization ?? ""}\n${headers["chatgpt-account-id"] ?? ""}\n${headers["x-openai-internal-codex-residency"] ?? ""}`;

    let connection: WebSocket;
    try {
      connection = await connect(headers, nextCredentialKey);
    } catch (error) {
      releaseQueue();
      throw error;
    }

    const { stream: _stream, background: _background, ...requestBody } = body;
    const encoder = new TextEncoder();
    let cancelStream = () => closeSocket();

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          let finished = false;

          const cleanup = () => {
            connection.off("message", onMessage);
            connection.off("error", onError);
            connection.off("close", onClose);
            init.signal?.removeEventListener("abort", onAbort);
            releaseQueue();
          };
          const fail = (error: unknown) => {
            if (finished) return;
            finished = true;
            cleanup();
            closeSocket();
            controller.error(error);
          };
          const onError = (error: Error) => fail(error);
          const onClose = () => fail(new Error("WebSocket closed before the response completed"));
          const onAbort = () => fail(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          cancelStream = () => {
            if (finished) return;
            finished = true;
            cleanup();
            closeSocket();
          };
          const onMessage = (data: WebSocket.RawData) => {
            const text = data.toString();
            controller.enqueue(encoder.encode(`${text.split(/\r?\n/).map((line) => `data: ${line}`).join("\n")}\n\n`));

            let event: unknown;
            try {
              event = JSON.parse(text) as unknown;
            } catch {
              return;
            }
            if (!isTerminalEvent(event)) return;

            finished = true;
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            cleanup();
            if (event.type !== "response.completed" && event.type !== "response.done") closeSocket();
            controller.close();
          };

          connection.on("message", onMessage);
          connection.once("error", onError);
          connection.once("close", onClose);
          init.signal?.addEventListener("abort", onAbort, { once: true });

          if (init.signal?.aborted) {
            onAbort();
            return;
          }
          connection.send(JSON.stringify({ type: "response.create", ...requestBody }), (error) => {
            if (error) fail(error);
          });
        },
        cancel() {
          cancelStream();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };

  return Object.assign(websocketFetch, { close: closeSocket }) as WebSocketFetch;
}
