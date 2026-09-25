type WebSocketFetch = typeof globalThis.fetch & { close(): void };

const DEFAULT_URL = "wss://chatgpt.com/backend-api/codex/responses";
const TERMINAL_EVENTS = new Set(["response.completed", "response.done", "response.failed", "response.incomplete", "error"]);

// Replays OpenAI Responses streaming requests over one persistent WebSocket.
// Only handles the streaming POST /responses requests made by our OpenAI provider.
export function createWebSocketFetch(url = DEFAULT_URL): WebSocketFetch {
  let socket: WebSocket | undefined;
  let socketAuth: string | undefined;
  let queue = Promise.resolve();

  const close = () => {
    socket?.close();
    socket = undefined;
  };

  const connect = async (headers: Headers) => {
    const auth = `${headers.get("authorization")}\n${headers.get("chatgpt-account-id")}`;
    if (socket?.readyState === WebSocket.OPEN && socketAuth === auth) return socket;
    close();
    headers.set("openai-beta", "responses_websockets=2026-02-06");
    const next = new WebSocket(url, { headers: Object.fromEntries(headers) });
    await new Promise((resolve, reject) => {
      next.addEventListener("open", resolve, { once: true });
      next.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
    });
    socket = next;
    socketAuth = auth;
    return next;
  };

  const websocketFetch = async (_input: string | URL | Request, init: RequestInit) => {
    // One socket carries one response at a time.
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => (release = resolve));
    await previous;

    let connection: WebSocket;
    try {
      init.signal?.throwIfAborted();
      connection = await connect(new Headers(init.headers));
    } catch (error) {
      release();
      throw error;
    }

    const { stream: _stream, background: _background, ...body } = JSON.parse(init.body as string);
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;

    const stop = () => {
      connection.removeEventListener("message", onMessage);
      connection.removeEventListener("close", onClose);
      init.signal?.removeEventListener("abort", onAbort);
      release();
    };
    const fail = (error: unknown) => {
      stop();
      close();
      controller.error(error);
    };
    const onMessage = (event: MessageEvent) => {
      controller.enqueue(encoder.encode(`data: ${event.data}\n\n`));
      const { type } = JSON.parse(event.data);
      if (!TERMINAL_EVENTS.has(type)) return;
      stop();
      if (type !== "response.completed" && type !== "response.done") close();
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    };
    const onClose = () => fail(new Error("WebSocket closed before the response completed"));
    const onAbort = () => fail(init.signal!.reason);

    const stream = new ReadableStream<Uint8Array>({
      start: (c) => void (controller = c),
      cancel: () => {
        stop();
        close();
      },
    });
    connection.addEventListener("message", onMessage);
    connection.addEventListener("close", onClose);
    init.signal?.addEventListener("abort", onAbort);
    connection.send(JSON.stringify({ type: "response.create", ...body }));
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  };

  return Object.assign(websocketFetch, { close }) as WebSocketFetch;
}
