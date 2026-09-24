# Redact keys

Redacts configured secret patterns from protected file reads, and from `grep` matches in protected files, before their contents reach the model. When the model subsequently writes, edits, or patches a file containing a generated redaction placeholder, the plugin restores the original secret for the matching file.

## Installation

Install the package and add it to the global configuration:

```sh
opencode plugin add @jiafuei/opencode-redact-keys
```

To customize the plugin, replace its entry in the `plugins` array of `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "@jiafuei/opencode-redact-keys",
      "options": {
        "files": ["**/.env", "**/.config.json", "**/.config.yaml"],
        "exclude": ["**/.env.example", "**/.env.sample"],
        "patterns": [
          "sk-(?:proj-)?[A-Za-z0-9_-]{20,}",
          "sk-ant-[A-Za-z0-9_-]{20,}",
          "ghp_[A-Za-z0-9]{36}"
        ]
      }
    }
  ]
}
```

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `files` | `.env`, `.config.json`, `.config.yaml` files | Glob patterns for files whose reads are redacted |
| `exclude` | `.env.example`, `.env.sample` files | Glob patterns excluded from protection |
| `patterns` | Common OpenAI, Anthropic, OpenRouter, Groq, Google, AWS, and GitHub key formats | Regular expressions to redact |

Each session's placeholder mapping is stored in plugin storage, encrypted with AES-256-GCM (random IV per entry). The key lives in `${XDG_DATA_HOME:-~/.local/share}/opencode/redact-keys.key` (mode `0600`), separate from the OpenCode database. Mappings survive restarts and plugin reloads and are deleted when the session is deleted.

A placeholder the session never produced (or whose mapping is gone) fails the write, edit, or patch instead of writing the placeholder text; re-read the file to get a current placeholder. Shell commands such as `cat .env` are not redacted.
