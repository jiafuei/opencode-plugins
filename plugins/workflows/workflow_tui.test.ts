import { expect, mock, test } from "bun:test";
import plugin from "./tui.tsx";

test.each([false, true])("startup waits for server activation (already active: %s)", async (initiallyActive) => {
  const location = { directory: "/workflow-project" };
  let active = initiallyActive;
  let changed: ((event: { location: typeof location }) => void) | undefined;
  const list = mock(async () => {
    if (!active) throw new Error("RPC is unavailable: workflows");
    return { runs: [] };
  });
  const toast = mock(() => {});
  const unsubscribe = mock(() => {});
  const cleanup = await plugin.setup({
    location,
    client: {
      rpc: () => ({ list, events: { on: () => () => {} } }),
      plugin: {
        list: async () => ({
          data: active ? [{ id: "workflows", state: { status: "active" } }] : [],
        }),
      },
    },
    data: {
      on: (_type: string, callback: typeof changed) => {
        changed = callback;
        return unsubscribe;
      },
    },
    ui: {
      toast: { show: toast },
      router: { register: () => () => {} },
      slot: () => () => {},
    },
  } as never);
  try {
    await Bun.sleep(0);
    expect(list).toHaveBeenCalledTimes(initiallyActive ? 1 : 0);
    expect(toast).not.toHaveBeenCalled();

    active = true;
    changed?.({ location: { directory: "/another-project" } });
    await Bun.sleep(0);
    expect(list).toHaveBeenCalledTimes(initiallyActive ? 1 : 0);

    changed?.({ location });
    changed?.({ location });
    await Bun.sleep(0);
    expect(list).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  } finally {
    await cleanup?.();
  }
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
