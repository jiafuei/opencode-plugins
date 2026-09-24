import { Plugin, type PluginOptions } from "@opencode/plugin";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

// Secrets are stored per session in plugin storage, encrypted with
// AES-256-GCM, a random IV per entry, and a key kept in its own file so a copy
// of the opencode database alone cannot decrypt them. They are removed when
// the session is deleted.
type EncryptedSecret = {
  iv: string;
  tag: string;
  data: string;
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

const READ_LINE = /^(\d+:\s?)(.*)$/;
const GREP_LINE = /^(  Line \d+: )(.*)$/;
const PLACEHOLDER = /<redacted_[0-9a-f]{8}>/g;

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

// Redacts secrets in the text after a tool's line prefix (`12: ` for read,
// `  Line 12: ` for grep); lines without the prefix are left untouched.
function redactLine(line: string, prefixPattern: RegExp, options: CompiledOptions, found: Map<string, string>): string {
  const prefixed = line.match(prefixPattern);
  if (!prefixed) {
    return line;
  }

  let text = prefixed[2]!;
  for (const pattern of options.patterns) {
    for (const matched of [...text.matchAll(pattern)].reverse()) {
      const value = matched[0]!;
      const start = matched.index!;
      const placeholder = `<redacted_${Bun.hash.wyhash(value).toString(16).slice(0, 8)}>`;
      found.set(placeholder, value);
      text = `${text.slice(0, start)}${placeholder}${text.slice(start + value.length)}`;
    }
  }
  return `${prefixed[1]!}${text}`;
}

// Grep output groups matches under a `path:` header line per file; only
// lines under protected files are redacted.
function redactGrepContent(content: string, options: CompiledOptions, found: Map<string, string>): string {
  let protectedFile = false;
  return content
    .split("\n")
    .map((line) => {
      if (line.endsWith(":") && !line.startsWith(" ")) {
        protectedFile = shouldProtectFile(line.slice(0, -1), options);
        return line;
      }
      return protectedFile ? redactLine(line, GREP_LINE, options, found) : line;
    })
    .join("\n");
}

async function loadKey(): Promise<Buffer> {
  const keyPath = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "redact-keys.key");
  await mkdir(dirname(keyPath), { recursive: true, mode: 0o700 });
  await writeFile(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  return readFile(keyPath);
}

function encrypt(key: Buffer, value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decrypt(key: Buffer, secret: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.data, "base64")), decipher.final()]).toString("utf8");
}

export default Plugin.define({
  id: "redact_keys",
  setup: async (ctx) => {
    const compiled = compileOptions(ctx.options);
    const key = await loadKey();
    // Per-session placeholder -> secret cache, backed by encrypted plugin
    // storage so placeholders already in a session's context still restore
    // after a restart or plugin reload.
    const sessions = new Map<string, Map<string, string>>();
    const secretsFor = (sessionID: string) => {
      let secrets = sessions.get(sessionID);
      if (!secrets) sessions.set(sessionID, (secrets = new Map()));
      return secrets;
    };

    const remember = async (sessionID: string, found: Map<string, string>) => {
      const secrets = secretsFor(sessionID);
      for (const [placeholder, value] of found) {
        if (secrets.get(placeholder) === value) continue;
        secrets.set(placeholder, value);
        await ctx.storage.set(`session/${sessionID}/${placeholder}`, encrypt(key, value));
      }
    };

    // Unknown placeholders fail the tool call rather than writing the literal
    // placeholder over a real secret.
    const restorePlaceholders = async (sessionID: string, text: string): Promise<string> => {
      const secrets = secretsFor(sessionID);
      for (const placeholder of new Set(text.match(PLACEHOLDER))) {
        if (secrets.has(placeholder)) continue;
        const stored = await ctx.storage.get(`session/${sessionID}/${placeholder}`);
        if (!stored) throw new Error(`Unknown redaction placeholder ${placeholder}; re-read the file to get a current placeholder`);
        secrets.set(placeholder, decrypt(key, stored as EncryptedSecret));
      }
      return text.replace(PLACEHOLDER, (placeholder) => secrets.get(placeholder)!);
    };

    await ctx.tool.hook("execute.before", async (event) => {
      switch (event.tool) {
        case "write": {
          const input = event.input as WriteInput;
          if (!shouldProtectFile(input.path, compiled)) {
            return;
          }

          input.content = await restorePlaceholders(event.sessionID, input.content);
          return;
        }

        case "edit": {
          const input = event.input as EditInput;
          if (!shouldProtectFile(input.path, compiled)) {
            return;
          }

          input.oldString = await restorePlaceholders(event.sessionID, input.oldString);
          input.newString = await restorePlaceholders(event.sessionID, input.newString);
          return;
        }

        case "patch": {
          const input = event.input as PatchInput;
          input.patchText = await restorePlaceholders(event.sessionID, input.patchText);
        }
      }
    });

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.status !== "completed" || typeof event.result.content !== "string") {
        return;
      }

      const found = new Map<string, string>();
      let content: string;
      if (event.tool === "read") {
        if (!shouldProtectFile((event.input as ReadInput).path, compiled)) {
          return;
        }
        content = event.result.content
          .split("\n")
          .map((line) => redactLine(line, READ_LINE, compiled, found))
          .join("\n");
      } else if (event.tool === "grep") {
        content = redactGrepContent(event.result.content, compiled, found);
      } else {
        return;
      }

      await remember(event.sessionID, found);
      event.result = { ...event.result, content };
    });

    const subscription = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: subscription.signal })) {
        if (event.type !== "session.deleted") continue;
        const sessionID = event.data.sessionID;
        sessions.delete(sessionID);
        let after: string | undefined;
        do {
          const page = await ctx.storage.scan({ prefix: `session/${sessionID}/`, after });
          for (const entry of page.entries) await ctx.storage.remove(entry.key);
          after = page.next;
        } while (after);
      }
    })().catch((error) => {
      if (!subscription.signal.aborted) console.error("Redact keys session cleanup failed:", error);
    });

    return async () => subscription.abort();
  },
});
