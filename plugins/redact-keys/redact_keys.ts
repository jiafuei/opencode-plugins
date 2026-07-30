import type { Plugin, PluginOptions } from "@opencode-ai/plugin";

// Configure the package in `opencode.json` like:
//
// {
//   "plugin": [
//     ["@jiafuei/opencode-redact-keys", {
//       "files": ["**/.env", "**/.config.json", "**/.config.yaml"],
//       "exclude": ["**/.env.example", "**/.env.sample"],
//       "patterns": [
//         "sk-(?:proj-)?[A-Za-z0-9_-]{20,}",
//         "sk-ant-[A-Za-z0-9_-]{20,}",
//         "ghp_[A-Za-z0-9]{36}"
//       ]
//     }]
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

type ReadArgs = {
  filePath: string;
};

type WriteArgs = {
  filePath: string;
  content: string;
};

type EditArgs = {
  filePath: string;
  oldString: string;
  newString: string;
};

type ApplyPatchArgs = {
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

const CONTENT_BLOCK = /<content>\n([\s\S]*?)\n<\/content>/;
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

function redactReadOutput(
  output: string,
  filePath: string,
  options: CompiledOptions,
  store: PlaceholderStore,
): string {
  const contentMatch = output.match(CONTENT_BLOCK);
  if (!contentMatch) {
    return output;
  }

  const originalContent = contentMatch[1]!;
  const redactedContent = originalContent
    .split("\n")
    .map((line) => {
      const numberedLine = line.match(NUMBERED_LINE);
      if (!numberedLine) {
        return line;
      }

      const prefix = numberedLine[1]!;
      let content = numberedLine[2]!;

      for (const pattern of options.patterns) {
        for (const matched of [...content.matchAll(pattern)].reverse()) {
          const value = matched[0]!;
          const start = matched.index!;

          const placeholder = `<redacted_${Bun.hash.wyhash(value).toString(16).slice(0, 8)}>`;
          store.placeholders.set(placeholder, { value, filePath });
          content = `${content.slice(0, start)}${placeholder}${content.slice(start + value.length)}`;
        }
      }

      return `${prefix}${content}`;
    })
    .join("\n");

  return redactedContent === originalContent ? output : output.replace(originalContent, redactedContent);
}

function restorePlaceholders(text: string, store: PlaceholderStore): string {
  if (store.placeholders.size === 0) {
    return text;
  }

  const tokens = [...store.placeholders.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  return text.replace(pattern, (token) => store.placeholders.get(token)!.value);
}

const RedactKeysPlugin: Plugin = async (_input, options) => {
  const compiled = compileOptions(options);
  const store = createPlaceholderStore();

  return {
    "tool.execute.before": async (input, output) => {
      switch (input.tool) {
        case "write": {
          const args = output.args as WriteArgs;
          if (!shouldProtectFile(args.filePath, compiled)) {
            return;
          }

          args.content = restorePlaceholders(args.content, store);
          return;
        }

        case "edit": {
          const args = output.args as EditArgs;
          if (!shouldProtectFile(args.filePath, compiled)) {
            return;
          }

          args.oldString = restorePlaceholders(args.oldString, store);
          args.newString = restorePlaceholders(args.newString, store);
          return;
        }

        case "apply_patch": {
          const args = output.args as ApplyPatchArgs;
          args.patchText = restorePlaceholders(args.patchText, store);
        }
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "read") {
        return;
      }

      const args = input.args as ReadArgs;
      if (!shouldProtectFile(args.filePath, compiled)) {
        return;
      }

      output.output = redactReadOutput(output.output, args.filePath, compiled, store);
    },
  };
};

export default {
  id: "redact_keys",
  server: RedactKeysPlugin,
};
