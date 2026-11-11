# Sleep

A cancellable sleep tool for OpenCode Code Mode.

## Load the plugin

Add the local plugin directory to `plugins` in your OpenCode configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-plugins/plugins/sleep"]
}
```

## Usage

Discover the tool with `search({ query: "sleep" })`, then call it inside `execute`:

```js
return await tools.sleep({ ms: 1000 });
```

The tool returns `{ ms: 1000 }` after waiting. `ms` is the requested duration, not measured elapsed time. Cancelling the tool aborts the timer.
