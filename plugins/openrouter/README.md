# OpenRouter settings

OpenCode V2 plugin for OpenRouter provider routing and privacy. Includes a local browser UI for configuration and effective-settings previews.

## Install

Add this directory to the global OpenCode configuration to enable it in every folder:

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-plugins/plugins/openrouter"]
}
```

Uses your existing OpenCode OpenRouter connection. Open **OpenRouter settings** in the command palette or run `/openrouter`. The plugin starts a loopback-only server on an available port and opens your browser. The launch URL grants access to the settings UI; no OpenRouter credential is sent to the browser. Reopen the command after restarting OpenCode.

## Configuration

Choose **Global**, **This folder**, or **This session**. Leave **Model override** empty to edit the scope's defaults, or enter an exact OpenCode OpenRouter model ID (for example `anthropic/claude-sonnet-4.5`). Model IDs are suggested from OpenCode's model registry. The preview model and variant select which settings to resolve.

Precedence, lowest to highest:

1. Existing outgoing request's `provider` fields.
2. Global defaults, then global model overrides.
3. Exact-folder defaults, then folder model overrides.
4. Ancestor-session defaults and model overrides, oldest parent first.
5. Current-session defaults, then current-session model overrides.

Folders do not inherit from ancestor folders. Worktrees have separate folder settings. Child sessions inherit parent session overrides live. Each session uses its own current directory for folder settings. Settings persist in OpenCode plugin storage, shared by plugin ID, with separate keys for each scope and model.

Each field supports:

- **Inherit**: leave earlier settings intact.
- **Set / Replace**: replace the field's value, including an entire object or list.
- **Append** (lists): add items, deduplicating while preserving order.
- **Remove**: omit the field from the outgoing `provider` object.

**Inherit all** clears the selected scope/model's overrides when saved. Other scopes remain in effect. Changes apply on the next outgoing request without restarting OpenCode.

## Fields

Supports every field in OpenRouter's [provider-selection guide](https://openrouter.ai/docs/guides/routing/provider-selection): `order`, `only`, `ignore`, `allow_fallbacks`, `require_parameters`, `sort`, `data_collection`, `zdr`, `enforce_distillable_text`, `quantizations`, `preferred_min_throughput`, `preferred_max_latency`, and `max_price`.

Lists accept one slug per line or comma-separated values, including specific endpoint slugs. Sorting, price caps, and performance thresholds use JSON inputs to support their complete object forms. Price caps support `prompt`, `completion`, `request`, `image`, and `audio`.

The native HTTP request hook is scoped to OpenCode provider ID `openrouter`. It transforms requests for all session request kinds: main agent/tool continuations, subagents, titles, compaction, and transient session generation. It preserves authentication, messages, and other request fields. Standalone `ctx.generate.text` calls outside sessions do not expose session HTTP hooks.

The preview includes configured OpenCode model/variant defaults and unsaved edits, with field provenance. Other plugins' live request changes cannot be predicted by a configuration preview. OpenRouter account policies still apply. No requests, responses, or upstream-provider history are recorded.

The UI is intended for a local OpenCode server. Only the server plugin and its TUI entrypoint are required; there is no separate frontend build or web framework.
