import type { Plugin } from "@opencode/plugin";

type Content = { url: string; text: string; expiresAt: number };
type ContentsResponse = {
  results: { url: string; text?: string }[];
  statuses?: { error?: { tag: string } }[];
};

export async function exaContents(storage: Plugin.Context["storage"], url: URL, key: string, fresh: boolean, signal: AbortSignal): Promise<string> {
  const cacheKey = `content/exa/${url.href}`;
  let content = fresh ? undefined : await storage.get(cacheKey) as Content | undefined;
  if (!content || content.expiresAt <= Date.now()) {
    const response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ urls: [url.href], text: true, maxAgeHours: 0 }),
      signal,
    });
    if (!response.ok) throw new Error(`Exa HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json() as ContentsResponse;
    const result = data.results[0];
    if (result?.text === undefined) throw new Error(`Exa could not retrieve the page: ${data.statuses?.[0]?.error?.tag ?? "No text returned"}`);
    content = { url: result.url, text: result.text, expiresAt: Date.now() + 15 * 60 * 1000 };
    await storage.set(cacheKey, content);
  }
  return `Source: ${content.url}\nBackend: Exa\n\n${content.text}`;
}
