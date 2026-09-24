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

Only models OpenCode reports as available are included; models from providers that are not connected or configured are excluded.

## Installation

Install the package and add it to the global configuration:

```sh
opencode plugin add @jiafuei/opencode-model-glob
```
