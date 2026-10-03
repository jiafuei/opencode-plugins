# @jiafuei/opencode-codex-usage

Shows your ChatGPT plan's Codex usage limits in OpenCode.

## Install

```json
{
  "plugins": ["@jiafuei/opencode-codex-usage"]
}
```

Connect OpenAI with a ChatGPT login (browser or headless), then run `/codex-usage` (or **Codex usage** in the command palette). The dialog shows the plan type and each rate-limit window (for example 5-hour and weekly) as percent used, with reset times.

It sends the Codex CLI's usage request (`GET chatgpt.com/backend-api/wham/usage` with the `chatgpt-account-id` header, per a September 26 capture) using the active OpenAI credential, which OpenCode refreshes when it is close to expiry.
