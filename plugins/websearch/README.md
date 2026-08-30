# Web search

Provider-native `websearch` for OpenCode. Each backend performs searching, content retrieval, and answer generation in one model request. Included backends use OpenAI's hosted Responses API web search or Antigravity's native Cloud Code Assist `web_search` operation.

## Installation

```sh
opencode plugin @jiafuei/opencode-websearch
```

Connect either an OpenAI ChatGPT subscription or the [`@jiafuei/opencode-antigravity-oauth`](../antigravity-oauth) plugin in OpenCode before using the tool. The Antigravity backend requires both plugins to be installed and a Google Antigravity OAuth login.

## Model selection

The plugin chooses a model in this order:

1. A model on any supported backend marked `"websearch": "always"`.
2. The active model when its provider has a search backend.
3. A model on any supported backend marked `"websearch": "auto"`.

Pin a search backend through one of its provider models:

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

Use the model only when the active provider is unsupported by changing `"always"` to `"auto"`. For Antigravity, use the `google-antigravity` provider and any of its models; the backend dispatches the dedicated `gemini-3.1-flash-lite` search operation captured from the native client.

## Tool

- `websearch`: search the live web and return grounded content with sources.

The plugin does not fetch or parse web pages locally. Search backends are provider-native adapters for OpenAI and Google Antigravity.
