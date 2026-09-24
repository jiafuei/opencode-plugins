import plugin from "./claude_oauth.ts";

// Minimal stand-in for the v2 plugin host: records the OAuth method, the model
// transform, and the session hooks, and drives an Anthropic /v1/messages
// request through them the way core's session model request does.

export const OAUTH_CREDENTIAL = {
  type: "oauth" as const,
  methodID: "claude-pro-max",
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 60 * 60 * 1000,
  metadata: { accountId: "acct-test-123" },
};

export async function setupPlugin(options: Record<string, unknown> = {}, credential: unknown = OAUTH_CREDENTIAL) {
  const state = { credential, reloads: 0 };
  const hooks: Record<string, (event: any) => unknown> = {};
  const queue: any[] = [];
  let wake: (() => void) | undefined;
  let method: any;
  let modelTransform: any;
  const cleanup = await plugin.setup({
    options,
    integration: {
      transform: async (callback: any) => callback({ method: { update: (input: any) => (method = input) } }),
      connection: {
        active: async () => (state.credential ? { type: "credential", id: "cred_1", label: "", method: "oauth" } : undefined),
        resolve: async () => state.credential,
      },
    },
    model: {
      transform: async (callback: any) => (modelTransform = callback),
      reload: async () => {
        state.reloads++;
      },
    },
    session: { hook: async (name: string, callback: any) => (hooks[name] = callback) },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          for (;;) {
            while (queue.length > 0) yield queue.shift();
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      }),
    },
  } as never);

  const emit = async (event: unknown) => {
    queue.push(event);
    wake?.();
    await Bun.sleep(5);
  };

  /** Run one request through model.request -> http.request -> respond -> http.response. */
  const send = async (
    body: Record<string, unknown>,
    respond: (request: Request) => Response = () => new Response("{}", { headers: { "content-type": "application/json" } }),
    sessionID = "ses_test",
  ) => {
    const scope = { sessionID, agent: "build", model: { providerID: "anthropic", modelID: String(body.model) }, kind: "primary" };
    const modelEvent = {
      ...scope,
      baseURL: "https://api.anthropic.com/v1",
      headers: {
        "x-session-affinity": sessionID,
        "X-Session-Id": sessionID,
        "User-Agent": "opencode/test",
        "x-opencode-session": sessionID,
      } as Record<string, string>,
    };
    await hooks["model.request"]!(modelEvent);
    const credential = state.credential as { type: string; access?: string; key?: string } | undefined;
    const requestEvent = {
      ...scope,
      request: new Request("https://api.anthropic.com/v1/messages?beta=true", {
        method: "POST",
        headers: {
          ...modelEvent.headers,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "interleaved-thinking-2025-05-14",
          ...(credential?.type === "oauth"
            ? { authorization: `Bearer ${credential.access}` }
            : { "x-api-key": credential?.key ?? "" }),
        },
        body: JSON.stringify(body),
      }),
    };
    await hooks["http.request"]!(requestEvent);
    const request = requestEvent.request;
    const responseEvent = { ...scope, request, response: respond(request.clone()) };
    await hooks["http.response"]!(responseEvent);
    return { request, bodyText: await request.clone().text(), response: responseEvent.response as Response };
  };

  return { state, hooks, method, modelTransform, emit, send, cleanup };
}
