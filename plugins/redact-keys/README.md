# Redact keys

Redacts configured secret patterns from protected file reads before their contents reach the model. When the model subsequently writes, edits, or applies a patch containing a generated redaction placeholder, the plugin restores the original secret for the matching file.

## Installation

Install the package for the current project:

```sh
opencode plugin @jiafuei/opencode-redact-keys
```

Pass `--global` to install it globally. To customize the plugin, edit its entry in `opencode.json`:

```json
{
  "plugin": [
    ["@jiafuei/opencode-redact-keys", {
      "files": ["**/.env", "**/.config.json", "**/.config.yaml"],
      "exclude": ["**/.env.example", "**/.env.sample"],
      "patterns": [
        "sk-(?:proj-)?[A-Za-z0-9_-]{20,}",
        "sk-ant-[A-Za-z0-9_-]{20,}",
        "ghp_[A-Za-z0-9]{36}"
      ]
    }]
  ]
}
```

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `files` | `.env`, `.config.json`, `.config.yaml` files | Glob patterns for files whose reads are redacted |
| `exclude` | `.env.example`, `.env.sample` files | Glob patterns excluded from protection |
| `patterns` | Common OpenAI, Anthropic, OpenRouter, Groq, Google, AWS, and GitHub key formats | Regular expressions to redact |

Redactions are stored only for the current plugin process. Restarting OpenCode clears the placeholder mapping.
