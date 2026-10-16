// Playwright documents ariaSnapshotJSON as a free-form JSON tree, not a public TS type.
export type SnapshotNode = {
  role: string;
  name?: string;
  text?: string;
  ref?: string;
  children?: (SnapshotNode | string)[];
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean | "mixed";
  level?: number;
  value?: string;
  placeholder?: string;
};

type Entry = { id: string; node: SnapshotNode; parent?: Entry; children: Entry[]; depth: number };
const BUDGET = 7000;

export class Observation {
  readonly entries = new Map<string, Entry>();
  readonly root: Entry;

  constructor(readonly id: string, tree: (SnapshotNode | string)[]) {
    let ordinal = 0;
    const index = (node: SnapshotNode | string, parent?: Entry): Entry => {
      const value = typeof node === "string" ? { role: "text", text: node } : node;
      const entry: Entry = {
        id: value.ref ?? `n${ordinal++}`,
        node: value,
        parent,
        depth: parent ? parent.depth + 1 : 0,
        children: [],
      };
      this.entries.set(entry.id, entry);
      entry.children = (value.children ?? []).map((child) => index(child, entry));
      return entry;
    };
    this.root = index({ role: "document", children: tree });
  }

  entry(ref?: string): Entry {
    if (ref === undefined) return this.root;
    const prefix = `${this.id}:`;
    if (!ref.startsWith(prefix)) throw new Error("Stale observation ref. Take a new snapshot and use its refs.");
    const entry = this.entries.get(ref.slice(prefix.length));
    if (!entry) throw new Error("Unknown observation ref. Use a ref returned by snapshot, expand, or find.");
    return entry;
  }

  element(ref: string): string {
    const entry = this.entry(ref);
    if (!entry.node.ref) throw new Error("This ref identifies snapshot structure, not an element. Expand it or use run_code.");
    return entry.node.ref;
  }

  view(ref?: string, offset = 0, depth = 3) {
    const root = this.entry(ref);
    const candidates: Entry[] = [];
    const collect = (entry: Entry) => {
      candidates.push(entry);
      if (entry.depth - root.depth < depth) entry.children.forEach(collect);
    };
    collect(root);
    return this.render(candidates, root, offset, depth);
  }

  find(text: string, ref?: string, offset = 0) {
    const root = this.entry(ref);
    const needle = text.toLocaleLowerCase();
    const matches: Entry[] = [];
    const visit = (entry: Entry) => {
      const { name = "", text = "", value = "", placeholder = "" } = entry.node;
      if (`${name}\n${text}\n${value}\n${placeholder}`.toLocaleLowerCase().includes(needle)) matches.push(entry);
      entry.children.forEach(visit);
    };
    visit(root);
    return { ...this.render(matches, root, offset), matches: matches.length };
  }

  read(ref?: string, offset = 0) {
    const root = this.entry(ref);
    const lines: string[] = [];
    const visit = (entry: Entry) => {
      const { role, name, text, value } = entry.node;
      const content = [name, text, value].filter((part) => part !== undefined && part !== "").join("\n");
      if (content) lines.push(`${"  ".repeat(Math.min(entry.depth - root.depth, 12))}${role}: ${content}`);
      entry.children.forEach(visit);
    };
    visit(root);
    const text = lines.join("\n");
    const page = text.slice(offset, offset + BUDGET);
    return {
      observation: this.id,
      root: `${this.id}:${root.id}`,
      text: page,
      totalChars: text.length,
      ...(offset + page.length < text.length ? { next: offset + page.length } : {}),
    };
  }

  private line(entry: Entry, root: Entry, collapsed: boolean) {
    const node = entry.node;
    const label = [node.name, node.text].filter(Boolean).join(" ").replace(/\s+/g, " ");
    const preview = label.length > 220 ? `${label.slice(0, 220)}… (read for full text)` : label;
    const states = (["checked", "disabled", "expanded", "selected", "pressed", "level"] as const)
      .filter((key) => node[key] !== undefined)
      .map((key) => `${key}=${node[key]}`);
    if (node.value !== undefined) states.push(`value=${JSON.stringify(node.value.slice(0, 120))}`);
    if (node.placeholder) states.push(`placeholder=${JSON.stringify(node.placeholder.slice(0, 120))}`);
    const suffix = collapsed ? ` (${entry.children.length} children; expand)` : "";
    return `${"  ".repeat(Math.min(entry.depth - root.depth, 12))}[${this.id}:${entry.id}] ${node.role}${preview ? ` ${JSON.stringify(preview)}` : ""}${states.length ? ` [${states.join(" ")}]` : ""}${suffix}`;
  }

  private render(candidates: Entry[], root: Entry, offset: number, depth?: number) {
    const lines: string[] = [];
    const shown = new Set<Entry>();
    let chars = 0;
    let next = offset;
    for (const entry of candidates.slice(offset)) {
      const path: Entry[] = [];
      let ancestor: Entry | undefined = entry;
      while (ancestor && ancestor.depth >= root.depth) {
        if (!shown.has(ancestor)) path.unshift(ancestor);
        ancestor = ancestor.parent;
      }
      const block = path.map((item) => this.line(item, root, item.children.length > 0 && (
        depth === undefined || item.depth - root.depth >= depth
      )));
      const size = block.reduce((sum, line) => sum + line.length + 1, 0);
      if (chars + size > BUDGET) break;
      lines.push(...block);
      path.forEach((item) => shown.add(item));
      chars += size;
      next++;
    }
    if (next === offset && offset < candidates.length) {
      const entry = candidates[offset];
      if (entry) throw new Error(`Ancestor context exceeds the output budget. Expand ${this.id}:${entry.id} as a narrower root.`);
    }
    return {
      observation: this.id,
      root: `${this.id}:${root.id}`,
      outline: lines.join("\n"),
      total: candidates.length,
      ...(next < candidates.length ? { next } : {}),
    };
  }
}
