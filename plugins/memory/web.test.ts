import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createMemoryStore, topicRevision, type IndexEntry } from "./store.ts";
import { serveDashboard } from "./web.ts";

type Topic = { file: string; project: string; content: string; revision: string };

test("dashboard edits across projects preserve history and retire summaries, and unfolding keeps sources", async () => {
  const root = await mkdtemp("/tmp/opencode/memory-web-");
  const store = createMemoryStore(join(root, "current"), async () => true);
  await mkdir(join(root, "other"));
  await Bun.write(join(root, "other", "index.md"), "");
  await Bun.write(join(root, "old-worktree", "index.md"), "");
  await Bun.write(join(root, "old-worktree", ".scope-import.json"), JSON.stringify({ target: "current" }));
  const dashboard = serveDashboard({ root, projectKey: "current", directory: "/work/current", store, projectDirectory: async () => undefined });
  const launch = new URL(dashboard.url);
  const request = async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const response = await fetch(new URL(`/api/${path}`, launch), {
      method,
      headers: { "x-memory-token": launch.hash.slice(1), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  };
  try {
    const scopes = await request<{ id: string }[]>("projects");
    expect(scopes.map((project) => project.id).sort()).toEqual(["current", "global", "other"]);
    expect(scopes.find((project) => project.id === "current")).toMatchObject({ scope: "project", current: true });
    const global = await request<{ file: string }>("topic", "POST", { project: "global", title: "Writing style", type: "preference", summary: "General style", content: "Keep explanations concise across projects." });
    const original = await request<{ file: string }>("topic", "POST", {
      project: "current", title: "Deployment", type: "fact", summary: "Deployment target", content: "Deploy to staging.",
      origin: "reflection", evidence: [{ sessionID: "forged", messageID: "forged", createdAt: 0 }],
    });
    await request("topic", "POST", { project: "other", title: "Database", type: "preference", summary: "Storage choice", content: "Use SQLite." });

    // A real derived record, as produced by dreaming; the HTTP correction must invalidate it.
    const catalog = await store.readCatalog();
    const source = catalog[0]!;
    expect(source.origin).toBe("dashboard");
    expect(source.evidence).toBeUndefined();
    const summary: IndexEntry = {
      file: "deployment-summary.md", title: "Deployment summary", summary: "Target", type: "insight", updated: "2026-10-15",
      children: [{ file: source.file, revision: topicRevision(source, await store.readTopic(source.file)) }],
    };
    await store.writeTopic(summary.file, "Deployment uses staging.");
    await store.writeIndex([summary, ...catalog]);
    let records = await request<Topic[]>("topics");
    const detail = records.find((topic) => topic.file === original.file)!;
    const corrected = await request<{ file: string }>("topic", "POST", { project: "current", target: original.file, revision: detail.revision, title: "Deployment", type: "working", summary: "New deployment target", content: "Deploy to production." });
    records = await request<Topic[]>("topics");
    expect(records.find((topic) => topic.file === original.file)).toMatchObject({ content: "Deploy to staging.", status: "superseded", supersededBy: corrected.file });
    expect(records.find((topic) => topic.file === summary.file)).toMatchObject({ status: "retired" });
    expect(records.find((topic) => topic.file === corrected.file)).toMatchObject({ content: "Deploy to production.", type: "working", status: "active" });
    expect(records.find((topic) => topic.project === "other")).toMatchObject({ content: "Use SQLite.", type: "preference" });
    expect((await request<Topic[]>("topics?project=global")).map((topic) => ({ file: topic.file, content: topic.content }))).toEqual([{ file: global.file, content: "Keep explanations concise across projects." }]);

    await request("topic", "DELETE", { project: "current", file: summary.file });
    const remaining = await request<Topic[]>("topics?project=current");
    expect(remaining.map((topic) => topic.file).sort()).toEqual([original.file, corrected.file].sort());
    expect((await Bun.file(join(root, "current", original.file)).text()).trim()).toBe("Deploy to staging.");
  } finally {
    await dashboard.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard requires its token, rejects foreign origins and unknown projects, and refuses stale edits", async () => {
  const root = await mkdtemp("/tmp/opencode/memory-web-access-");
  const store = createMemoryStore(join(root, "current"), async () => true);
  const dashboard = serveDashboard({ root, projectKey: "current", directory: "/work/current", store, projectDirectory: async () => undefined });
  const launch = new URL(dashboard.url);
  const headers = { "x-memory-token": launch.hash.slice(1), "Content-Type": "application/json" };
  const input = { project: "current", title: "Rule", type: "instruction", summary: "Scope", content: "Use the local service." };
  try {
    expect((await fetch(new URL("/api/heartbeat", launch), { method: "POST" })).status).toBe(403);
    expect((await fetch(new URL("/api/heartbeat", launch), { method: "POST", headers })).status).toBe(200);
    expect((await fetch(new URL("/api/topics", launch))).status).toBe(403);
    expect((await fetch(new URL("/api/topic", launch), { method: "POST", headers: { ...headers, Origin: "https://example.com" }, body: JSON.stringify(input) })).status).toBe(403);
    expect((await fetch(new URL("/api/topic", launch), { method: "POST", headers, body: JSON.stringify({ ...input, project: "../outside" }) })).status).toBe(400);
    expect(await store.readCatalog()).toEqual([]);

    const created = await fetch(new URL("/api/topic", launch), { method: "POST", headers, body: JSON.stringify(input) });
    expect(created.status).toBe(200);
    const { file } = await created.json() as { file: string };
    const entry = (await store.readCatalog())[0]!;
    const revision = topicRevision(entry, await store.readTopic(file));
    await store.writeTopic(file, "User edited this file outside the dashboard.");
    const response = await fetch(new URL("/api/topic", launch), { method: "POST", headers, body: JSON.stringify({ ...input, target: file, revision, content: "Stale content." }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "This record changed. Refresh before saving." });
    expect(await store.readTopic(file)).toBe("User edited this file outside the dashboard.");
    expect(await store.readCatalog()).toEqual([entry]);
  } finally {
    await dashboard.stop();
    await rm(root, { recursive: true, force: true });
  }
});
