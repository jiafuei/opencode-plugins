const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem("openrouter-token");
if (token) sessionStorage.setItem("openrouter-token", token);
history.replaceState(null, "", location.pathname + location.search);
const sessionID = new URLSearchParams(location.search).get("sessionID") || undefined;
let catalog;
let dirty = false;
let sequence = 0;
let timer;
let selection = { scope: "global", modelID: "" };
const controls = new Map();

async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function showError(error) {
  $("error").textContent = error?.message ?? "";
  $("error").hidden = !error;
}

function inputData(patch) {
  return { ...selection, sessionID, previewModelID: $("preview-model").value.trim(), variant: $("variant").value, patch };
}

function collect() {
  const patch = {};
  for (const [key, { mode, value, field }] of controls) {
    if (mode.value === "inherit") continue;
    if (mode.value === "remove") { patch[key] = { mode: "remove" }; continue; }
    let parsed;
    if (field.type === "list") parsed = value.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
    else if (field.type === "boolean") parsed = value.value === "true";
    else if (field.type === "enum") parsed = value.value;
    else {
      try { parsed = JSON.parse(value.value); }
      catch { throw new Error(`${field.label}: enter a valid JSON value.`); }
    }
    patch[key] = { mode: mode.value, value: parsed };
  }
  return patch;
}

function renderFields(patch) {
  $("fields").replaceChildren();
  controls.clear();
  let group;
  let currentGroup;
  for (const field of catalog.fields) {
    if (currentGroup !== field.group) {
      currentGroup = field.group;
      group = document.createElement("section");
      group.className = "group";
      const heading = document.createElement("h3");
      heading.textContent = field.group;
      group.append(heading);
      $("fields").append(group);
    }
    const row = document.createElement("div");
    row.className = "field";
    const top = document.createElement("div");
    top.className = "field-top";
    const label = document.createElement("label");
    label.htmlFor = `${field.key}-value`;
    label.textContent = field.label;
    const code = document.createElement("code");
    code.textContent = field.key;
    label.append(code);
    const mode = document.createElement("select");
    mode.setAttribute("aria-label", `${field.label} override mode`);
    const modes = [["inherit", "Inherit"], ["set", field.type === "list" ? "Replace" : "Set"], ...(field.type === "list" ? [["append", "Append"]] : []), ["remove", "Remove"]];
    for (const [id, text] of modes) mode.add(new Option(text, id));
    mode.value = patch[field.key]?.mode ?? "inherit";
    const value = document.createElement(field.type === "boolean" || field.type === "enum" ? "select" : "textarea");
    value.id = `${field.key}-value`;
    value.className = "value";
    value.setAttribute("aria-describedby", `${field.key}-hint`);
    if (field.type === "boolean") { value.add(new Option("Enabled", "true")); value.add(new Option("Disabled", "false")); }
    if (field.type === "enum") { value.add(new Option("Deny", "deny")); value.add(new Option("Allow", "allow")); }
    const configured = patch[field.key]?.value;
    if (configured !== undefined) value.value = field.type === "list" ? configured.join("\n") : field.type === "json" ? JSON.stringify(configured, null, 2) : String(configured);
    else if (field.type === "json") value.value = field.key === "sort" ? '"price"' : field.key === "max_price" ? "{}" : "50";
    const hint = document.createElement("p");
    hint.id = `${field.key}-hint`;
    hint.className = "help";
    hint.textContent = field.hint;
    value.hidden = mode.value === "inherit" || mode.value === "remove";
    mode.addEventListener("change", () => { value.hidden = mode.value === "inherit" || mode.value === "remove"; changed(); });
    value.addEventListener("input", changed);
    top.append(label, mode);
    row.append(top, value, hint);
    group.append(row);
    controls.set(field.key, { field, mode, value });
  }
}

function renderPreview(state) {
  $("effective").textContent = JSON.stringify(state.provider, null, 2);
  $("sources").replaceChildren();
  for (const [key, source] of Object.entries(state.sources)) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = catalog.fields.find((field) => field.key === key)?.label ?? key;
    const definition = document.createElement("dd");
    definition.textContent = source;
    row.append(term, definition);
    $("sources").append(row);
  }
  $("preview-note").textContent = selection.modelID && selection.modelID !== $("preview-model").value.trim()
    ? "This model override does not apply to the preview model."
    : Object.keys(state.sources).length ? "Each field below shows where its value comes from." : "No explicit preferences. OpenRouter uses its defaults and account policies.";
}

async function preview() {
  const request = ++sequence;
  try {
    const state = await api("preview", inputData(collect()));
    if (request !== sequence) return;
    renderPreview(state);
    showError(null);
  } catch (error) { if (request === sequence) showError(error); }
}

function changed() {
  dirty = true;
  ++sequence;
  $("status").textContent = "Unsaved changes";
  $("save").disabled = false;
  $("preview-note").textContent = "Updating preview…";
  clearTimeout(timer);
  timer = setTimeout(preview, 250);
}

function variants() {
  const previous = $("variant").value;
  $("variant").replaceChildren(new Option("Default", ""));
  const model = catalog.models.find((model) => model.id === $("preview-model").value.trim());
  for (const variant of model?.variants ?? []) $("variant").add(new Option(variant, variant));
  if (model?.variants.includes(previous)) $("variant").value = previous;
}

async function load() {
  const request = ++sequence;
  clearTimeout(timer);
  $("save").disabled = true;
  $("settings").inert = true;
  for (const id of ["scope", "model", "preview-model", "variant"]) $(id).disabled = true;
  $("status").textContent = "Loading…";
  try {
    const state = await api("settings", inputData());
    if (request !== sequence) return;
    dirty = false;
    renderFields(state.patch);
    renderPreview(state);
    $("status").textContent = "Saved settings";
    showError(null);
  } catch (error) { if (request === sequence) { showError(error); $("status").textContent = "Could not load settings"; } }
  finally {
    if (request === sequence) {
      $("settings").inert = false;
      for (const id of ["scope", "model", "preview-model", "variant"]) $(id).disabled = false;
    }
  }
}

for (const id of ["scope", "model"]) $(id).addEventListener("change", async () => {
  if (dirty && !confirm("Discard unsaved settings for this scope and model?")) {
    $("scope").value = selection.scope;
    $("model").value = selection.modelID;
    return;
  }
  selection = { scope: $("scope").value, modelID: $("model").value.trim() };
  if (selection.modelID) { $("preview-model").value = selection.modelID; variants(); }
  await load();
});
$("preview-model").addEventListener("change", () => { variants(); void preview(); });
$("variant").addEventListener("change", () => void preview());
$("reset").addEventListener("click", () => { renderFields({}); changed(); });
$("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(timer);
  ++sequence;
  // Keep the selected layer stable while its save is in flight.
  const inputs = document.querySelectorAll("input, select, textarea, button");
  try {
    const patch = collect();
    inputs.forEach((input) => { input.disabled = true; });
    const state = await api("settings", inputData(patch));
    dirty = false;
    renderPreview(state);
    $("status").textContent = "Saved · applies on the next request";
    showError(null);
  } catch (error) { showError(error); }
  finally {
    inputs.forEach((input) => { input.disabled = false; });
    $("save").disabled = !dirty;
  }
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("effective").textContent); $("copy").textContent = "Copied"; setTimeout(() => { $("copy").textContent = "Copy"; }, 1200); }
  catch (error) { showError(error); }
});
addEventListener("beforeunload", (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });

try {
  catalog = await api(`context${sessionID ? `?sessionID=${encodeURIComponent(sessionID)}` : ""}`);
  $("location").textContent = catalog.directory;
  $("session").textContent = catalog.session ? `Session: ${catalog.session.title ?? catalog.session.id}` : "Open /openrouter from a session to configure session overrides.";
  $("scope").querySelector('[value="session"]').disabled = !catalog.session;
  for (const model of catalog.models) $("models").append(new Option(model.name, model.id));
  const current = catalog.session?.model;
  $("preview-model").value = current?.providerID === "openrouter" ? current.id : catalog.models[0]?.id ?? "";
  variants();
  if (current?.providerID === "openrouter" && current.variant) $("variant").value = current.variant;
  await load();
} catch (error) { showError(error); $("status").textContent = "Could not connect. Reopen /openrouter from OpenCode."; }
