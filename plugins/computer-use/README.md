# Computer use

Lets OpenCode's model see and control your desktop. The model takes screenshots, then clicks, types, scrolls, and
switches windows through ordinary tools; a small Rust helper (`native/`) captures the screen and drives the mouse and
keyboard.

Supported setups: Windows with the OpenCode server in WSL2, and macOS with OpenCode running natively. Only the
primary display is used.

## Tools

| Tool | Input |
|---|---|
| `computer_screenshot` | — also lists the frontmost window, keyboard focus and the open windows |
| `computer_zoom` | `x0`, `y0`, `x1`, `y1` — a region at full resolution, for reading small text |
| `computer_tree` | `find?`, `window?` — accessibility tree of the foreground window, or of any window by title, as text with element IDs; `find` lists only matching elements |
| `computer_read` | `element`, `offset?` — full text of one tree element, paged |
| `computer_click` | `element` or `x`, `y`; `button?` (`left`/`right`/`middle`), `count?` (1–3) |
| `computer_move` | `element` or `x`, `y` — hover |
| `computer_drag` | `start_element` or `start_x`, `start_y`; `end_element` or `end_x`, `end_y` — left-button drag |
| `computer_scroll` | `element` or `x`, `y`; `direction` (`up`/`down`/`left`/`right`), `amount` (wheel clicks) |
| `computer_type` | `text`, `element?`, `window?` — Unicode, layout-independent; focuses `element` / raises `window` first |
| `computer_focus` | `title` — bring a window to the front (exact title, else substring) |
| `computer_key` | `keys` chord like `"ctrl+s"`, `"super"`, `"Return"` (case-insensitive, xdotool-style names), `repeat?`, `window?` |
| `computer_wait` | `seconds` |

Actions return a fresh screenshot together with the frontmost window and the focused element, so input that went to
the wrong app shows up right away. Coordinates are pixels in the latest screenshot; the plugin handles display
scaling.

Screenshots are the main way the model sees the screen. The accessibility tree (`computer_tree`) helps it target
small or crowded controls exactly and read text: it lists the controls of a window with IDs that the click, move,
drag, scroll, and type tools accept. Some apps expose little or nothing there:

- Apps that draw their own UI (games, canvas apps, some custom toolkits) have no useful tree; the model falls back to
  screenshots and x/y.
- Browsers and Electron apps (Chrome, Edge, Firefox, Slack, Discord, VS Code) start their accessibility support on
  first access, so the first tree can be slow or empty; a later call shows more.
- On macOS, minimized windows and windows on other Spaces can't be focused or read.

See [DESIGN.md](DESIGN.md) for how the tools, tree, and helper work.

## Overlay

While OpenCode drives the computer, the primary display gets a glowing orange border and a banner at the top saying
what it is doing, e.g. `OpenCode is using your computer · Typing in Slack`. The overlay appears with the first action
and hides after 10 seconds without another, or when every session that used the computer stops. Typed text is never
shown. The overlay is click-through and never takes focus. On Windows it appears in the model's screenshots, and the
model is told it is OpenCode's own overlay.

## Build the helper (Windows / WSL)

From WSL, with the Windows Rust toolchain (MSVC target). Replace `<username>` with your Windows user folder name:

```sh
cd plugins/computer-use/native
"/mnt/c/Users/<username>/.cargo/bin/cargo.exe" build --release --target-dir 'C:\Users\<username>\AppData\Local\Temp\computer-use-target'
mkdir -p ../bin && cp "/mnt/c/Users/<username>/AppData/Local/Temp/computer-use-target/release/computer-use-helper.exe" ../bin/
```

The source can stay on the Linux filesystem; only the target directory lives on the Windows side. The plugin runs
`bin/computer-use-helper.exe` through WSL interop. Set `COMPUTER_USE_HELPER` to use a different path.

Restart OpenCode after rebuilding. While a helper started from `bin/` is still running, Windows keeps launching the
cached old image for that `\\wsl.localhost` path, even after the file is replaced.

## Build the helper (macOS)

On the Mac, with a Rust toolchain:

```sh
cd plugins/computer-use/native
cargo build --release
mkdir -p ../bin && cp target/release/computer-use-helper ../bin/
```

The plugin runs `bin/computer-use-helper` on macOS.

### Permissions

The helper needs **Screen Recording** and **Accessibility**. macOS grants both to the app that launched OpenCode (your
terminal, e.g. Terminal, iTerm2, Ghostty), not to the helper itself. On the first tool call the helper triggers the
system prompts and every call returns an error naming the missing permission. To grant them:

1. System Settings → Privacy & Security → Screen Recording: enable your terminal app.
2. System Settings → Privacy & Security → Accessibility: enable your terminal app.
3. Quit and reopen the terminal app, then start OpenCode again.

## Load in OpenCode

Add the plugin directory by absolute path to the `plugins` array in `opencode.json`:

```json
{ "plugins": ["/absolute/path/to/opencode-plugins/plugins/computer-use"] }
```

Consider gating the tools with `"permission": { "computer_*": "ask" }`.
