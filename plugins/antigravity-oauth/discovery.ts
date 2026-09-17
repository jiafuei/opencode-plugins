import { ensureAntigravityVersion, getAntigravityUserAgent, type DiscoveredModel } from "./wire.ts";

/** Best-effort startup discovery; undefined retains the static model defaults. */
export async function discoverModels(
  accessToken: string,
  endpoints: string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, DiscoveredModel> | undefined> {
  await ensureAntigravityVersion(fetcher);
  for (const endpoint of endpoints) {
    try {
      const response = await fetcher(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": getAntigravityUserAgent(),
        },
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const payload = await response.json() as { models?: Record<string, DiscoveredModel> };
      if (payload.models && typeof payload.models === "object" && !Array.isArray(payload.models)) return payload.models;
    } catch {
      // Model discovery is optional; login and inference report auth failures.
    }
  }
}
