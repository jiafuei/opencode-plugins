import { describe, expect, test } from "bun:test";
import { CALLBACK_PATH } from "./oauth_flow.ts";
import { createCallbackWaiter } from "./server.ts";

describe("browser callback waiter", () => {
  test("state mismatches reject before any exchange", async () => {
    const waiter = createCallbackWaiter("state-1", 5_000);
    waiter.deliver(`http://127.0.0.1:51121${CALLBACK_PATH}?code=abc&state=WRONG`);
    await expect(waiter.promise).rejects.toThrow(/state mismatch/);
  });

  test("unknown paths do not cancel the authorization timeout", async () => {
    const waiter = createCallbackWaiter("state-1", 20);
    expect(waiter.deliver("http://127.0.0.1:51121/favicon.ico")).toBe("Not found");
    await expect(waiter.promise).rejects.toThrow(/authorization window expired/);
  });
});
