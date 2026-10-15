import { constants } from "node:fs";
import { copyFile, mkdir, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createMemoryStore, indexLine, topicRevision, type IndexEntry, type TopicStatus } from "./store.ts";

export function memoryProjectKey(directory: string): string {
  const path = resolve(directory);
  return `${path.toLowerCase().replace(/[^a-z._-]/g, "-")}-${Bun.hash.wyhash(path).toString(16).padStart(8, "0").slice(0, 8)}`;
}

export function memoryDataRoot(): string {
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "memory");
}

export const memoryScopeRoot = (dataRoot: string, key: string) => resolve(dataRoot, key);
export const openMemoryStore = (dataRoot: string, key: string, enabled: () => Promise<boolean> = async () => true) =>
  createMemoryStore(memoryScopeRoot(dataRoot, key), enabled);

export function memoryID(key: string, file: string, projectKey: string): string {
  return key === projectKey ? file : key === "global" ? `global:${file}` : `project:${key}:${file}`;
}

export function parseMemoryID(id: string, projectKey: string): { key: string; file: string } {
  const match = /^(?:global:([^/:]+)|project:([^/:]+):([^/:]+)|([^/:]+))$/.exec(id);
  if (!match) throw new Error("Use an exact memory id, not a filesystem path.");
  const key = match[1] ? "global" : match[2] ?? projectKey;
  const file = match[1] ?? match[3] ?? match[4]!;
  if (key === "." || key === ".." || file === "." || file === "..") throw new Error("Use an exact memory id, not a filesystem path.");
  return { key, file };
}

export function scopedEntry(entry: IndexEntry, key: string, projectKey: string): IndexEntry {
  const qualify = (file: string) => memoryID(key, file, projectKey);
  return {
    ...entry,
    file: qualify(entry.file),
    ...(entry.children ? { children: entry.children.map((child) => ({ ...child, file: qualify(child.file) })) } : {}),
    ...(entry.supersededBy ? { supersededBy: qualify(entry.supersededBy) } : {}),
  };
}

const SCOPE_ALIAS_FILE = ".scope-import.json";

// Imported source directories remain intact. The durable alias prevents deleted
// destination topics from being imported again on a future plugin activation.
export async function importMemoryPartition(dataRoot: string, sourceKey: string, targetKey: string): Promise<void> {
  if (sourceKey === targetKey) return;
  const sourceRoot = memoryScopeRoot(dataRoot, sourceKey);
  const source = openMemoryStore(dataRoot, sourceKey);
  const target = openMemoryStore(dataRoot, targetKey);
  await source.serializeWrite(async () => {
    const markerPath = join(sourceRoot, SCOPE_ALIAS_FILE);
    const marker = Bun.file(markerPath);
    if (await marker.exists()) {
      const alias = await marker.json() as { target: string };
      if (alias.target !== targetKey) throw new Error(`Memory partition ${sourceKey} was already imported into ${alias.target}`);
      return;
    }
    const incoming = await source.readCatalog();
    if (!await Bun.file(join(sourceRoot, "index.md")).exists()) return;
    await target.serializeWrite(async () => {
      const catalog = await target.readCatalog();
      const byFile = new Map(catalog.map((entry) => [entry.file, entry]));
      const bodies = new Map<string, string>();
      for (const entry of incoming) {
        const existing = byFile.get(entry.file);
        if (existing && indexLine(existing) !== indexLine(entry)) throw new Error(`Memory migration collision: ${entry.file}; original partitions were retained`);
        const content = await source.readTopicIfPresent(entry.file);
        if (content === undefined) continue;
        const destination = await target.readTopicIfPresent(entry.file);
        if (destination !== undefined && destination !== content) throw new Error(`Memory migration body collision: ${entry.file}; original partitions were retained`);
        if (destination === undefined) bodies.set(entry.file, content);
      }
      await mkdir(memoryScopeRoot(dataRoot, targetKey), { recursive: true });
      for (const file of bodies.keys()) await copyFile(join(sourceRoot, file), join(memoryScopeRoot(dataRoot, targetKey), file), constants.COPYFILE_EXCL);
      await target.writeIndex([...catalog, ...incoming.filter((entry) => !byFile.has(entry.file))]);
      const temporary = `${markerPath}.${crypto.randomUUID()}.tmp`;
      await Bun.write(temporary, JSON.stringify({ target: targetKey }));
      await rename(temporary, markerPath);
    });
  });
}

export async function listMemoryScopes(dataRoot: string): Promise<string[]> {
  const entries = await readdir(dataRoot, { withFileTypes: true }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  const keys: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await Bun.file(join(dataRoot, entry.name, SCOPE_ALIAS_FILE)).exists()) continue;
    keys.push(entry.name);
  }
  return keys.sort();
}

// Views qualify identifiers only at the API boundary; stored links and revision
// hashes always refer to the untouched local files.
export async function readScopedView(dataRoot: string, keys: string[], projectKey: string, enabled: () => Promise<boolean>) {
  const catalog: IndexEntry[] = [];
  const roots: IndexEntry[] = [];
  const contents = new Map<string, string>();
  const parents = new Map<string, string>();
  const statuses = new Map<string, TopicStatus>();
  const labels = new Map<string, string>();
  for (const key of keys) {
    const store = openMemoryStore(dataRoot, key, key === "global" || key === projectKey ? enabled : async () => false);
    const view = await store.readView();
    for (const entry of view.catalog) {
      const qualified = scopedEntry(entry, key, projectKey);
      const content = view.contents.get(entry.file);
      if (content !== undefined) {
        qualified.revision = topicRevision(entry, content);
        contents.set(qualified.file, content);
      }
      catalog.push(qualified);
      statuses.set(qualified.file, view.status(entry));
      const parent = view.parents.get(entry.file);
      if (parent) parents.set(qualified.file, memoryID(key, parent, projectKey));
      labels.set(qualified.file, view.label(entry).replace(/(consolidated into |superseded by )([^ ]+)/, (_, prefix, file) => `${prefix}${memoryID(key, file, projectKey)}`));
    }
    roots.push(...view.roots.map((entry) => scopedEntry(entry, key, projectKey)));
  }
  return { catalog, roots, contents, parents, byFile: new Map(catalog.map((entry) => [entry.file, entry])), status: (entry: IndexEntry) => statuses.get(entry.file)!, label: (entry: IndexEntry) => labels.get(entry.file)! };
}

// Long model calls do not hold the write queue, but only one dream may own a
// partition at a time, including the global partition shared across projects.
export const activeMemoryDreams = new Set<string>();
