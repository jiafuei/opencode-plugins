# Web search

OpenAI-native web search provider for OpenCode's built-in `websearch` tool. Each search is one OpenAI Responses API request with the hosted `web_search` tool, so searching, content retrieval, and answer generation happen in a single model call.

## Installation

```sh
opencode plugin add @jiafuei/opencode-websearch
```

Connect the OpenAI integration in OpenCode with an OpenAI API key (or `OPENAI_API_KEY`) or a ChatGPT Pro/Plus subscription. The `OpenAI` web search provider is offered only while an OpenAI connection exists; select it like any other web search provider.

- API keys call `https://api.openai.com/v1/responses`.
- ChatGPT subscriptions call the Codex backend (`https://chatgpt.com/backend-api/codex`) with the account id from the connection.

The synthesized answer is returned on the first result, followed by the remaining cited sources.

For Google Antigravity search, install [`@jiafuei/opencode-antigravity-oauth`](../antigravity-oauth); it registers its own `antigravity` web search provider.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "@jiafuei/opencode-websearch",
      "options": { "model": "gpt-5.6-luna", "openaiSubscriptionTransport": "websocket" }
    }
  ]
}
```

- `model`: OpenAI model used for searches. Defaults to `gpt-5.6-luna`. ChatGPT subscriptions only accept Codex-eligible models.
- `openaiSubscriptionTransport`: `"https"` (default) or `"websocket"` for a persistent WebSocket to the Codex backend. Only affects ChatGPT subscriptions; API-key requests always use HTTPS.

The plugin does not fetch or parse web pages locally.
