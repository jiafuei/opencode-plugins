import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// For manual configuration, add the package to `tui.json`:
//
// {
//   "plugin": ["@jiafuei/opencode-memory"]
// }

type Choice =
  | { type: "toggle"; enabled: boolean }
  | { type: "folder" }
  | { type: "file"; name: string };

const INDEX_FILE = "index.md";
const SETTINGS_FILE = "settings.json";

export function memoryProjectKey(directory: string): string {
  const resolvedDirectory = resolve(directory);
  return `${resolvedDirectory.toLowerCase().replace(/[^a-z._-]/g, "-")}-${Bun.hash.wyhash(resolvedDirectory).toString(16).padStart(8, "0").slice(0, 8)}`;
}

function projectDirectory(directory: string): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "memory", memoryProjectKey(directory));
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, content);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function readEnabled(directory: string): Promise<boolean> {
  const file = Bun.file(join(directory, SETTINGS_FILE));
  if (!(await file.exists())) return true;
  try {
    return (await file.json() as { enabled?: boolean }).enabled !== false;
  } catch {
    return true;
  }
}

async function openInEditor(api: TuiPluginApi, target: string, cwd: string): Promise<void> {
  const editor = process.env.VISUAL ?? process.env.EDITOR;
  if (!editor) {
    api.ui.toast({ variant: "warning", title: "Memory", message: "Set VISUAL or EDITOR to open memory files" });
    return;
  }

  api.ui.dialog.clear();
  api.renderer.suspend();
  api.renderer.currentRenderBuffer.clear();
  try {
    const command = editor.split(" ").filter(Boolean);
    const child = Bun.spawn([...command, target], {
      cwd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) throw new Error(`Editor exited with code ${exitCode}`);
  } finally {
    api.renderer.currentRenderBuffer.clear();
    api.renderer.resume();
    api.renderer.requestRender();
  }
}

async function showMemory(api: TuiPluginApi): Promise<void> {
  try {
    const directory = projectDirectory(api.state.path.directory);
    await mkdir(directory, { recursive: true });

    const enabled = await readEnabled(directory);
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".md") && file !== INDEX_FILE)
      .sort((left, right) => left.localeCompare(right));

    const choices: Array<{ title: string; description: string; value: Choice }> = [
      {
        title: `Auto-memory: ${enabled ? "enabled" : "disabled"}`,
        description: enabled ? "Disable recall and learning" : "Enable recall and learning",
        value: { type: "toggle", enabled },
      },
      {
        title: "Open memory folder",
        description: directory,
        value: { type: "folder" },
      },
      {
        title: INDEX_FILE,
        description: "Project memory index",
        value: { type: "file", name: INDEX_FILE },
      },
      ...files.map((name) => ({
        title: name,
        description: "Memory topic",
        value: { type: "file" as const, name },
      })),
    ];

    api.ui.dialog.replace(() => api.ui.DialogSelect<Choice>({
      title: "Project memory",
      placeholder: "Search memory",
      options: choices,
      onSelect: (option) => {
        void (async () => {
          if (option.value.type === "toggle") {
            await atomicWrite(join(directory, SETTINGS_FILE), `${JSON.stringify({ enabled: !option.value.enabled }, null, 2)}\n`);
            await showMemory(api);
            return;
          }
          const target = option.value.type === "folder" ? directory : join(directory, option.value.name);
          await openInEditor(api, target, directory);
        })().catch((error) => {
          api.ui.toast({
            variant: "error",
            title: "Memory",
            message: error instanceof Error ? error.message : String(error),
          });
        });
      },
    }));
  } catch (error) {
    api.ui.toast({
      variant: "error",
      title: "Memory",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const MemoryTuiPlugin: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [{
      name: "memory.open",
      title: "Project memory",
      category: "Project",
      namespace: "palette",
      slashName: "memory",
      run() {
        void showMemory(api);
      },
    }],
    bindings: [],
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "memory",
  tui: MemoryTuiPlugin,
};

export default plugin;
