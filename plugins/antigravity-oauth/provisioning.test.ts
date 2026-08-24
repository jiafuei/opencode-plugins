import { describe, expect, test } from "bun:test";
import {
  ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
  discoverProject,
} from "./oauth_flow.ts";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function scriptedFetcher(
  handlers: Array<(url: string, init: RequestInit) => Response | Promise<Response>>,
): { fetcher: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetcher = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), init });
    const handler = handlers[index++];
    if (!handler) throw new Error(`unexpected fetch #${index} to ${url}`);
    return await handler(String(url), init);
  }) as typeof fetch;
  return { fetcher, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const immediateTiming = { pollIntervalMs: 1, timeoutMs: 30_000, sleep: async () => {} };

describe("project discovery", () => {
  test("existing accounts resolve the project with native metadata", async () => {
    const { fetcher, calls } = scriptedFetcher([
      // Initial load: current tier already present (with paidTier, so no
      // follow-up project-scoped load is needed).
      () => jsonResponse({ currentTier: { id: "free-tier" }, paidTier: { id: "free-tier" }, cloudaicompanionProject: "proj-1" }),
      // Final refresh load after resolving account state.
      () => jsonResponse({ currentTier: { id: "free-tier" }, paidTier: { id: "free-tier" }, cloudaicompanionProject: "proj-1" }),
    ]);
    const progress: string[] = [];
    const project = await discoverProject("tok", fetcher, (message) => progress.push(message), immediateTiming);
    expect(project).toBe("proj-1");
    expect(calls).toHaveLength(2);

    const firstBody = JSON.parse(String(calls[0]!.init.body));
    expect(firstBody).toEqual({ metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA });
    expect(ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA.ideType).toBe("ANTIGRAVITY");
    expect(calls[0]!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    // Native fingerprint on control-plane requests too.
    expect((calls[0]!.init.headers as Record<string, string>)["User-Agent"]).toContain("antigravity/hub/");
  });

  test("missing paidTier triggers a follow-up load carrying the companion project", async () => {
    const { fetcher, calls } = scriptedFetcher([
      () => jsonResponse({ cloudaicompanionProject: "proj-x" }), // no tiers yet
      () => jsonResponse({ currentTier: { id: "free-tier" }, paidTier: { id: "free-tier" } }), // repeat with project
      () =>
        jsonResponse({
          currentTier: { id: "free-tier" },
          paidTier: { id: "free-tier" },
          cloudaicompanionProject: "proj-y",
        }),
    ]);
    const project = await discoverProject("tok", fetcher, undefined, immediateTiming);
    expect(project).toBe("proj-y");
    expect(JSON.parse(String(calls[1]!.init.body)).cloudaicompanionProject).toBe("proj-x");
  });

  test("fresh accounts onboard the free tier and poll the LRO", async () => {
    let polls = 0;
    const { fetcher, calls } = scriptedFetcher([
      () => jsonResponse({ allowedTiers: [{ id: "free-tier" }] }), // no tier yet
      // onboardUser returns a pending operation...
      () => jsonResponse({ name: "operations/abc", done: false }),
      // ...polled once...
      () => {
        polls++;
        return jsonResponse({ name: "operations/abc", done: true, response: { cloudaicompanionProject: "p" } });
      },
      // final load
      () => jsonResponse({ currentTier: { id: "free-tier" }, paidTier: { id: "free-tier" }, cloudaicompanionProject: "proj-new" }),
    ]);
    const sleeps: number[] = [];
    const timing = { pollIntervalMs: 1000, timeoutMs: 30_000, sleep: async (ms: number) => void sleeps.push(ms) };
    const project = await discoverProject("tok", fetcher, undefined, timing);
    expect(project).toBe("proj-new");
    expect(polls).toBe(1);
    expect(sleeps).toEqual([1000]); // one-second polling cadence

    const onboardCall = calls[1]!;
    expect(onboardCall.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser");
    expect(JSON.parse(String(onboardCall.init.body))).toEqual({
      tierId: "free-tier",
      metadata: ANTIGRAVITY_LOAD_CODE_ASSIST_METADATA,
    });
    // LRO polls carry the shared native context, Content-Type included.
    const pollCall = calls[2]!;
    expect(pollCall.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal/operations/abc");
    const pollHeaders = pollCall.init.headers as Record<string, string>;
    expect(pollHeaders["Content-Type"]).toBe("application/json");
    expect(pollHeaders["User-Agent"]).toContain("antigravity/hub/");
    expect(pollHeaders.Authorization).toBe("Bearer tok");
    // The initial POST and the poll run under one deadline (per-call signals).
    expect(onboardCall.init.signal).toBeInstanceOf(AbortSignal);
    expect(pollCall.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("failed operations surface their error", async () => {
    const { fetcher } = scriptedFetcher([
      () => jsonResponse({ allowedTiers: [{ id: "free-tier" }] }),
      () => jsonResponse({ name: "operations/x", done: true, error: { code: 7, message: "permission denied" } }),
    ]);
    await expect(discoverProject("t", fetcher, undefined, immediateTiming)).rejects.toThrow(
      /OnboardUser operation failed.*7.*permission denied/s,
    );
  });

  test("operation without a name fails clearly", async () => {
    const { fetcher } = scriptedFetcher([
      () => jsonResponse({ allowedTiers: [{ id: "free-tier" }] }),
      () => jsonResponse({ done: false }),
    ]);
    await expect(discoverProject("t", fetcher, undefined, immediateTiming)).rejects.toThrow(/without a name/);
  });

  test("onboarding respects the single 30s deadline", async () => {
    const { fetcher } = scriptedFetcher([
      () => jsonResponse({ allowedTiers: [{ id: "free-tier" }] }),
      () => jsonResponse({ name: "operations/x", done: false }),
    ]);
    const timing = { pollIntervalMs: 1000, timeoutMs: -1, sleep: async () => {} };
    await expect(discoverProject("t", fetcher, undefined, timing)).rejects.toThrow(/timed out after -1ms/);
  });

  test("free-tier ineligibility surfaces reason and validation URL", async () => {
    const { fetcher } = scriptedFetcher([
      () =>
        jsonResponse({
          ineligibleTiers: [
            {
              tierId: "free-tier",
              reasonMessage: "Your account is not eligible for Antigravity.",
              validationUrl: "https://example.com/validate",
            },
          ],
        }),
      () => jsonResponse({}),
    ]);
    try {
      await discoverProject("t", fetcher, undefined, immediateTiming);
      throw new Error("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("not eligible");
      expect(message).toContain("https://example.com/validate");
    }
  });

  test("missing companion project after refresh fails clearly", async () => {
    const { fetcher } = scriptedFetcher([
      () => jsonResponse({ currentTier: { id: "free-tier" } }),
      () => jsonResponse({ currentTier: { id: "free-tier" } }),
    ]);
    await expect(discoverProject("t", fetcher, undefined, immediateTiming)).rejects.toThrow(
      /did not return a cloudaicompanionProject/,
    );
  });
});
