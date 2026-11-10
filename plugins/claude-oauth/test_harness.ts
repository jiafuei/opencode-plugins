import plugin from "./server.ts";

// Minimal stand-in for the v2 plugin host: records the OAuth method, the model
// transform, the RPC methods, and the session and tool hooks for tests to drive.

export const OAUTH_CREDENTIAL = {
  type: "oauth" as const,
  methodID: "claude-pro-max",
  access: "test-access-token",
  refresh: "test-refresh-token",
  expires: Date.now() + 60 * 60 * 1000,
  metadata: { accountId: "acct-test-123" },
};

export async function setupPlugin(options: Record<string, unknown> = {}, credential: unknown = OAUTH_CREDENTIAL) {
  const state = { credential, reloads: 0, sessions: {} as Record<string, { parentID?: string; metadata?: Record<string, unknown> }>, synthetic: new Set<string>() };
  const hooks: Record<string, (event: any) => unknown> = {};
  const queue: Array<{ event: any; done: () => void }> = [];
  let wake: (() => void) | undefined;
  let method: any;
  let modelTransform: any;
  let rpcMethods: any;
  const cleanup = await plugin.setup({
    options,
    integration: {
      transform: async (callback: any) => callback({ method: { update: (input: any) => (method = input) } }),
      connection: {
        active: async () => (state.credential ? { type: "credential", id: "cred_1", label: "", method: "oauth" } : undefined),
        resolve: async () => state.credential,
      },
    },
    rpc: { register: async (_definition: unknown, methods: unknown) => { rpcMethods = methods; } },
    model: {
      transform: async (callback: any) => (modelTransform = callback),
      reload: async () => {
        state.reloads++;
      },
    },
    tool: {
      hook: async (name: string, callback: any) => (hooks[`tool.${name}`] = callback),
    },
    session: {
      hook: async (name: string, callback: any) => (hooks[name] = callback),
      get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, ...state.sessions[sessionID] }),
      update: async ({ sessionID, metadata }: { sessionID: string; metadata: Record<string, unknown> }) => {
        state.sessions[sessionID] = { ...state.sessions[sessionID], metadata };
      },
      context: async () => [...state.synthetic].map((id) => ({ id, type: "synthetic" })),
    },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          for (;;) {
            while (queue.length > 0) {
              const { event, done } = queue.shift()!;
              yield event;
              done();
            }
            await new Promise<void>((resolve) => (wake = resolve));
          }
        },
      }),
    },
  } as never);

  const emit = (event: unknown) => new Promise<void>((done) => {
    queue.push({ event, done });
    wake?.();
  });

  return { state, hooks, method, modelTransform, rpcMethods, emit, cleanup };
}
