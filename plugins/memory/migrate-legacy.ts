// One-time migration from older memory formats. Run with OpenCode closed,
// before starting the current plugin: `bun plugins/memory/migrate-legacy.ts`.
// - exports storage-backed index and topics to markdown files
// - strips the retired scope from `[type|scope|date]` index lines
// - drops session state without a known index (the next request re-snapshots)
import { Database } from "bun:sqlite";
import { copyFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const base = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode");
const prefix = "plugin:006d0065006d006f00720079:";
const dbPath = join(base, "opencode.db");
await copyFile(dbPath, `${dbPath}.bak`);
const db = new Database(dbPath);
const value = (key: string) => JSON.parse((db.query("select value from kv where key = ?").get(key) as { value: string }).value);

type Entry = { title: string; file: string; summary: string; type: string; updated: string };
const line = (entry: Entry) => `- [${entry.title.replace(/[\[\]\r\n]/g, " ").trim()}](${entry.file}) - [${entry.type}|${entry.updated}] ${entry.summary.replace(/[\r\n]/g, " ").trim()}\n`;

const indexKeys = db.query("select key from kv where key like ?").all(`${prefix}memory/%/index`) as { key: string }[];
for (const { key } of indexKeys) {
  const project = key.slice(`${prefix}memory/`.length, -"/index".length);
  const root = join(base, "memory", project);
  const index = value(key) as Entry[];
  for (const entry of index) {
    await Bun.write(join(root, `${entry.file}.md`), `${value(`${prefix}memory/${project}/topic/${entry.file}`).content.trim()}\n`);
  }
  await Bun.write(join(root, "index.md"), index.map((entry) => line({ ...entry, file: `${entry.file}.md` })).join(""));
  db.run("delete from kv where key = ? or key like ?", [key, `${prefix}memory/${project}/topic/%`]);
  console.log(`exported ${project}: ${index.length} topics`);
}

for (const project of await readdir(join(base, "memory"))) {
  const path = join(base, "memory", project, "index.md");
  const file = Bun.file(path);
  if (!(await file.exists())) continue;
  const text = await file.text();
  const migrated = text.replace(/^(- \[[^\]]+\]\([^)]+\) - \[[a-z]+)\|[^|\]]+\|(\d{4}-\d{2}-\d{2}\])/gm, "$1|$2");
  if (migrated === text) continue;
  await copyFile(path, `${path}.bak`);
  await Bun.write(path, migrated);
  console.log(`stripped scope: ${project}`);
}

const stale = db.run("delete from kv where key like ? and value not like ?", [`${prefix}session/%`, '%"knownIndex"%']);
console.log(`dropped ${stale.changes} old session states`);
