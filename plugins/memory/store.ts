import { rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export type MemoryType = "preference" | "instruction" | "fact" | "working" | "recap" | "reference";
export type StoredType = MemoryType | "feedback" | "project" | "insight";
export type IndexEntry = {
  title: string;
  file: string;
  summary: string;
  type: StoredType;
  updated: string;
  children?: Array<{ file: string; revision: string }>;
  supersededBy?: string;
  retired?: boolean;
  sourceUpdated?: string;
  revision?: string;
};
export type TopicStatus = "active" | "consolidated" | "superseded" | "retired" | "missing";
export type MemoryInput = { target?: string; title?: string; summary?: string; content: string; type?: StoredType };

// Metadata stays in index comments so topic bodies remain ordinary markdown.
export function parseIndex(text: string): IndexEntry[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^- \[([^\]]+)]\(([^)/]+)\) - \[([a-z]+)\|(\d{4}-\d{2}-\d{2})\] (.*?)(?: <!-- memory:(\{.*\}) -->)?$/);
    if (!match) return [];
    const entry: IndexEntry = { title: match[1]!, file: match[2]!, type: match[3] as StoredType, updated: match[4]!, summary: match[5]! };
    if (match[6]) {
      const meta = JSON.parse(match[6]) as Pick<IndexEntry, "children" | "supersededBy" | "retired" | "sourceUpdated">;
      if (meta.children) entry.children = meta.children;
      if (meta.supersededBy) entry.supersededBy = meta.supersededBy;
      if (meta.retired) entry.retired = true;
      if (meta.sourceUpdated) entry.sourceUpdated = meta.sourceUpdated;
    }
    return [entry];
  });
}

export function indexLine(entry: IndexEntry): string {
  const title = entry.title.replace(/[\[\]\r\n]/g, " ").trim();
  const summary = entry.summary.replace(/[\r\n]/g, " ").trim();
  const line = `- [${title}](${entry.file}) - [${entry.type}|${entry.updated}] ${summary}`;
  if (!entry.children && !entry.supersededBy && !entry.retired && !entry.sourceUpdated) return line;
  const meta = {
    ...(entry.children ? { children: entry.children.map(({ file, revision }) => ({ file, revision })) } : {}),
    ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}),
    ...(entry.retired ? { retired: true } : {}),
    ...(entry.sourceUpdated ? { sourceUpdated: entry.sourceUpdated } : {}),
  };
  return `${line} <!-- memory:${JSON.stringify(meta)} -->`;
}

export function topicRevision(entry: IndexEntry, content: string): string {
  return Bun.hash.wyhash(`${indexLine(entry)}\n${content}`).toString(16).padStart(16, "0");
}

export function topicFile(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "memory";
  return `${slug}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}.md`;
}

export const isRule = (entry: IndexEntry) => entry.type === "preference" || entry.type === "instruction";

// Share serialization, never the caller's enabled policy, across all views.
const writeQueues = new Map<string, Promise<void>>();
function serializeMemoryRoot<Value>(root: string, work: () => Promise<Value>): Promise<Value> {
  const key = resolve(root);
  const next = (writeQueues.get(key) ?? Promise.resolve()).then(work, work);
  writeQueues.set(key, next.then(() => {}, () => {}));
  return next;
}

export function createMemoryStore(root: string, enabled: () => Promise<boolean>) {
  const indexPath = join(root, "index.md");
  const serializeWrite = <Value,>(work: () => Promise<Value>) => serializeMemoryRoot(root, work);
  const atomicWrite = async (path: string, content: string) => {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, content);
    await rename(temporary, path);
  };
  const writeIndex = (entries: IndexEntry[]) => atomicWrite(indexPath, entries.map((entry) => `${indexLine(entry)}\n`).join(""));
  const writeTopic = (file: string, content: string) => atomicWrite(join(root, file), `${content.trim()}\n`);
  const readCatalog = async () => {
    const file = Bun.file(indexPath);
    return await file.exists() ? parseIndex(await file.text()) : [];
  };
  const readTopic = async (file: string) => (await Bun.file(join(root, file)).text()).trim();
  const readTopicIfPresent = (file: string) => readTopic(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  const readView = async (current?: IndexEntry[]): Promise<{
    catalog: IndexEntry[];
    byFile: Map<string, IndexEntry>;
    contents: Map<string, string>;
    parents: Map<string, string>;
    status: (entry: IndexEntry) => TopicStatus;
    label: (entry: IndexEntry) => string;
    roots: IndexEntry[];
  }> => {
    if (!current) return serializeWrite(async () => readView(await readCatalog()));
    const catalog = current;
    const byFile = new Map(catalog.map((entry) => [entry.file, entry]));
    const contents = new Map<string, string>();
    for (let offset = 0; offset < catalog.length; offset += 4) {
      await Promise.all(catalog.slice(offset, offset + 4).map(async (entry) => {
        if (entry.retired || entry.supersededBy) return;
        const content = await readTopicIfPresent(entry.file);
        if (content !== undefined) contents.set(entry.file, content);
      }));
    }
    const validity = new Map<string, boolean>();
    const valid = (entry: IndexEntry): boolean => {
      if (!entry.children) return true;
      const known = validity.get(entry.file);
      if (known !== undefined) return known;
      validity.set(entry.file, false);
      const result = !entry.retired && !entry.supersededBy && contents.has(entry.file) && entry.children.every((child) => {
        const source = byFile.get(child.file);
        const content = contents.get(child.file);
        return source !== undefined && content !== undefined && !source.supersededBy && valid(source) && topicRevision(source, content) === child.revision;
      });
      validity.set(entry.file, result);
      return result;
    };
    const retired = catalog.filter((entry) => entry.children && !entry.retired && !valid(entry));
    if (retired.length > 0) {
      for (const entry of retired) entry.retired = true;
      if (await enabled()) await writeIndex(catalog);
    }
    const parents = new Map<string, string>();
    for (const entry of catalog) {
      if (entry.children && valid(entry)) for (const child of entry.children) parents.set(child.file, entry.file);
    }
    const status = (entry: IndexEntry): TopicStatus =>
      entry.retired ? "retired" : entry.supersededBy ? "superseded" : !contents.has(entry.file) ? "missing" : parents.has(entry.file) ? "consolidated" : "active";
    const label = (entry: IndexEntry) => {
      const value = status(entry);
      if (value === "consolidated") return `consolidated into ${parents.get(entry.file)}`;
      if (value === "superseded") return `superseded by ${entry.supersededBy}${byFile.has(entry.supersededBy!) ? "" : " (deleted)"}`;
      if (value === "retired") return "retired summary: its sources changed; read the listed sources instead";
      if (value === "missing") return "missing body; catalog metadata retained";
      return "active";
    };
    return { catalog, byFile, contents, parents, status, label, roots: catalog.filter((entry) => status(entry) === "active").map((entry) => ({ ...entry, revision: topicRevision(entry, contents.get(entry.file)!) })) };
  };

  // Called within serializeWrite, also used by reflection's revision-checked corrections.
  const save = async (catalog: IndexEntry[], input: MemoryInput, expectedRevision?: string) => {
    const previous = input.target === undefined ? undefined : catalog.find((entry) => entry.file === input.target);
    if (input.target !== undefined) {
      if (!previous) throw new Error(`Memory index does not contain ${input.target}`);
      if (previous.children) throw new Error(`${input.target} is a derived summary, not an editable detail. Correct an incorrect source with memory_correct, or remove this summary with memory_delete to expose its unchanged sources. No replacement summary is generated by deletion; the user can run /dream.`);
      if (previous.supersededBy && catalog.some((entry) => entry.file === previous.supersededBy)) throw new Error(`${input.target} was superseded by ${previous.supersededBy}; use memory_correct with id ${previous.supersededBy}.`);
      if (expectedRevision && topicRevision(previous, await readTopic(previous.file)) !== expectedRevision) throw new Error(`${input.target} changed during reflection; its correction was not applied`);
    }
    const title = input.title?.replace(/[\[\]\r\n]/g, " ").trim() || previous?.title;
    if (!title) throw new Error("Provide a non-empty title for a new memory.");
    const summary = input.summary?.trim() || previous?.summary || "";
    const type = expectedRevision || previous?.type === "insight" ? previous!.type : input.type ?? previous!.type;
    const file = topicFile(title);
    await writeTopic(file, input.content);
    const entry: IndexEntry = { title, file, summary, type, updated: new Date().toISOString().slice(0, 10) };
    const index = [entry, ...catalog.map((current) => current === previous ? { ...current, supersededBy: file } : current)];
    try {
      await writeIndex(index);
    } catch (error) {
      await rm(join(root, file), { force: true });
      throw error;
    }
    return { entry, index };
  };
  const remove = async (catalog: IndexEntry[], file: string) => {
    const target = catalog.find((entry) => entry.file === file);
    if (!target) throw new Error(`Memory index does not contain ${file}`);
    const removed = new Set([file]);
    for (let grew = true; grew;) {
      grew = false;
      for (const entry of catalog) {
        if (removed.has(entry.file) || !entry.children?.some((child) => removed.has(child.file))) continue;
        removed.add(entry.file);
        grew = true;
      }
    }
    await writeIndex(catalog.filter((entry) => !removed.has(entry.file)));
    for (const name of removed) await rm(join(root, name), { force: true });
    return { removed, earlier: catalog.filter((entry) => entry.supersededBy === file).map((entry) => entry.file), sources: target.children?.map((child) => child.file) };
  };
  return { readCatalog, readTopic, readTopicIfPresent, readView, writeIndex, writeTopic, serializeWrite, save, remove };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
