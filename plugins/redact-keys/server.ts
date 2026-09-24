import { Plugin, type PluginOptions } from "@opencode/plugin";

// Configure the package in `opencode.json` like:
//
// {
//   "plugins": [
//     {
//       "package": "@jiafuei/opencode-redact-keys",
//       "options": {
//         "files": ["**/.env", "**/.config.json", "**/.config.yaml"],
//         "exclude": ["**/.env.example", "**/.env.sample"],
//         "patterns": [
//           "sk-(?:proj-)?[A-Za-z0-9_-]{20,}",
//           "sk-ant-[A-Za-z0-9_-]{20,}",
//           "ghp_[A-Za-z0-9]{36}"
//         ]
//       }
//     }
//   ]
// }

type RedactKeysOptions = {
  files?: string[];
  exclude?: string[];
  patterns?: string[];
};

type CompiledOptions = {
  files: Bun.Glob[];
  exclude: Bun.Glob[];
  patterns: RegExp[];
};

type PlaceholderEntry = {
  value: string;
  filePath: string;
};

type PlaceholderStore = {
  placeholders: Map<string, PlaceholderEntry>;
};

type ReadInput = {
  path: string;
};

type WriteInput = {
  path: string;
  content: string;
};

type EditInput = {
  path: string;
  oldString: string;
  newString: string;
};

type PatchInput = {
  patchText: string;
};

const DEFAULT_FILES = ["**/.env", "**/.config.json", "**/.config.yaml"];
const DEFAULT_EXCLUDE = ["**/.env.example", "**/.env.sample"];
const DEFAULT_PATTERNS = [
  String.raw`sk-(?:proj-)?[A-Za-z0-9_-]{20,}`,
  String.raw`sk-ant-[A-Za-z0-9_-]{20,}`,
  String.raw`sk-or-v1-[A-Za-z0-9_-]{20,}`,
  String.raw`gsk_[A-Za-z0-9_-]{20,}`,
  String.raw`AIza[0-9A-Za-z\-_]{35}`,
  String.raw`AKIA[0-9A-Z]{16}`,
  String.raw`ASIA[0-9A-Z]{16}`,
  String.raw`ghp_[A-Za-z0-9]{36}`,
  String.raw`github_pat_[A-Za-z0-9_]{20,}`,
];

const NUMBERED_LINE = /^(\d+:\s?)(.*)$/;

function createPlaceholderStore(): PlaceholderStore {
  return { placeholders: new Map() };
}

function compileOptions(options?: PluginOptions | RedactKeysOptions): CompiledOptions {
  const source = (options ?? {}) as RedactKeysOptions;
  const filePatterns = source.files?.length ? source.files : DEFAULT_FILES;
  const excludePatterns = source.exclude ?? DEFAULT_EXCLUDE;
  const secretPatterns = source.patterns?.length ? source.patterns : DEFAULT_PATTERNS;

  return {
    files: filePatterns.map((pattern) => new Bun.Glob(pattern)),
    exclude: excludePatterns.map((pattern) => new Bun.Glob(pattern)),
    patterns: secretPatterns.map((pattern) => new RegExp(pattern, "g")),
  };
}

function shouldProtectFile(filePath: string, options: CompiledOptions): boolean {
  const normalizedPath = filePath.replaceAll("\\", "/");
  return (
    options.files.some((glob) => glob.match(normalizedPath)) &&
    !options.exclude.some((glob) => glob.match(normalizedPath))
  );
}

function redactReadContent(
  content: string,
  filePath: string,
  options: CompiledOptions,
  store: PlaceholderStore,
): string {
  return content
    .split("\n")
    .map((line) => {
      const numberedLine = line.match(NUMBERED_LINE);
      if (!numberedLine) {
        return line;
      }

      const prefix = numberedLine[1]!;
      let text = numberedLine[2]!;

      for (const pattern of options.patterns) {
        for (const matched of [...text.matchAll(pattern)].reverse()) {
          const value = matched[0]!;
          const start = matched.index!;

          const placeholder = `<redacted_${Bun.hash.wyhash(value).toString(16).slice(0, 8)}>`;
          store.placeholders.set(placeholder, { value, filePath });
          text = `${text.slice(0, start)}${placeholder}${text.slice(start + value.length)}`;
        }
      }

      return `${prefix}${text}`;
    })
    .join("\n");
}

function restorePlaceholders(text: string, store: PlaceholderStore): string {
  if (store.placeholders.size === 0) {
    return text;
  }

  const tokens = [...store.placeholders.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return text.replace(pattern, (token) => store.placeholders.get(token)!.value);
}

export default Plugin.define({
  id: "redact_keys",
  setup: async (ctx) => {
    const compiled = compileOptions(ctx.options);
    const store = createPlaceholderStore();

    await ctx.tool.hook("execute.before", (event) => {
      switch (event.tool) {
        case "write": {
          const input = event.input as WriteInput;
          if (!shouldProtectFile(input.path, compiled)) {
            return;
          }

          input.content = restorePlaceholders(input.content, store);
          return;
        }

        case "edit": {
          const input = event.input as EditInput;
          if (!shouldProtectFile(input.path, compiled)) {
            return;
          }

          input.oldString = restorePlaceholders(input.oldString, store);
          input.newString = restorePlaceholders(input.newString, store);
          return;
        }

        case "patch": {
          const input = event.input as PatchInput;
          input.patchText = restorePlaceholders(input.patchText, store);
        }
      }
    });

    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool !== "read" || event.status !== "completed" || typeof event.result.content !== "string") {
        return;
      }

      const input = event.input as ReadInput;
      if (!shouldProtectFile(input.path, compiled)) {
        return;
      }

      event.result = { ...event.result, content: redactReadContent(event.result.content, input.path, compiled, store) };
    });
  },
});
