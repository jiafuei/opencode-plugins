# Computer use

Screenshot-driven desktop control for OpenCode. The plugin registers ordinary tools; a small Rust helper
(`native/`) captures the screen and drives mouse and keyboard. See [PLAN.md](PLAN.md) for the design.

Targets: Windows host with the OpenCode server in WSL2, and macOS with OpenCode running natively. Primary display only.

| Tool | Input |
|---|---|
| `computer_screenshot` | — |
| `computer_zoom` | `x0`, `y0`, `x1`, `y1` — region shown at native resolution; coordinates stay in full-screenshot space |
| `computer_tree` | `find?` — foreground window's accessibility tree as text, with element IDs; `find` lists only matching elements |
| `computer_read` | `element`, `offset?` — full text of one tree element, paged |
| `computer_click` | `element` or `x`, `y`; `button?` (`left`/`right`/`middle`), `count?` (1–3) |
| `computer_move` | `element` or `x`, `y` — hover |
| `computer_drag` | `start_element` or `start_x`, `start_y`; `end_element` or `end_x`, `end_y` — left-button drag |
| `computer_scroll` | `element` or `x`, `y`; `direction` (`up`/`down`/`left`/`right`), `amount` (wheel clicks) |
| `computer_type` | `text` — Unicode, layout-independent; returns only the focused element, no screenshot |
| `computer_focus` | `title` — bring a window to the front (exact title, else substring); no match lists open windows |
| `computer_key` | `keys` chord like `"ctrl+s"`, `"super"`, `"Return"` (case-insensitive, xdotool-style names), `repeat?` |
| `computer_wait` | `seconds` |

Every tool except `computer_type`, `computer_tree` and `computer_read` returns a screenshot (actions wait 300ms first) plus a line stating the coordinate
contract:
`Screenshot 1430x804 of the primary display (native 2560x1440, scale 0.5585). All computer_* coordinates are pixels in
this 1430x804 image.` The helper maps screenshot pixels to capture pixels, then to the OS input space (points on
macOS, physical pixels on Windows), using the most recent full screenshot.

`computer_type` returns `Typed N characters into <Role> "<name>".` instead, naming the element that had keyboard focus
(read through UI Automation / AX), so typing into the wrong field shows up without an image.
`computer_focus` taps Alt before `SetForegroundWindow` on Windows (Windows only lets a background process take the
foreground right after an Alt press) and reports an error when focus was still refused; on macOS it raises the window
via AX and makes its app frontmost.

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

The helper reads one JSON request per line on stdin and writes one response per line:

```sh
echo '{"id":1,"action":"screenshot"}' | bin/computer-use-helper.exe
# {"id":1,"ok":true,"image":"<base64 jpeg>","width":1430,"height":804,"cursor":[779,981]}
```

Actions: `screenshot`, `tree` (`find?`), `zoom` (`region`), `click` (`element?` or `x`, `y`; `button?`, `count?`), `move`
(`element?` or `x`, `y`), `drag` (`start_element?` or `start_x`, `start_y`; `end_element?` or `end_x`, `end_y`), `scroll`
(`element?` or `x`, `y`; `direction`, `amount`), `type` (`text`), `key` (`keys`, `repeat?`), `wait` (`seconds`),
`read` (`element`, `offset?`; answers with `text`).
Coordinates are in screenshot pixel space; the helper scales them to the primary monitor. Responses carry `image`
(screenshot, zoom and actions), `tree` (`tree`) or `text` (`read`, `type`), plus `screenshot` (full-screenshot size),
`native` (capture pixels), `scale`, and `cursor` (OS input units).

## Accessibility tree

`computer_tree` reads the foreground window through UI Automation on Windows and the AX API on macOS. Screenshots stay
the default observation; the tree is for targeting small or crowded controls exactly and for reading text:

- `computer_click`, `computer_move` and `computer_scroll` take an `element` ID, and `computer_drag` takes
  `start_element`/`end_element`. The helper acts at the element's current center. Tree bounds are in screenshot pixels.
- IDs come from the latest `computer_tree` and stay valid across actions until the next one. An element that no longer
  exists returns an error asking for `computer_tree`; after larger UI changes the model should re-read the tree, since
  an ID can still resolve to an element whose content changed.
- `computer_tree({ find })` lists only the elements whose name or value contains the text (case-insensitive), flat,
  each followed by `in "<parent name>"`, and skips the window list. The model sees a label in the screenshot and asks
  for just that element, which costs a few lines instead of the whole tree.
- `computer_read({ element, offset? })` returns the full text of one element without acting or resetting IDs: the
  Text-pattern document on Windows when the element has the `text` state (terminal and editor buffers, browser
  documents), otherwise its name and value (AXValue/AXTitle/AXDescription on macOS). Lines are right-trimmed and
  trailing blank lines dropped. Pages hold 50,000 characters and end with the offset for the next page.
- Text in the tree is cut at 80 characters for elements with children (web containers repeat their children's text)
  and at 2,000 for leaves. A cut leaf ends with `…(truncated; computer_read [id])`.

Example (trimmed):

```
Accessibility tree. @(x,y wxh) bounds are in the 1430x804 screenshot space of the primary display (native 2560x1440, scale 0.5585). Element IDs stay valid until the next computer_tree call; after the UI changes substantially (navigation, a new dialog), call computer_tree again before using them.

Foreground window:
[1] Window "Example article — Mozilla Firefox"
  [2] ToolBar "Menu Bar"
    [3] MenuBar "Application"
      [4] MenuItem "File" @(0,0 17x12) collapsed
  [17] Button "Back" @(22,15 21x23) collapsed
  [18] Button "Forward" @(42,15 21x23) disabled collapsed
  [27] ComboBox "Search with Google or enter address" value="…" @(218,17 867x18) collapsed
  [75] Document "Example article" value="https://example.com/article" focused
    [79] Hyperlink "Home" value="https://x.com/home" @(365,85 145x33)
Other windows:
- "#general | … - Discord" (Discord) @(8,12 1417x747)
- "Inbox - … - Mozilla Thunderbird" (Thunderbird) minimized
```

The tree covers the foreground window, plus an open menu or popup that holds keyboard focus outside it, followed by the
other top-level windows. Offscreen (scrolled-out or collapsed) elements are skipped. Unnamed layout containers are
flattened. Unnamed images, text and separators, text that repeats its parent's name (a link and its text), and scroll bar
parts are dropped. Bounds appear only on elements without listed children; containers are targeted by ID. URL values
are cut at 60 characters. Output stops at 400 elements. Limits:

- Apps that draw their own UI (games, canvas apps, some custom toolkits) expose little or nothing. Use the screenshot
  and x/y there.
- Browsers expose page content only after their accessibility engine starts. Firefox and Chromium start it when the
  first UI Automation client connects, so the first tree of a browser can be slow or thin. Large pages take 1–2s.
  Chrome, Edge and Electron apps (Discord, VS Code) take a few seconds after that first access; until then their
  content areas are empty panes, and the tree ends with a note that a later `computer_tree` may show more.
- The foreground window is often the terminal running OpenCode; the model switches with `computer_focus`.
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
{ "plugins": ["/absolute/path/to/opencode-plugins/plugins/computer-use"] }
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
9. `computer_focus` a window behind the terminal by part of its title, then a minimized one: both come to the front.
   A title that matches nothing returns the list of open windows.
10. Click into a text field and `computer_type` into it: the result names that field (e.g. `Edit "Search"`); then do
    the same with focus somewhere unexpected and confirm the result shows where the text actually went.

## Manual test checklist (accessibility tree)

1. `computer_tree` with a normal app in front (Notepad / TextEdit, Explorer / Finder): the tree lists its controls
   with sensible roles, names and bounds.
2. Open an app via the keyboard (Start / Spotlight → type → Return), then click a toolbar button or menu by `element`.
3. Open a menu (e.g. File) and confirm the open menu appears as a focused popup, then click an item in it by ID.
4. In a browser, read a page and click a link by ID; scroll the page with `computer_scroll` on the document element.
5. Check a checkbox in a settings dialog and confirm its state flips between `unchecked` and `checked`.
6. Close a dialog, then use an ID from inside it: the error asks for `computer_tree`. Click by ID, then click
   another ID from the same tree: both land (actions keep the IDs).
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
