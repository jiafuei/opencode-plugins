# Model glob

Exposes a `model_glob` tool that searches model IDs from providers currently connected to OpenCode and returns each matching model's available variants.

## Tool

The tool accepts a non-empty, case-insensitive substring:

```json
{
  "text": "5.6"
}
```

It returns a JSON array sorted by model ID:

```json
[
  {"id":"openai/gpt-5.6-sol","variants":["low","medium","high"]}
]
```

Models from providers that are not authenticated or configured are excluded.

## Installation

Install the package for the current project:

```sh
opencode plugin @jiafuei/opencode-model-glob
```

Pass `--global` to install it globally.
