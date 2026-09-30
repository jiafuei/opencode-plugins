# Computer use

Screenshot-driven desktop control for OpenCode. The plugin registers ordinary tools; a small Rust helper
(`native/`) captures the screen and drives mouse and keyboard. See [PLAN.md](PLAN.md) for the design.

Targets: Windows host with the OpenCode server in WSL2, and macOS with OpenCode running natively. Primary display only.

| Tool | Input |
|---|---|
| `computer_screenshot` | — |
| `computer_zoom` | `x0`, `y0`, `x1`, `y1` — region shown at native resolution; coordinates stay in full-screenshot space |
| `computer_click` | `x`, `y`, `button?` (`left`/`right`/`middle`), `count?` (1–3) |
| `computer_move` | `x`, `y` — hover |
| `computer_drag` | `start_x`, `start_y`, `end_x`, `end_y` — left-button drag |
| `computer_scroll` | `x`, `y`, `direction` (`up`/`down`/`left`/`right`), `amount` (wheel clicks) |
| `computer_type` | `text` — Unicode, layout-independent |
| `computer_key` | `keys` chord like `"ctrl+s"`, `"super"`, `"Return"` (case-insensitive, xdotool-style names), `repeat?` |
| `computer_wait` | `seconds` |

Every tool returns a screenshot (actions wait 300ms first) plus a line stating the coordinate contract:
`Screenshot 1430x804 of the primary display (native 2560x1440, scale 0.5585). All computer_* coordinates are pixels in
this 1430x804 image.` The helper maps screenshot pixels to capture pixels, then to the OS input space (points on
macOS, physical pixels on Windows), using the most recent full screenshot.

## Build the helper (Windows / WSL)

From WSL, with the Windows Rust toolchain (MSVC target):

```sh
cd plugins/computer-use/native
/mnt/c/Users/RAY/.cargo/bin/cargo.exe build --release --target-dir 'C:\Users\RAY\AppData\Local\Temp\computer-use-target'
mkdir -p ../bin && cp /mnt/c/Users/RAY/AppData/Local/Temp/computer-use-target/release/computer-use-helper.exe ../bin/
```

The source can stay on the Linux filesystem; only the target directory lives on the Windows side. The plugin runs
`bin/computer-use-helper.exe` through WSL interop. Set `COMPUTER_USE_HELPER` to use a different path.

Restart OpenCode after rebuilding. While a helper started from `bin/` is still running, Windows keeps launching the
cached old image for that `\\wsl.localhost` path, even after the file is replaced.

The helper reads one JSON request per line on stdin and writes one response per line:

```sh
echo '{"id":1,"action":"screenshot"}' | bin/computer-use-helper.exe
# {"id":1,"ok":true,"image":"<base64 jpeg>","width":1430,"height":804,"cursor":[779,981]}
```

Actions: `screenshot`, `zoom` (`region`), `click` (`coordinate`, `button?`, `count?`), `move` (`coordinate`), `drag`
(`start`, `end`), `scroll` (`coordinate`, `direction`, `amount`), `type` (`text`), `key` (`keys`, `repeat?`), `wait`
(`seconds`). Coordinates are in screenshot pixel space; the helper scales them to the primary monitor. Responses also
carry `screenshot` (full-screenshot size), `native` (capture pixels), `scale`, and `cursor` (OS input units).

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
{ "plugins": ["/home/jf/git/opencode-plugins/plugins/computer-use"] }
```

Consider gating the tools with `"permission": { "computer_*": "ask" }`.

## Manual test checklist (Windows)

1. Ask the model to take a screenshot and describe what is on screen. The description must match the actual desktop
   (proves the image reached the model). Repeat with the claude-oauth provider and one non-Anthropic provider.
2. "Open Notepad": expect Win (`computer_key "super"`) → `computer_type "notepad"` → `computer_key "Return"`, then type
   some text including CJK (e.g. `こんにちは`) and confirm it appears correctly.
3. Scroll a long page or list (`computer_scroll`) and confirm the returned screenshot moved.
4. Drag a window by its title bar to a new position, and resize one by its edge.
5. Hover a menu or toolbar button that shows a tooltip or submenu (`computer_move`).
6. Ask the model to read small text (e.g. the tray clock) using `computer_zoom`, then click something it found there;
   the click must land (zoom must not shift coordinates).
7. Set Windows display scaling to 125% or 150%, restart OpenCode, and repeat a small-target click.
8. Double-click and right-click a desktop item.

## Manual test checklist (macOS)

1. First tool call without permissions: the error names the missing permission(s) and the system prompts appear. Grant
   them, restart the terminal and OpenCode, then take a screenshot and confirm the description matches the screen.
2. Spotlight: `computer_key "cmd+space"` → `computer_type "TextEdit"` → `computer_key "Return"`, then type text
   including CJK (e.g. `こんにちは`) and confirm it appears correctly.
3. On a Retina display, click a small target (a menu bar item or a toolbar button); it must land exactly.
4. Scroll a long page or list.
5. Drag a window by its title bar to a new position.
6. Zoom on small text (e.g. the menu bar clock), then click something found there.
