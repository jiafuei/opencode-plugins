# OpenRouter settings

Manage OpenRouter model exclusions, provider routing, and privacy from OpenCode. The local browser UI has a global model list and a routing editor with an effective-settings preview. Routing settings can be global, per folder, or per model.

## Install

```sh
opencode plugin add @jiafuei/opencode-openrouter
```

Uses your existing OpenCode OpenRouter connection. Open **OpenRouter settings** in the command palette or run `/openrouter`. The plugin starts a loopback-only server on an available port and opens your browser. The launch URL grants access to the settings UI; no OpenRouter credential is sent to the browser. Reopen the command after restarting OpenCode.

Tabs send heartbeats every 30 seconds, even in the background. After five minutes without a heartbeat, the listener stops but saved routing settings and model exclusions still apply. Suspended tabs can time out; run `/openrouter` again to restart the listener.

## Model exclusions

Open **Models** to search by name or ID and filter by status or author. Use each model's **Enabled** checkbox, or select rows and choose **Enable selected** or **Disable selected**. **Select shown** selects the editable results of the current filters. Changing a filter clears the row selection.

Click **Save changes** to apply exclusions globally across projects. The plugin adds ` (disabled - DO NOT USE)` to excluded models' OpenCode display names without changing their IDs or removing them from `ctx.model.list()` or the model picker. The plugin UI keeps the original names.

Before dispatch, session requests using an excluded model fail with `Model is explicitly disabled`. This covers agent turns, subagents, titles, compaction, and session generation. Existing requests are not interrupted, and the plugin does not choose a replacement model. Re-enable the model or switch models to continue.

Models disabled by OpenCode configuration or earlier plugin transforms appear as locked rows. Enabling a model here removes only this plugin's exclusion; it never overrides an external disable. New catalog models follow OpenCode's defaults.

Exclusions persist in plugin storage. Saving refreshes model names in loaded locations in the OpenCode process, including local plugin reloads. Request checks read shared storage on each call. Independent OpenCode processes refresh names when the settings UI reopens or the plugin reloads.

Because excluded models stay in the catalog, OpenCode can still select them automatically as defaults or title models. Those requests fail too.

Direct generation outside a session, such as `ctx.experimental.generate.text`, does not run session hooks and is not blocked by these exclusions. This feature is a local usage preference, not an OpenRouter account policy.

## Routing configuration

Open **Routing & Privacy** and choose **Global** or **This folder**. Leave **Model override** on **All models (defaults)** to edit the scope's defaults, or select a specific OpenRouter model. Use a model row's **Routing** button to open its override. The preview model and variant select which settings to resolve.

Precedence, lowest to highest:

1. Existing outgoing request's `provider` fields.
2. Global defaults, then global model overrides.
3. Exact-folder defaults, then folder model overrides.

Folders do not inherit from ancestor folders. Worktrees have separate folder settings. Each session uses its own current directory for folder settings. Settings persist in OpenCode plugin storage, shared by plugin ID, with separate keys for each scope and model.

Each field supports:

- **Inherit**: leave earlier settings intact.
- **Set / Replace**: replace the field's value, including an entire object or list.
- **Append** (lists): add items, deduplicating while preserving order.
- **Remove**: omit the field from the outgoing `provider` object.

**Inherit all** clears the selected scope/model's overrides when saved. Other scopes remain in effect. Changes apply on the next outgoing request without restarting OpenCode.

## Fields

Supports every field in OpenRouter's [provider-selection guide](https://openrouter.ai/docs/guides/routing/provider-selection): `order`, `only`, `ignore`, `allow_fallbacks`, `require_parameters`, `sort`, `data_collection`, `zdr`, `enforce_distillable_text`, `quantizations`, `preferred_min_throughput`, `preferred_max_latency`, and `max_price`.

Lists accept one slug per line or comma-separated values, including specific endpoint slugs. Sorting, price caps, and performance thresholds use JSON inputs to support their complete object forms. Price caps support `prompt`, `completion`, `request`, `image`, and `audio`.

Settings apply to every session request sent to the `openrouter` provider: agent turns, subagents, titles, compaction, and generation. Plugin calls made outside a session are not covered.

The preview includes configured OpenCode model/variant defaults and unsaved edits, with field provenance. Other plugins' live request changes cannot be predicted by a configuration preview. OpenRouter account policies still apply. No requests, responses, or upstream-provider history are recorded.

The UI is intended for a local OpenCode server.
