# Redact keys

Redacts configured secret patterns from protected file reads before their contents reach the model. When the model subsequently writes, edits, or patches a file containing a generated redaction placeholder, the plugin restores the original secret for the matching file.

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

Redactions are stored only for the current plugin process. Restarting OpenCode clears the placeholder mapping.
