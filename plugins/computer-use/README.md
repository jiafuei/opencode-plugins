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

Actions: `screenshot`, `tree`, `zoom` (`region`), `click` (`element?` or `x`, `y`; `button?`, `count?`), `move`
(`element?` or `x`, `y`), `drag` (`start_element?` or `start_x`, `start_y`; `end_element?` or `end_x`, `end_y`), `scroll`
(`element?` or `x`, `y`; `direction`, `amount`), `type` (`text`), `key` (`keys`, `repeat?`), `wait` (`seconds`),
`read` (`element`, `offset?`; tree mode, answers with `text` and keeps the current IDs).
Coordinates are in screenshot pixel space; the helper scales them to the primary monitor. Responses carry `image`
(screenshot mode) or `tree` (tree mode, helper started with `--tree`), plus `screenshot` (full-screenshot size), `native`
(capture pixels), `scale`, and `cursor` (OS input units).

## Tree mode

Set `COMPUTER_USE_MODE=tree` in OpenCode's environment to observe through the accessibility tree instead of
screenshots (UI Automation on Windows, the AX API on macOS). This works with text-only models and costs fewer tokens on
form-heavy apps. It is also more precise, because actions can target elements instead of pixels. In tree mode:

- `computer_tree` replaces `computer_screenshot` and `computer_zoom`, and every result is text only.
- `computer_click`, `computer_move` and `computer_scroll` take an `element` ID, and `computer_drag` takes
  `start_element`/`end_element`. The helper acts at the element's current center. x/y still work as a fallback in the
  same coordinate space the tree's bounds use.
- IDs come from the latest tree; every action returns a fresh tree, and an ID that no longer resolves returns an
  error asking for `computer_tree`.
- `computer_read({ element, offset? })` returns the full text of one element without acting or resetting IDs: the
  Text-pattern document on Windows when the element has the `text` state (terminal and editor buffers, browser
  documents), otherwise its name and value (AXValue/AXTitle/AXDescription on macOS). Lines are right-trimmed and
  trailing blank lines dropped. Pages hold 50,000 characters and end with the offset for the next page.
- Text in the tree is cut at 80 characters for elements with children (web containers repeat their children's text)
  and at 2,000 for leaves. A cut leaf ends with `…(truncated; computer_read [id])`.

Example (trimmed):

```
Accessibility tree. @(x,y wxh) bounds and all computer_* x/y are in a 1430x804 space covering the primary display (native 2560x1440, scale 0.5585). Element IDs stay valid until the next computer_tree call or action; computer_read does not reset them.

Foreground window:
[1] Window "Tibo (@thsottiaux) / X — Mozilla Firefox" @(0,0 1430x783)
  [2] ToolBar "Menu Bar" @(0,0 1430x15)
    [3] MenuBar "Application" @(0,0 194x12)
      [4] MenuItem "File" @(0,0 17x12) collapsed
  [17] Button "Back" @(22,15 21x23) collapsed
  [18] Button "Forward" @(42,15 21x23) disabled collapsed
  [27] ComboBox "Search with Google or enter address" value="…" @(218,17 867x18) collapsed
  [75] Document "Tibo (@thsottiaux) / X" value="https://x.com/thsottiaux" @(7,53 1424x729) focused
    [79] Hyperlink "Home" value="https://x.com/home" @(365,85 145x33)
Other windows:
- "#ramen-street | … - Discord" (Discord) @(8,12 1417x747)
- "Inbox - … - Mozilla Thunderbird" (Thunderbird) minimized
```

The tree covers the foreground window, plus an open menu or popup that holds keyboard focus outside it, followed by the
other top-level windows. Offscreen (scrolled-out or collapsed) elements are skipped. Unnamed layout containers are
flattened, and output stops at 400 elements. Limits:

- Apps that draw their own UI (games, canvas apps, some custom toolkits) expose little or nothing. Use keyboard tools
  or x/y there, or switch back to screenshot mode.
- Browsers expose page content only after their accessibility engine starts. Firefox and Chromium start it when the
  first UI Automation client connects, so the first tree of a browser can be slow or thin. Large pages take 1–2s.
  Chrome, Edge and Electron apps (Discord, VS Code) take a few seconds after that first access; until then their
  content areas are empty panes, and the tree ends with a note that a later `computer_tree` may show more.
- The foreground window is often the terminal running OpenCode; the model switches with alt+Tab / Start / Spotlight.
- macOS reads each attribute with a cross-process call and stops after 3000 elements, so very large web views are cut
  short.

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

## Manual test checklist (tree mode)

Run with `COMPUTER_USE_MODE=tree` (restart OpenCode after changing it), ideally once with a text-only model.

1. `computer_tree` with a normal app in front (Notepad / TextEdit, Explorer / Finder): the tree lists its controls
   with sensible roles, names and bounds.
2. Open an app via the keyboard (Start / Spotlight → type → Return), then click a toolbar button or menu by `element`.
3. Open a menu (e.g. File) and confirm the open menu appears as a focused popup, then click an item in it by ID.
4. In a browser, read a page and click a link by ID; scroll the page with `computer_scroll` on the document element.
5. Check a checkbox in a settings dialog and confirm its state flips between `unchecked` and `checked`.
6. Call a stale ID after the UI changed: the error asks for `computer_tree`.
7. In Firefox, open an article and `computer_read` its `Document` element: the article text comes back (or only the
   title and URL if the document has no `text` state), paged if long.
8. With the terminal in front, `computer_read` its `text` element: the scrollback comes back without padding.

## Manual test checklist (macOS)

1. First tool call without permissions: the error names the missing permission(s) and the system prompts appear. Grant
   them, restart the terminal and OpenCode, then take a screenshot and confirm the description matches the screen.
2. Spotlight: `computer_key "cmd+space"` → `computer_type "TextEdit"` → `computer_key "Return"`, then type text
   including CJK (e.g. `こんにちは`) and confirm it appears correctly.
3. On a Retina display, click a small target (a menu bar item or a toolbar button); it must land exactly.
4. Scroll a long page or list.
5. Drag a window by its title bar to a new position.
6. Zoom on small text (e.g. the menu bar clock), then click something found there.
