import { describe, expect, test } from "bun:test";
import { CALLBACK_PATH } from "./oauth_flow.ts";
import { createCallbackWaiter } from "./antigravity_oauth.ts";

describe("browser callback waiter", () => {
  test("a callback racing ahead of the hook is not lost", async () => {
    const waiter = createCallbackWaiter("state-1", 5_000);
    // The redirect arrives before anyone awaits the promise.
    const html = waiter.deliver(`http://127.0.0.1:51121${CALLBACK_PATH}?code=abc&state=state-1`);
    expect(html).toContain("Sign-in complete");
    await expect(waiter.promise).resolves.toBe("abc");
    waiter.dispose();
  });

  test("state mismatches reject before any exchange", async () => {
    const waiter = createCallbackWaiter("state-1", 5_000);
    waiter.deliver(`http://127.0.0.1:51121${CALLBACK_PATH}?code=abc&state=WRONG`);
    await expect(waiter.promise).rejects.toThrow(/state mismatch/);
  });

  test("unknown paths do not settle the waiter", async () => {
    const waiter = createCallbackWaiter("state-1", 5_000);
    expect(waiter.deliver("http://127.0.0.1:51121/something-else")).toBe("Not found");
    // Still pending: resolve manually to prove it was not rejected.
    waiter.deliver(`http://127.0.0.1:51121${CALLBACK_PATH}?code=late&state=state-1`);
    await expect(waiter.promise).resolves.toBe("late");
  });

  test("unknown paths do not cancel the authorization timeout", async () => {
    const waiter = createCallbackWaiter("state-1", 20);
    expect(waiter.deliver("http://127.0.0.1:51121/favicon.ico")).toBe("Not found");
    await expect(waiter.promise).rejects.toThrow(/authorization window expired/);
  });

  test("the timeout rejects even when no browser ever arrives", async () => {
    const waiter = createCallbackWaiter("state-1", 20);
    await expect(waiter.promise).rejects.toThrow(/authorization window expired/);
    waiter.dispose();
  });
});
