const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem("memory-token");
if (token) sessionStorage.setItem("memory-token", token);
history.replaceState(null, "", location.pathname);

let projects = [];
let topics = [];
let selected;
let editing = false;
let dirty = false;
let busy = false;
let zoom = 1;
const expanded = new Set();
const seenRoots = new Set();

function notice(message, error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = !message;
}

async function api(path, method = "GET", data) {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: { "x-memory-token": token ?? "", ...(data ? { "Content-Type": "application/json" } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function heartbeat() {
  api("heartbeat", "POST").catch(() => notice("Dashboard disconnected. Reopen it with /memory-web.", true));
}
heartbeat();
setInterval(heartbeat, 30_000);

function discard() {
  return !dirty || confirm("Discard your unsaved changes?");
}

function projectOptions(select, all) {
  const current = select.value;
  select.replaceChildren(...(all ? [new Option("All scopes", "")] : []), ...projects.map((project) => new Option(project.name, project.id)));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function renderList() {
  const project = $("project").value;
  const words = $("search").value.toLowerCase().split(/[\s,"]+/).filter(Boolean);
  const status = $("status").value;
  const scoped = topics.filter((topic) => (!project || topic.project === project)
    && (status === "current" ? ["active", "consolidated"].includes(topic.status) : !["active", "consolidated"].includes(topic.status)));
  const records = scoped.filter((topic) => words.every((word) => `${topic.title}\n${topic.summary}\n${topic.content}`.toLowerCase().includes(word)));
  $("graph-toolbar").hidden = status !== "current";
  $("topics").classList.toggle("graph-view", status === "current");
  if (status === "current") {
    renderGraph(scoped, records, words.length > 0);
    return;
  }
  $("count").textContent = `${records.length} historical or unavailable records`;
  $("topics").replaceChildren();
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No matching history. Try fewer search words or select another project.";
    $("topics").append(empty);
  }
  for (const topic of records) {
    const button = document.createElement("button");
    button.className = "topic";
    button.setAttribute("aria-current", String(topic.project === selected?.project && topic.file === selected?.file));
    const title = document.createElement("strong");
    title.textContent = topic.title;
    const preview = document.createElement("span");
    preview.className = "preview";
    preview.textContent = topic.summary;
    preview.title = topic.summary;
    const meta = document.createElement("small");
    meta.textContent = `${topic.type} · ${topic.status}${project ? "" : ` · ${topic.projectName}`}`;
    button.append(title, preview, meta);
    button.addEventListener("click", () => selectTopic(topic));
    $("topics").append(button);
  }
}

function selectTopic(topic, reveal = false) {
  if (busy || !discard()) return;
  selected = topic;
  editing = dirty = false;
  $("status").value = ["active", "consolidated"].includes(topic.status) ? "current" : "history";
  if (reveal) $("search").value = "";
  let parent = topic.parent;
  while (parent) {
    expanded.add(`${topic.project}/${parent}`);
    parent = topics.find((record) => record.project === topic.project && record.file === parent)?.parent;
  }
  renderRecord();
  renderList();
  const node = $("topics").querySelector(`[data-node="${CSS.escape(`${topic.project}/${topic.file}`)}"]`);
  if (node) node.scrollIntoView({ block: "nearest", inline: "nearest" });
  $("record-title").focus({ preventScroll: true });
  if (matchMedia("(max-width: 800px)").matches) $("detail").scrollIntoView({ behavior: "instant" });
}

function renderGraph(records, matches, searching) {
  const byKey = new Map(records.map((topic) => [`${topic.project}/${topic.file}`, topic]));
  const parents = new Map();
  for (const topic of records) for (const child of topic.children ?? []) {
    const key = `${topic.project}/${child.file}`;
    const links = parents.get(key) ?? [];
    links.push(`${topic.project}/${topic.file}`);
    parents.set(key, links);
  }
  const included = new Set();
  const includeSources = (topic) => {
    const key = `${topic.project}/${topic.file}`;
    if (included.has(key)) return;
    included.add(key);
    for (const child of topic.children ?? []) {
      const source = byKey.get(`${topic.project}/${child.file}`);
      if (source) includeSources(source);
    }
  };
  for (const topic of matches) includeSources(topic);
  // Search retains the links back to the overview, not just isolated hits.
  for (const key of included) for (const parent of parents.get(key) ?? []) included.add(parent);

  const surface = document.createElement("div");
  surface.className = "graph-surface";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("graph-edges");
  svg.setAttribute("aria-hidden", "true");
  surface.append(svg);
  const positions = new Map();
  const edges = [];
  let cursor = 0;
  let width = 0;
  const place = (topic, depth) => {
    const key = `${topic.project}/${topic.file}`;
    if (positions.has(key)) return positions.get(key).y;
    const children = (topic.children ?? []).map((child) => byKey.get(`${topic.project}/${child.file}`))
      .filter((source) => source && included.has(`${source.project}/${source.file}`));
    const open = searching || expanded.has(key);
    const rows = open ? children.map((child) => {
      const y = place(child, depth + 1);
      edges.push([key, `${child.project}/${child.file}`]);
      return y;
    }) : [];
    const y = rows.length ? rows[0] : cursor;
    if (!rows.length) cursor += 200;
    const x = 24 + depth * 320;
    positions.set(key, { topic, x, y, children, open });
    width = Math.max(width, x + 280);
    return y;
  };
  for (const project of projects) {
    const roots = records.filter((topic) => topic.project === project.id && included.has(`${topic.project}/${topic.file}`)
      && !parents.has(`${topic.project}/${topic.file}`));
    if (!roots.length) continue;
    roots.sort((a, b) => Number(Boolean(b.children?.length)) - Number(Boolean(a.children?.length)));
    const heading = document.createElement("h2");
    heading.className = "graph-project";
    heading.style.top = `${cursor + 16}px`;
    heading.textContent = project.name;
    heading.title = project.name;
    surface.append(heading);
    cursor += 76;
    for (const root of roots) place(root, 0);
    cursor += 20;
  }
  const lineage = new Set();
  if (selected) {
    lineage.add(`${selected.project}/${selected.file}`);
    for (const key of lineage) for (const parent of parents.get(key) ?? []) lineage.add(parent);
  }
  for (const [from, to] of edges) {
    const parent = positions.get(from);
    const child = positions.get(to);
    const x = parent.x + 256;
    const y = parent.y + 88;
    const endY = child.y + 88;
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", `M ${x} ${y} C ${x + 32} ${y}, ${child.x - 32} ${endY}, ${child.x} ${endY}`);
    path.setAttribute("class", `graph-edge${lineage.has(from) && lineage.has(to) ? " selected" : ""}`);
    svg.append(path);
  }
  for (const [key, node] of [...positions].sort((a, b) => a[1].x - b[1].x || a[1].y - b[1].y)) {
    const { topic, x, y, children, open } = node;
    const card = document.createElement("div");
    card.className = `graph-node${children.length ? " summary-node" : ""}${lineage.has(key) ? " in-lineage" : ""}${topic.project === selected?.project && topic.file === selected?.file ? " selected" : ""}`;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    const button = document.createElement("button");
    button.className = "topic graph-select";
    button.dataset.node = key;
    button.setAttribute("aria-current", String(topic.project === selected?.project && topic.file === selected?.file));
    const kind = document.createElement("small");
    kind.className = "node-kind";
    kind.textContent = topic.children?.length ? `Summary · ${topic.children.length} sources` : ["preference", "instruction"].includes(topic.type) ? `Rule · ${topic.type}` : topic.type;
    const title = document.createElement("strong");
    title.textContent = topic.title;
    title.title = topic.title;
    const hook = document.createElement("span");
    hook.className = "preview";
    hook.textContent = topic.summary;
    hook.title = topic.summary;
    button.append(kind, title, hook);
    button.addEventListener("click", () => selectTopic(topic));
    card.append(button);
    if (children.length && !searching) {
      const toggle = document.createElement("button");
      toggle.className = "graph-toggle";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} sources of ${topic.title}`);
      toggle.textContent = `${open ? "− Hide" : "+ Show"} ${children.length} sources`;
      toggle.addEventListener("click", () => {
        if (busy) return;
        if (open) expanded.delete(key); else expanded.add(key);
        renderList();
        $("topics").querySelector(`[data-node="${CSS.escape(key)}"]`).nextElementSibling.focus({ preventScroll: true });
      });
      card.append(toggle);
    }
    surface.append(card);
  }
  const height = Math.max(cursor, 280);
  surface.style.width = `${Math.max(width, 320)}px`;
  surface.style.height = `${height}px`;
  surface.style.transform = `scale(${zoom})`;
  svg.setAttribute("width", String(Math.max(width, 320)));
  svg.setAttribute("height", String(height));
  const frame = document.createElement("div");
  frame.className = "graph-frame";
  frame.style.width = `${Math.max(width, 320) * zoom}px`;
  frame.style.height = `${height * zoom}px`;
  frame.append(surface);
  $("topics").replaceChildren(frame);
  $("count").textContent = `${positions.size} visible · ${records.length} current records${searching ? ` · ${matches.length} search matches` : ""}`;
  $("graph-help").textContent = !matches.length ? "No matching memories. Try fewer search words."
    : !records.some((topic) => topic.children?.length) ? "No linked summary layers in this view. Rules and unsummarized details stand alone; older insights may lack source links."
    : searching ? "Matching branches are expanded, with their ancestors and sources. Clear search to collapse branches."
    : "Expand sources to go deeper. Scroll to pan; select a node to read it.";
  $("zoom-reset").textContent = `${Math.round(zoom * 100)}%`;
  $("zoom-out").disabled = zoom <= 0.5;
  $("zoom-in").disabled = zoom >= 1.5;
}

function renderRecord() {
  const creating = editing && !selected;
  $("empty").hidden = Boolean(selected) || creating;
  $("record").hidden = !selected && !creating;
  if (!selected && !creating) return;
  $("record-project").textContent = selected?.projectName ?? "New record";
  $("record-title").textContent = selected?.title ?? "Create memory";
  $("record-meta").textContent = selected ? [
    `${selected.type} · ${selected.status} · captured/updated ${selected.updated}`,
    selected.file,
    ...(selected.origin ? [`Captured via ${selected.origin}${selected.origin === "dashboard" && selected.evidence?.length ? " · chat sources are inherited" : ""}`] : []),
    ...(selected.evidenceThrough ? [`Known user statements through ${selected.evidenceThrough}`] : []),
    ...(selected.evidence ?? []).map((source) => `User source: ${source.sessionID} / ${source.messageID} · ${new Date(source.createdAt).toISOString()}`),
  ].join("\n") : "One subject per memory.";
  $("summary").textContent = selected?.summary ?? "";
  $("body").textContent = selected?.content ?? "";
  $("editor").hidden = !editing;
  $("body").hidden = $("summary").hidden = editing;
  $("edit").hidden = editing || Boolean(selected?.children) || Boolean(selected?.supersededBy && topics.some((topic) => topic.project === selected.project && topic.file === selected.supersededBy));
  $("delete").hidden = editing;
  const explanation = selected?.children ? "Derived summary: inspect or correct its sources. Delete this summary to unfold it without deleting its sources."
    : selected?.status === "superseded" ? "Historical version, not current guidance. Follow its replacement below."
    : selected?.status === "missing" ? "The body file is missing. You can save a correction to restore this record under a new ID."
    : selected?.status === "consolidated" ? "This detail is retained beneath a summary. Editing it retires the summaries above it."
    : "";
  $("explanation").textContent = explanation;
  $("explanation").hidden = !explanation;
  if (editing) {
    projectOptions($("edit-project"), false);
    $("edit-project").value = selected?.project ?? ($("project").value || projects.find((project) => project.current)?.id);
    $("edit-project").disabled = Boolean(selected);
    $("title").value = selected?.title ?? "";
    $("edit-summary").value = selected?.summary ?? "";
    for (const option of [...$("type").options]) if (option.dataset.legacy) option.remove();
    if (selected && ![...$("type").options].some((option) => option.value === selected.type)) {
      const option = new Option(selected.type, selected.type);
      option.dataset.legacy = "true";
      $("type").append(option);
    }
    $("type").value = selected?.type ?? "fact";
    $("type").disabled = selected?.type === "insight";
    $("content").value = selected?.content ?? "";
    $("save").textContent = creating ? "Create memory" : "Save correction";
  }
  $("relations").replaceChildren();
  $("relations").hidden = editing;
  if (!selected || editing) return;
  const relations = [
    ...(selected.children ?? []).map((child) => ["Source", child.file]),
    ...(selected.parent ? [["Parent summary", selected.parent]] : []),
    ...(selected.supersededBy ? [["Replacement", selected.supersededBy]] : []),
    ...topics.filter((topic) => topic.project === selected.project && topic.supersededBy === selected.file).map((topic) => ["Earlier version", topic.file]),
  ];
  if (!relations.length) return;
  const heading = document.createElement("h3");
  heading.textContent = "Related records";
  $("relations").append(heading);
  for (const [relation, file] of relations) {
    const topic = topics.find((topic) => topic.project === selected.project && topic.file === file);
    const button = document.createElement("button");
    button.textContent = `${relation}: ${topic?.title ?? file}${topic ? ` · ${topic.status}` : " · deleted"}`;
    button.disabled = !topic;
    button.addEventListener("click", () => selectTopic(topic, true));
    $("relations").append(button);
  }
}

async function refresh(focus) {
  $("count").textContent = "Loading memories…";
  const [nextProjects, nextTopics] = await Promise.all([api("projects"), api("topics")]);
  projects = nextProjects;
  topics = nextTopics;
  for (const topic of topics) {
    const key = `${topic.project}/${topic.file}`;
    if (topic.status === "active" && topic.children?.length && !seenRoots.has(key)) {
      expanded.add(key);
      seenRoots.add(key);
    }
  }
  projectOptions($("project"), true);
  const previous = focus ?? selected;
  selected = previous && topics.find((topic) => topic.project === previous.project && topic.file === previous.file);
  if (focus && selected) {
    $("status").value = ["active", "consolidated"].includes(selected.status) ? "current" : "history";
    if ($("project").value && $("project").value !== selected.project) $("project").value = selected.project;
    $("search").value = "";
  }
  editing = dirty = false;
  renderList();
  renderRecord();
}

async function run(work) {
  if (busy) return;
  busy = true;
  for (const id of ["save", "refresh", "create", "delete", "edit", "cancel"]) $(id).disabled = true;
  $("editor").inert = true;
  try {
    await work();
  } catch (error) {
    notice(error.message, true);
  } finally {
    busy = false;
    for (const id of ["save", "refresh", "create", "delete", "edit", "cancel"]) $(id).disabled = false;
    $("editor").inert = false;
    $("edit-project").disabled = Boolean(selected);
    $("type").disabled = selected?.type === "insight";
  }
}

for (const id of ["project", "status", "search"]) $(id).addEventListener(id === "search" ? "input" : "change", renderList);
for (const [id, change] of [["zoom-out", -0.125], ["zoom-in", 0.125], ["zoom-reset", 0]]) $(id).addEventListener("click", () => {
  zoom = change ? Math.max(0.5, Math.min(1.5, zoom + change)) : 1;
  renderList();
});
$("editor").addEventListener("input", () => { dirty = true; });
$("refresh").addEventListener("click", () => { if (discard()) void run(async () => { await refresh(); notice("Memories refreshed."); }); });
$("create").addEventListener("click", () => {
  if (!discard()) return;
  selected = undefined;
  editing = true;
  dirty = false;
  renderList();
  renderRecord();
  $("title").focus();
});
$("edit").addEventListener("click", () => { editing = true; renderRecord(); $("title").focus(); });
$("cancel").addEventListener("click", () => {
  if (!discard()) return;
  editing = dirty = false;
  renderRecord();
});
$("editor").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const project = $("edit-project").value;
    const result = await api("topic", "POST", {
      project, target: selected?.file, revision: selected?.revision,
      title: $("title").value, type: $("type").value, summary: $("edit-summary").value, content: $("content").value,
    });
    dirty = false;
    await refresh({ project, file: result.file });
    notice("Memory saved. Any previous version is preserved in history.");
  });
});
$("delete").addEventListener("click", () => {
  $("delete-description").textContent = selected.children ? `Unfold “${selected.title}”? Its source records will remain.` : `Delete “${selected.title}”?`;
  $("confirmation").returnValue = "";
  $("confirmation").showModal();
});
$("confirmation").addEventListener("close", () => {
  if ($("confirmation").returnValue !== "delete") return;
  void run(async () => {
    const result = await api("topic", "DELETE", { project: selected.project, file: selected.file });
    selected = undefined;
    await refresh();
    notice(`Deleted ${result.removed.length} record(s). Source details and earlier versions were preserved.`);
  });
});
addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
void run(() => refresh());
