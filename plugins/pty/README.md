# PTY

Interactive terminal tools for OpenCode agents. Run a REPL, installer, debugger, or terminal application, then send input and read its screen across tool calls.

The plugin owns a separate `opencode-pty` daemon. It does not attach to your terminal or OpenCode's built-in terminal panes. Programs still have the service user's filesystem and process permissions. This is not a sandbox.

## Load the plugin

Requirements:

- OpenCode 2.0.32 or newer, running on Bun.
- Linux, macOS, or Windows on x64 or arm64. Windows uses ConPTY and Windows PowerShell.

Run `bun install` from this repository. Add the local package to `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-plugins/plugins/pty"]
}
```

This package is not published. Loading it registers tools but does not start a daemon. The first approved `pty.start` call starts the daemon on the machine running the OpenCode service.

## Control an interactive program

Discover the tools with `search({ namespace: "pty" })` in Code Mode. The examples below run inside `execute`.

Start Python and wait for its prompt:

```js
return await tools.pty.start({ command: "python3", until: ">>>" });
```

Use the returned `id` in later calls. Send text and then press Enter:

```js
return await tools.pty.send({
  id: 1,
  text: "print('result:', 1 + 1)",
  keys: ["Enter"],
  until: "result: 2",
});
```

Read the current screen without waiting:

```js
return await tools.pty.read({ id: 1, timeoutMs: 0 });
```

Send `keys: ["Ctrl+C"]` to interrupt a foreground program. Use `pty.close({ id: 1 })` to terminate the terminal and discard its retained output.

## Tool reference

All terminal IDs are private to the calling OpenCode session. Child sessions cannot access their parent's terminals.

| Tool | Input | Result |
| --- | --- | --- |
| `start` | `command`, optional `cwd`, `env`, `until`, `timeoutMs` | Screen view with the new terminal ID |
| `send` | `id`, `text`, `keys`, optional `until`, `timeoutMs` | Screen view after input; supply text, keys, or both |
| `read` | `id`, optional `lines`, `until`, `timeoutMs` | Screen view without input |
| `list` | `{}` | This session's terminals, including exited programs |
| `close` | `id` | `{ closed: id }` |

### Starting programs

On Linux and macOS, `command` runs through `$SHELL -lc`, or `/bin/sh -lc` when `SHELL` is unset. Shell startup files can affect execution. On Windows, it runs through `powershell.exe -NoLogo -NoProfile -Command`, so command strings use PowerShell syntax. Relative `cwd` values resolve from the plugin's location directory; omitting `cwd` uses that directory.

`env` overrides the daemon's inherited environment. The daemon sets `TERM=xterm-256color` and `COLORTERM=truecolor`. Every terminal is fixed at **300 columns by 60 rows**. There is no resize tool.

### Input and keys

`text` is written exactly as supplied. `keys` are appended in order. Use `keys: ["Enter"]` to submit a line rather than adding a newline to `text`.

Supported key names:

- `Enter`, `Tab`, `Backspace`, `Escape`
- `Up`, `Down`, `Left`, `Right`
- `Home`, `End`, `PageUp`, `PageDown`, `Delete`
- `F1` through `F12`
- `Ctrl+` followed by a letter, such as `Ctrl+C` or `Ctrl+D`
- `Alt+` followed by one character, such as `Alt+b`

Unknown names fail before sending input. Text can also contain raw control or escape sequences. The plugin does not implement bracketed paste or keyboard-mode negotiation, so some full-screen applications may need application-specific sequences.

### Screen views and waiting

`start`, `send`, and `read` return:

```json
{
  "id": 1,
  "status": "running",
  "foreground": "python3",
  "waited": "matched",
  "cursor": { "row": 3, "col": 4 },
  "screen": ">>> print('result:', 1 + 1)\nresult: 2\n>>> "
}
```

- `status` is `running`, `exited`, or `failed`. `exitCode` is the terminal shell's exit code, which can be null when unavailable. On Windows, native programs' exit codes are propagated on normal completion; PowerShell may report 1 after Ctrl+C even if its native child later exits with another code. Failed programs include `error`.
- `screen` contains parsed text, not ANSI escape codes or a raw output transcript. Trailing spaces and trailing blank rows are removed. Internal blank rows remain.
- Reads default to the live 60-row screen. `read.lines` requests the most recent physical rows, including retained scrollback, up to 65,535. Alternate-screen applications do not expose primary-screen scrollback through this read.
- Views keep the newest complete rows within about 12,000 characters. `omittedLines` reports rows removed by that character budget. A daemon read larger than its own 1 MiB limit fails rather than returning a partial read.
- `cursor` is zero-based and relative to the live screen, not to the returned scrollback rows.

Without `until`, a call returns after 500 ms without new output, program exit, or timeout. Quiet output does not mean that a program has finished or is ready for input.

`until` waits for a literal, case-sensitive substring in the requested screen rows. It does not accept a regular expression. After `send`, the number of occurrences must increase compared with the screen before input. This avoids matching an unchanged old prompt just because input was echoed. Echoing the requested text itself can still match, so choose a distinctive result string. Scrolling an old occurrence off-screen can cause a timeout even when a new occurrence arrives; use `read` to inspect.

`timeoutMs` defaults to 10,000 and accepts 0 through 120,000. Zero captures the screen immediately and reports `timeout` unless a condition already matches. This timeout means that no wait was requested, not that the program failed. `waited` says why the call returned:

| Value | Meaning |
| --- | --- |
| `matched` | The requested text appeared in the screen read |
| `settled` | No output arrived for 500 ms |
| `exited` | The program exited or failed |
| `timeout` | The wait deadline expired |

A timeout does not undo input or terminate the program. Cancelling a call stops waiting, not the terminal. A cancelled start or send may already have taken effect. Inspect with `list` or `read` before repeating an action.

## Permissions and lifetime

`start` checks the `pty` permission using the command string as its resource. Approval authorizes creating and continuously controlling that terminal. Later input does not prompt separately. Treat this permission as arbitrary command execution, even when the initial command looks harmless. A shell or REPL can run different commands later.

Terminals keep running between tool calls, including while a session is idle. Exited programs retain their final screen until closed. Session deletion or movement closes that session's terminals. Unloading the plugin closes every terminal it owns. Losing the owner connection also causes the daemon to stop its terminals.

There is no restart handoff or reconnection to a previous daemon. Runtime registrations use fresh directories under `${XDG_STATE_HOME:-~/.local/state}/opencode-plugins/pty` on Unix and `%LOCALAPPDATA%\opencode-plugins\pty` on Windows, separate from OpenCode's built-in daemon registrations. Windows connects only to the spawned daemon's process ID before sending credentials or input.

## Development

Run the real-daemon integration test from `plugins/pty`:

```sh
bun test server.test.ts
```
