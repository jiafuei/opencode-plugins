import { goFetch } from "./transport.ts";
import { ANTIGRAVITY_DAILY_ENDPOINT, antigravityHeaders, type WireCatalog } from "./wire.ts";

interface AvailableModels {
  models?: WireCatalog;
  agentModelSorts?: Array<{ groups?: Array<{ modelIds?: string[] }> }>;
  webSearchModelIds?: string[];
}

/**
 * Best-effort live agent catalog: the native picker's `agentModelSorts` ids,
 * in order, with their model entries. Undefined retains the snapshot catalog.
 */
export async function discoverModels(
  accessToken: string,
  projectId: string,
  fetcher: typeof fetch = goFetch,
): Promise<{ catalog: WireCatalog; webSearchModelId?: string } | undefined> {
  try {
    const response = await fetcher(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:fetchAvailableModels`, {
      method: "POST",
      headers: antigravityHeaders(accessToken),
      body: JSON.stringify({ project: projectId }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as AvailableModels;
    const ids = (payload.agentModelSorts ?? []).flatMap((sort) => (sort.groups ?? []).flatMap((group) => group.modelIds ?? []));
    const catalog = Object.fromEntries([...new Set(ids)].filter((id) => payload.models?.[id]).map((id) => [id, payload.models![id]!]));
    if (Object.keys(catalog).length > 0) return { catalog, webSearchModelId: payload.webSearchModelIds?.[0] };
  } catch {
    // Model discovery is optional; login and inference report auth failures.
  }
}
