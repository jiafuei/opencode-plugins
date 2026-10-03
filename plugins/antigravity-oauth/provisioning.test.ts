import { describe, expect, setSystemTime, test } from "bun:test";
import { discoverProject } from "./oauth_flow.ts";

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

const instant = async () => {};
const IDE_METADATA = { ide_type: "ANTIGRAVITY", ide_version: "2.5.5", ide_name: "antigravity" };

describe("project discovery", () => {
  test("HTTP account challenges surface only the verification URL and recovery action", async () => {
    const { fetcher } = scriptedFetcher([
      () => jsonResponse({ error: {
        message: "sensitive upstream diagnostic",
        details: [{ reason: "VALIDATION_REQUIRED", metadata: { validation_url: "https://accounts.google.com/verify" } }],
      } }, 403),
    ]);
    await expect(discoverProject("t", fetcher)).rejects.toThrow(
      "Account verification required. Visit https://accounts.google.com/verify to continue, then sign in again.",
    );
  });

  test("existing accounts resolve the project with a single native load", async () => {
    const { fetcher, calls } = scriptedFetcher([
      () => jsonResponse({ currentTier: { id: "free-tier" }, cloudaicompanionProject: "proj-1" }),
    ]);
    const project = await discoverProject("tok", fetcher, instant);
    expect(project).toBe("proj-1");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ metadata: IDE_METADATA });
    expect(calls[0]!.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    // Login-time provisioning runs on the IDE's Node side.
    expect(calls[0]!.init.headers).toMatchObject({
      "User-Agent": "antigravity/2.5.5 windows/amd64 google-api-nodejs-client/10.3.0",
      "x-goog-api-client": "gl-node/22.21.1",
    });
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
      () => jsonResponse({ currentTier: { id: "free-tier" }, cloudaicompanionProject: "proj-new" }),
    ]);
    const sleeps: number[] = [];
    const project = await discoverProject("tok", fetcher, async (ms) => void sleeps.push(ms));
    expect(project).toBe("proj-new");
    expect(polls).toBe(1);
    expect(sleeps).toEqual([1000]); // one-second polling cadence

    const onboardCall = calls[1]!;
    expect(onboardCall.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser");
    expect(JSON.parse(String(onboardCall.init.body))).toEqual({ tier_id: "free-tier", metadata: IDE_METADATA });
    // LRO polls carry the shared native context, Content-Type included.
    const pollCall = calls[2]!;
    expect(pollCall.url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal/operations/abc");
    const pollHeaders = pollCall.init.headers as Record<string, string>;
    expect(pollHeaders["Content-Type"]).toBe("application/json");
    expect(pollHeaders["User-Agent"]).toStartWith("antigravity/2.5.5 ");
  });

  test("failed operations surface their error", async () => {
    const { fetcher } = scriptedFetcher([
      () => jsonResponse({ allowedTiers: [{ id: "free-tier" }] }),
      () => jsonResponse({ name: "operations/x", done: true, error: { code: 7, message: "permission denied" } }),
    ]);
    await expect(discoverProject("t", fetcher, instant)).rejects.toThrow(
      /OnboardUser operation failed.*7.*permission denied/s,
    );
  });

  test("onboarding gives up 30 seconds after it starts", async () => {
    // The operation never finishes; each poll's sleep moves the clock forward.
    const fetcher = (async (url: string) =>
      jsonResponse(url.endsWith(":loadCodeAssist") ? { allowedTiers: [{ id: "free-tier" }] } : { name: "operations/x", done: false })) as unknown as typeof fetch;
    let now = Date.now();
    try {
      await expect(discoverProject("t", fetcher, async (ms) => void setSystemTime((now += ms)))).rejects.toThrow(
        "onboardUser timed out after 30000ms",
      );
    } finally {
      setSystemTime();
    }
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
    ]);
    try {
      await discoverProject("t", fetcher, instant);
      throw new Error("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("not eligible");
      expect(message).toContain("https://example.com/validate");
    }
  });
});
