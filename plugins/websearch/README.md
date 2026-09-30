# Web search

Native web search for OpenCode's built-in `websearch` tool, backed by any configured OpenCode provider that speaks the OpenAI, Google, or Anthropic API. Each search is one model request with that API's hosted search tool, so searching, content retrieval, and answer generation happen in a single model call.

## Installation

```sh
opencode plugin add @jiafuei/opencode-websearch
```

Out of the box the built-in `openai`, `google`, and `anthropic` providers are search providers. Each one is offered only while its OpenCode provider is available (connected or explicitly enabled); select it like any other web search provider.

## Options

`providers` maps OpenCode provider IDs, built-in or custom from your config, to a search backend. Entries merge over the defaults, so the built-ins only need the fields you change.

```jsonc
{
  "plugins": [
    {
      "package": "@jiafuei/opencode-websearch",
      "options": {
        "providers": {
          "openai": { "model": "gpt-6-luna", "transport": "websocket" },
          "my-gemini-proxy": { "type": "google", "model": "gemini-3.8-flash" },
          "my-claude-gateway": { "type": "anthropic" }
        }
      }
    }
  ]
}
```

- `type`: search backend. Required for providers other than the built-ins.
  - `openai`: Responses API with the hosted `web_search` tool. Default model `gpt-6-luna`.
  - `google`: Gemini API with [Google Search grounding](https://ai.google.dev/gemini-api/docs/google-search). Default model `gemini-3.8-flash`.
  - `anthropic`: Messages API with the `web_search_20260209` server tool. Default model `claude-opus-5-5`.
- `model`: model used for searches.
- `transport`: `"https"` (default) or `"websocket"` for a persistent WebSocket to the Codex backend. Only affects `openai` entries connected with a ChatGPT subscription.

Each search uses the provider's connected API key (or its `apiKey` setting), `baseURL`, and `headers`, so custom providers pointing at proxies or gateways work as configured.

The built-in `openai` provider also accepts a ChatGPT Pro/Plus subscription, which calls the Codex backend (`https://chatgpt.com/backend-api/codex`) with the account id from the connection. ChatGPT subscriptions only accept Codex-eligible models. Other OAuth connections, such as a Claude subscription, are not supported; use an API key.

For Google Antigravity search, install [`@jiafuei/opencode-antigravity-oauth`](../antigravity-oauth); it registers its own `antigravity` web search provider.

## Results

The synthesized answer is returned on the first result, followed by the remaining cited sources. If nothing was cited, the answer comes back as a single result with an empty `url`. Google sources are `vertexaisearch.cloud.google.com` redirect links whose titles are usually the source domain.

The plugin does not fetch or parse web pages locally.
