# Web search

Provider-native `websearch` for OpenCode. Each backend performs searching, content retrieval, and answer generation in one model request. The first backend uses OpenAI's hosted Responses API web search with a connected ChatGPT subscription.

## Installation

```sh
opencode plugin @jiafuei/opencode-websearch
```

Connect an OpenAI ChatGPT subscription in OpenCode before using the tool.

## Model selection

The plugin chooses a model in this order:

1. A model on any supported backend marked `"websearch": "always"`.
2. The active model when its provider has a search backend.
3. A model on any supported backend marked `"websearch": "auto"`.

Pin an OpenAI search model:

```json
{
  "provider": {
    "openai": {
      "models": {
        "gpt-5.6-luna": {
          "options": {
            "websearch": "always"
          }
        }
      }
    }
  }
}
```

Use the model only when the active provider is not OpenAI by changing `"always"` to `"auto"`.

## Tool

- `websearch`: search the live web and return grounded content with sources.

The plugin does not fetch or parse web pages locally. Search backends are provider-native adapters; OpenAI is currently the only included backend.
