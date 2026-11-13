const $ = (id) => document.getElementById(id);
let catalog;
let dirty = false;
let sequence = 0;
let timer;
let selection = { scope: "global", modelID: "" };
const controls = new Map();
let savedDisabled = new Set();
let disabledModels = new Set();
const selectedModels = new Set();
let modelsDirty = false;

function tab(name, focusTab = false) {
  for (const id of ["models", "routing"]) {
    const active = id === name;
    $(`${id}-panel`).hidden = !active;
    const el = $(`${id}-tab`);
    el.setAttribute("aria-selected", String(active));
    el.tabIndex = active ? 0 : -1;
    if (active && focusTab) el.focus();
  }
}
$("models-tab").addEventListener("click", () => tab("models"));
$("routing-tab").addEventListener("click", () => tab("routing"));
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  const keys = { ArrowLeft: "models", ArrowRight: "routing", Home: "models", End: "routing" };
  const target = event.key === "ArrowLeft" || event.key === "ArrowRight"
    ? (document.activeElement.id === "models-tab" ? "routing" : "models")
    : keys[event.key];
  if (!target) return;
  event.preventDefault();
  tab(target, true);
});

function confirmDiscard(message) {
  const dialog = $("confirm-dialog");
  $("confirm-message").textContent = message;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "discard"), { once: true });
  });
}

function filteredModels() {
  const search = $("model-search").value.trim().toLowerCase();
  const filter = $("model-filter").value;
  const author = $("model-author").value;
  return catalog.models.filter((model) => {
    const disabled = !model.available || disabledModels.has(model.id);
    return `${model.name} ${model.id}`.toLowerCase().includes(search)
      && (!author || model.id.split("/")[0] === author)
      && (filter === "all" || (filter === "disabled" ? disabled : !disabled));
  });
}

function updateModelSummary() {
  const visible = filteredModels();
  const selectable = visible.filter((model) => model.available);
  const selectedVisible = selectable.filter((model) => selectedModels.has(model.id)).length;
  $("select-models").checked = selectable.length > 0 && selectedVisible === selectable.length;
  $("select-models").indeterminate = selectedVisible > 0 && selectedVisible < selectable.length;
  $("select-models").disabled = !selectable.length;
  $("model-selection").textContent = `${selectedModels.size} selected`;
  $("enable-models").disabled = !selectedModels.size;
  $("disable-models").disabled = !selectedModels.size;
  const disabled = catalog.models.filter((model) => !model.available || disabledModels.has(model.id)).length;
  $("model-count").textContent = `${visible.length} of ${catalog.models.length} shown · ${catalog.models.length - disabled} enabled · ${disabled} disabled`;
  modelsDirty = disabledModels.size !== savedDisabled.size || [...disabledModels].some((id) => !savedDisabled.has(id));
  $("model-status").textContent = modelsDirty ? "Unsaved changes · global exclusions" : "Saved · global exclusions";
  $("save-models").disabled = !modelsDirty;
}

function renderEmptyModels() {
  const empty = document.createElement("li");
  empty.className = "model-empty";
  empty.textContent = catalog.models.length ? "No models match these filters." : "No OpenRouter models found. Check your OpenRouter connection in OpenCode.";
  $("model-list").replaceChildren(empty);
}

function renderModels() {
  const visible = filteredModels();
  $("model-list").replaceChildren();
  for (const model of visible) {
    const row = document.createElement("li");
    row.className = "model-row";
    row.dataset.id = model.id;
    const select = document.createElement("input");
    select.type = "checkbox";
    select.checked = selectedModels.has(model.id);
    select.disabled = !model.available;
    select.setAttribute("aria-label", `Select ${model.name} (${model.id})`);
    select.addEventListener("change", () => {
      if (select.checked) selectedModels.add(model.id);
      else selectedModels.delete(model.id);
      updateModelSummary();
    });
    const info = document.createElement("div");
    info.className = "model-info";
    const name = document.createElement("strong");
    name.textContent = model.name;
    const id = document.createElement("code");
    id.textContent = model.id;
    info.append(name, id);
    if (!model.available) {
      const badges = document.createElement("div");
      badges.className = "model-badges";
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Disabled by OpenCode configuration or another plugin";
      badges.append(badge);
      info.append(badges);
    }
    const toggle = document.createElement("label");
    toggle.className = "model-toggle";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.setAttribute("role", "switch");
    enabled.checked = model.available && !disabledModels.has(model.id);
    enabled.disabled = !model.available;
    enabled.setAttribute("aria-label", `Enable ${model.name} (${model.id})`);
    const state = document.createElement("span");
    state.setAttribute("aria-hidden", "true");
    state.textContent = enabled.checked ? "Enabled" : "Disabled";
    enabled.addEventListener("change", () => {
      if (enabled.checked) disabledModels.delete(model.id);
      else disabledModels.add(model.id);
      state.textContent = enabled.checked ? "Enabled" : "Disabled";
      if ($("model-filter").value !== "all") {
        const nextFocus = row.nextElementSibling?.querySelector(".model-toggle input")
          ?? row.previousElementSibling?.querySelector(".model-toggle input")
          ?? $("model-filter");
        selectedModels.delete(model.id);
        row.remove();
        if (!$("model-list").children.length) renderEmptyModels();
        nextFocus.focus({ preventScroll: true });
      }
      updateModelSummary();
    });
    toggle.append(enabled, state);
    const routing = document.createElement("button");
    routing.type = "button";
    routing.className = "quiet model-route";
    routing.textContent = "Routing →";
    routing.setAttribute("aria-label", `Routing settings for ${model.name} (${model.id})`);
    routing.addEventListener("click", async () => {
      if (dirty && !(await confirmDiscard("Discard unsaved routing settings?"))) return;
      const previous = selection;
      const previousPreview = $("preview-model").value;
      $("model").value = model.id;
      $("preview-model").value = model.id;
      selection = { scope: $("scope").value, modelID: model.id };
      variants();
      tab("routing");
      if (!(await load())) {
        selection = previous;
        $("model").value = previous.modelID;
        $("preview-model").value = previousPreview;
        variants();
        return;
      }
      ($("fields").querySelector("select, input, textarea") ?? $("scope")).focus();
    });
    row.append(select, info, toggle, routing);
    $("model-list").append(row);
  }
  if (!visible.length) renderEmptyModels();
  updateModelSummary();
}

$("select-models").addEventListener("change", (event) => {
  const checked = event.target.checked;
  for (const row of $("model-list").children) {
    const id = row.dataset.id;
    const box = row.firstElementChild;
    if (!id || box.disabled) continue;
    box.checked = checked;
    if (checked) selectedModels.add(id);
    else selectedModels.delete(id);
  }
  updateModelSummary();
});
for (const id of ["model-search", "model-filter", "model-author"]) {
  $(id).addEventListener(id === "model-search" ? "input" : "change", () => {
    selectedModels.clear();
    renderModels();
  });
}
for (const action of ["enable", "disable"]) {
  $(`${action}-models`).addEventListener("click", () => {
    for (const id of selectedModels) {
      if (action === "enable") disabledModels.delete(id);
      else disabledModels.add(id);
    }
    if ($("model-filter").value !== "all") {
      selectedModels.clear();
      renderModels();
      return;
    }
    for (const row of $("model-list").children) {
      const id = row.dataset.id;
      if (!id || !selectedModels.has(id)) continue;
      const box = row.querySelector(".model-toggle input");
      const state = row.querySelector(".model-toggle span");
      box.checked = action === "enable";
      state.textContent = box.checked ? "Enabled" : "Disabled";
    }
    updateModelSummary();
  });
}
$("save-models").addEventListener("click", async () => {
  $("models-panel").inert = true;
  $("model-status").textContent = "Saving…";
  try {
    const state = await api("models", { disabled: [...disabledModels] });
    catalog.models = state.models;
    savedDisabled = new Set(state.disabled);
    disabledModels = new Set(state.disabled);
    syncCatalogOptions();
    renderModels();
    showError(null);
  } catch (error) {
    showError(error);
    $("model-status").textContent = "Could not save · changes kept";
  } finally {
    $("models-panel").inert = false;
    ($("save-models").disabled ? $("models-title") : $("save-models")).focus();
  }
});

async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || response.statusText }; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(error) {
  $("error").textContent = error?.message ?? "";
  $("error").hidden = !error;
}

function heartbeat() {
  api("heartbeat", {}).catch(() => {
    clearInterval(heartbeatTimer);
    showError(new Error("Settings disconnected. Reopen them with /openrouter."));
  });
}
const heartbeatTimer = setInterval(heartbeat, 30_000);
heartbeat();

function syncCatalogOptions() {
  const selectedAuthor = $("model-author").value;
  const selectedModel = $("model").value;
  const selectedPreview = $("preview-model").value;
  $("model-author").replaceChildren(new Option("All authors", ""));
  for (const author of [...new Set(catalog.models.map((model) => model.id.split("/")[0]))].sort()) {
    $("model-author").add(new Option(author, author));
  }
  $("model-author").value = [...$("model-author").options].some((o) => o.value === selectedAuthor) ? selectedAuthor : "";
  $("model").replaceChildren(
    new Option("All models (defaults)", ""),
    ...catalog.models.map((model) => new Option(`${model.name} (${model.id})`, model.id)),
  );
  $("model").value = [...$("model").options].some((o) => o.value === selectedModel) ? selectedModel : "";
  $("preview-model").replaceChildren(
    ...catalog.models.map((model) => new Option(`${model.name} (${model.id})`, model.id)),
  );
  $("preview-model").value = [...$("preview-model").options].some((o) => o.value === selectedPreview)
    ? selectedPreview
    : (catalog.models[0]?.id ?? "");
}

function inputData(patch) {
  return { ...selection, previewModelID: $("preview-model").value, variant: $("variant").value, patch };
}

function numberInput(labelText, key, initial) {
  const wrap = document.createElement("label");
  wrap.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.min = "0";
  input.dataset.part = key;
  if (initial !== undefined) input.value = String(initial);
  wrap.append(input);
  return { wrap, input };
}

function collect() {
  const patch = {};
  for (const [key, { mode, field, read }] of controls) {
    if (mode.value === "inherit") continue;
    if (mode.value === "remove") { patch[key] = { mode: "remove" }; continue; }
    patch[key] = { mode: mode.value, value: read() };
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
    const structured = field.type === "sort" || field.type === "threshold" || field.type === "price";
    const label = document.createElement(structured ? "span" : "label");
    if (structured) {
      label.id = `${field.key}-label`;
      label.className = "field-title";
    } else {
      label.htmlFor = `${field.key}-value`;
    }
    const code = document.createElement("code");
    code.textContent = field.key;
    label.append(`${field.label} `, code);
    const mode = document.createElement("select");
    mode.setAttribute("aria-label", `${field.label} override mode`);
    mode.setAttribute("aria-describedby", `${field.key}-hint`);
    const modes = [["inherit", "Inherit"], ["set", field.type === "list" ? "Replace" : "Set"], ...(field.type === "list" ? [["append", "Append"]] : []), ["remove", "Remove"]];
    for (const [id, text] of modes) mode.add(new Option(text, id));
    mode.value = patch[field.key]?.mode ?? "inherit";
    const configured = patch[field.key]?.value;

    let valueEl;
    let read;
    if (field.type === "sort") {
      const box = document.createElement("div");
      box.className = "value subgrid";
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", `${field.key}-label`);
      const byWrap = document.createElement("label");
      byWrap.textContent = "Sort by";
      const by = document.createElement("select");
      for (const [id, text] of [["price", "Price"], ["throughput", "Throughput"], ["latency", "Latency"]]) by.add(new Option(text, id));
      by.value = typeof configured === "string" ? configured : configured?.by ?? "price";
      byWrap.append(by);
      const partWrap = document.createElement("label");
      partWrap.textContent = "Partition";
      const partition = document.createElement("select");
      for (const [id, text] of [["", "Default"], ["model", "Model"], ["none", "None"]]) partition.add(new Option(text, id));
      partition.value = typeof configured === "object" && configured ? configured.partition ?? "" : "";
      partWrap.append(partition);
      box.append(byWrap, partWrap);
      by.addEventListener("change", changed);
      partition.addEventListener("change", changed);
      valueEl = box;
      read = () => (partition.value ? { by: by.value, partition: partition.value } : by.value);
    } else if (field.type === "threshold") {
      const box = document.createElement("div");
      box.className = "value subgrid";
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", `${field.key}-label`);
      const scalar = numberInput("Value", "scalar", typeof configured === "number" ? configured : undefined);
      const percentiles = ["p50", "p75", "p90", "p99"].map((p) => {
        const item = numberInput(p, p, typeof configured === "object" && configured ? configured[p] : undefined);
        item.input.addEventListener("input", () => { if (item.input.value !== "") scalar.input.value = ""; changed(); });
        return [p, item];
      });
      scalar.input.addEventListener("input", () => {
        if (scalar.input.value !== "") for (const [, item] of percentiles) item.input.value = "";
        changed();
      });
      box.append(scalar.wrap, ...percentiles.map(([, item]) => item.wrap));
      valueEl = box;
      read = () => {
        if (scalar.input.value !== "") {
          const n = Number(scalar.input.value);
          if (!Number.isFinite(n)) throw new Error(`${field.label}: enter a valid number.`);
          return n;
        }
        const obj = {};
        for (const [p, item] of percentiles) {
          if (item.input.value === "") continue;
          const n = Number(item.input.value);
          if (!Number.isFinite(n)) throw new Error(`${field.label} (${p}): enter a valid number.`);
          obj[p] = n;
        }
        if (!Object.keys(obj).length) throw new Error(`${field.label}: enter a value or percentile.`);
        return obj;
      };
    } else if (field.type === "price") {
      const box = document.createElement("div");
      box.className = "value subgrid";
      box.setAttribute("role", "group");
      box.setAttribute("aria-labelledby", `${field.key}-label`);
      const items = [
        ["prompt", "Prompt / 1M"],
        ["completion", "Completion / 1M"],
        ["request", "Request"],
        ["image", "Image"],
        ["audio", "Audio"],
      ].map(([k, text]) => {
        const item = numberInput(text, k, configured?.[k]);
        item.input.addEventListener("input", changed);
        box.append(item.wrap);
        return [k, item];
      });
      valueEl = box;
      read = () => {
        const obj = {};
        for (const [k, item] of items) {
          if (item.input.value === "") continue;
          const n = Number(item.input.value);
          if (!Number.isFinite(n)) throw new Error(`${field.label} (${k}): enter a valid number.`);
          obj[k] = n;
        }
        return obj;
      };
    } else {
      const input = document.createElement(field.type === "boolean" || field.type === "enum" ? "select" : "textarea");
      input.id = `${field.key}-value`;
      input.className = "value";
      input.setAttribute("aria-describedby", `${field.key}-hint`);
      if (field.type === "boolean") { input.add(new Option("Enabled", "true")); input.add(new Option("Disabled", "false")); }
      if (field.type === "enum") { input.add(new Option("Deny", "deny")); input.add(new Option("Allow", "allow")); }
      if (configured !== undefined) input.value = field.type === "list" ? configured.join("\n") : String(configured);
      input.addEventListener("input", changed);
      valueEl = input;
      read = () => field.type === "list"
        ? input.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean)
        : field.type === "boolean" ? input.value === "true" : input.value;
    }

    const hint = document.createElement("p");
    hint.id = `${field.key}-hint`;
    hint.className = "help";
    hint.textContent = field.hint;
    valueEl.hidden = mode.value === "inherit" || mode.value === "remove";
    mode.addEventListener("change", () => { valueEl.hidden = mode.value === "inherit" || mode.value === "remove"; changed(); });
    top.append(label, mode);
    row.append(top, valueEl, hint);
    group.append(row);
    controls.set(field.key, { field, mode, read });
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
  $("preview-note").textContent = selection.modelID && selection.modelID !== $("preview-model").value
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
  } catch (error) {
    if (request === sequence) {
      showError(error);
      $("preview-note").textContent = "Preview paused until input is valid.";
    }
  }
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
  const model = catalog.models.find((model) => model.id === $("preview-model").value);
  for (const variant of model?.variants ?? []) $("variant").add(new Option(variant, variant));
  if (model?.variants.includes(previous)) $("variant").value = previous;
}

async function load() {
  const request = ++sequence;
  clearTimeout(timer);
  $("save").disabled = true;
  $("settings").inert = true;
  $("status").textContent = "Loading…";
  try {
    const state = await api("settings", inputData());
    if (request !== sequence) return false;
    dirty = false;
    renderFields(state.patch);
    renderPreview(state);
    $("status").textContent = "Saved settings";
    showError(null);
    return true;
  } catch (error) {
    if (request === sequence) { showError(error); $("status").textContent = "Could not load settings"; }
    return false;
  } finally {
    if (request === sequence) $("settings").inert = false;
  }
}

for (const id of ["scope", "model"]) $(id).addEventListener("change", async () => {
  const next = { scope: $("scope").value, modelID: $("model").value };
  if (dirty && !(await confirmDiscard("Discard unsaved settings for this scope and model?"))) {
    $("scope").value = selection.scope;
    $("model").value = selection.modelID;
    return;
  }
  const previous = selection;
  const previousPreview = $("preview-model").value;
  selection = next;
  if (selection.modelID) { $("preview-model").value = selection.modelID; variants(); }
  if (!(await load())) {
    selection = previous;
    $("scope").value = previous.scope;
    $("model").value = previous.modelID;
    $("preview-model").value = previousPreview;
    variants();
  }
});
$("preview-model").addEventListener("change", () => { variants(); void preview(); });
$("variant").addEventListener("change", () => void preview());
$("reset").addEventListener("click", () => { renderFields({}); changed(); });
$("settings").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(timer);
  ++sequence;
  const prevFocus = document.activeElement;
  // Keep the selected layer stable while its save is in flight.
  const inputs = $("routing-panel").querySelectorAll("input, select, textarea, button");
  $("status").textContent = "Saving…";
  try {
    const patch = collect();
    inputs.forEach((input) => { input.disabled = true; });
    const state = await api("settings", inputData(patch));
    dirty = false;
    renderPreview(state);
    $("status").textContent = "Saved · applies on the next request";
    showError(null);
  } catch (error) {
    showError(error);
    $("status").textContent = "Could not save · changes kept";
  } finally {
    inputs.forEach((input) => { input.disabled = false; });
    $("save").disabled = !dirty;
    (prevFocus?.isConnected && !prevFocus.disabled ? prevFocus : $("routing-title")).focus();
  }
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("effective").textContent);
    $("copy").textContent = "Copied";
    $("copy-status").textContent = "Copied to clipboard";
    setTimeout(() => { $("copy").textContent = "Copy"; $("copy-status").textContent = ""; }, 2000);
  } catch (error) { showError(error); }
});
addEventListener("beforeunload", (event) => { if (dirty || modelsDirty) { event.preventDefault(); event.returnValue = ""; } });

try {
  catalog = await api("context");
  savedDisabled = new Set(catalog.disabled);
  disabledModels = new Set(catalog.disabled);
  syncCatalogOptions();
  renderModels();
  $("model-list").setAttribute("aria-busy", "false");
  $("models-panel").inert = false;
  $("routing-panel").inert = false;
  $("location").textContent = catalog.directory;
  variants();
  await load();
} catch (error) {
  showError(error);
  $("model-list").setAttribute("aria-busy", "false");
  $("model-count").textContent = "Could not connect";
  $("model-status").textContent = "Could not connect. Reopen /openrouter from OpenCode.";
  $("status").textContent = "Could not connect. Reopen /openrouter from OpenCode.";
}
