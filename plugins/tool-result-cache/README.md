# Tool result cache

Cache explicitly allowed tool results for five minutes within each session and agent. Works with MCP tools and individual calls inside Code Mode.

## Configure

Add this plugin last in your `plugins` array so it can wrap tools registered by earlier plugins:

```jsonc
{
  "plugins": [
    {
      "package": "/path/to/opencode-plugins/plugins/tool-result-cache",
      "options": {
        "allow": ["opencode.models", "docs.search*", "github.get_issue"]
      }
    }
  ]
}
```

`allow` defaults to `[]`, so nothing is cached until you select tools. Patterns accept `*` for any characters and `?` for one character, like OpenCode permissions. Match either the effective tool ID (`github_get_issue`) or its Code Mode path (`github.get_issue`). There is no exclusion list or automatic read-tool detection.

Select tools whose results can be reused for five minutes. Allowed tools are cached whether called directly or through Code Mode.

## Behavior

- Cache keys include the tool, arguments, session, and agent. Object key order does not matter.
- Results expire five minutes after successful completion. Cache hits do not extend the expiry.
- Errors, interrupted calls, and calls requiring permission approval are not cached. Cache hits repeat the original permission checks against current rules.
- Simultaneous cache misses execute independently.
- Overlapping Code Mode calls with permission checks are not cached because OpenCode gives them the same call ID.
- Results live in memory and are discarded when the plugin reloads or the session is deleted.

Run `/clear-tool-result-cache`, or select **Clear tool result cache** in **Ctrl+P**, to clear the current session. Calls already in flight do not refill the cleared cache.
