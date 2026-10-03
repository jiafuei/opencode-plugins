# Computer use design

How the tools and the Rust helper work, plus manual test checklists. For setup and usage, see the
[README](README.md); for the original plan, see [PLAN.md](PLAN.md).

## Screenshots and coordinates

Every tool except `computer_type`, `computer_tree` and `computer_read` returns a screenshot (actions wait 300ms first)
plus a line stating the coordinate contract:

```
Screenshot 1430x804 of the primary display (native 2560x1440, scale 0.5585). All computer_* coordinates are pixels in this 1430x804 image.
```

The helper maps screenshot pixels to capture pixels, then to the OS input space (points on macOS, physical pixels on
Windows), using the most recent full screenshot. `computer_zoom` shows a region at native resolution while coordinates
stay in full-screenshot space.

Actions add where input goes now, so keys or clicks that landed in the wrong app show up at once:
`Frontmost window: "general - Slack" (Slack). Keyboard focus: TextArea "Message #general".` When the frontmost app
exposes no focused element, that line is a warning that keys and typed text may be dropped. An explicit
`computer_screenshot` also lists every open window front to back, including minimized and covered ones, with the exact
titles `computer_focus` takes:

```
Frontmost window: "Example article — Mozilla Firefox" (Firefox). Keyboard focus: Edit "Search".
Open windows (front to back):
- "Example article — Mozilla Firefox" (Firefox) @(0,0 1430x783) foreground
- "#general | … - Discord" (Discord) @(8,12 1417x747)
- "Inbox - … - Mozilla Thunderbird" (Thunderbird) minimized
```

`computer_type` returns `Typed N characters.` plus the frontmost/focus line instead of a screenshot, read through UI
Automation / AX.

## Focus

Synthetic keys always go to the frontmost app. `computer_key` and `computer_type` take `window` to bring a window to
the front first, and `computer_type` takes `element` to focus a field from the latest tree first (AXFocused / UIA
`SetFocus`, which keeps the caret where the app puts it, unlike a click in the middle of existing text).

`computer_focus` (and `window` on the other tools) fails instead of reporting success when another app stays in front.
On Windows it taps Alt before `SetForegroundWindow` (Windows only lets a background process take the foreground right
after an Alt press; skipped when the window is already in front) and checks its result. On macOS it unminimizes the
window, raises it via AX and sets its app frontmost, then waits up to 1s for that app to become frontmost. macOS 14+
can ignore activation from a background process, so it then tries LaunchServices (`open` on the app bundle) and waits
again.

## Accessibility tree

`computer_tree` reads the foreground window through UI Automation on Windows and the AX API on macOS.

- Element IDs come from the latest `computer_tree` and stay valid across actions until the next one. The helper acts
  at the element's current center. An element that no longer exists returns an error asking for `computer_tree`.
- `computer_tree({ window })` reads any window by title (matched like `computer_focus`). Actions on its elements bring
  that window to the front first, verified, so a click by ID cannot land in the covering window.
- `computer_tree({ find })` lists only the elements whose name or value contains the text (case-insensitive), flat,
  each followed by `in "<parent name>"`.
- `computer_read({ element, offset? })` returns the full text of one element without acting or resetting IDs: the
  Text-pattern document on Windows when the element has the `text` state (terminal and editor buffers, browser
  documents), otherwise its name and value (AXValue/AXTitle/AXDescription on macOS). Lines are right-trimmed and
  trailing blank lines dropped. Pages hold 50,000 characters and end with the offset for the next page.
- Without `window`, the tree covers the foreground window, plus an open menu or popup that holds keyboard focus
  outside it. Offscreen elements are skipped and unnamed layout containers flattened. Unnamed images, text and
  separators, text that repeats its parent's name, and scroll bar parts are dropped. Bounds appear only on elements
  without listed children.
- Text is cut at 80 characters for elements with children (web containers repeat their children's text) and at 2,000
  for leaves; a cut leaf ends with `…(truncated; computer_read [id])`. URL values are cut at 60 characters. Output
  stops at 400 elements; on macOS reading stops after 3000 elements, since each attribute is a cross-process call.
- On macOS, Electron and Chromium apps only build their tree for clients that set `AXManualAccessibility` on the app;
  the helper sets it before reading a tree or the focused element.

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
```

## Overlay

The overlay runs as a separate process, the helper started with `--overlay`, which reads one banner text per line on
stdin (an empty line hides it) and exits with the helper. It is click-through and never takes focus.

- Windows: a layered, topmost `WS_EX_NOACTIVATE | WS_EX_TRANSPARENT` window drawn per pixel with
  `UpdateLayeredWindow`. Windows refuses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` for such windows (it fails
  with a misleading "not enough memory" error), and GDI captures include layered windows under DWM, so screenshots show
  the overlay. A colour-keyed window would accept the affinity but can't draw the glow.
- macOS: a non-activating `NSPanel` at screen-saver level on every Space, ignoring mouse events, from an
  accessory-policy app (no Dock icon). `NSWindowSharingNone` keeps it out of `CGWindowListCreateImage`, which xcap
  captures with.

## Helper protocol

The helper reads one JSON request per line on stdin and writes one response per line:

```sh
echo '{"id":1,"action":"screenshot"}' | bin/computer-use-helper.exe
# {"id":1,"ok":true,"image":"<base64 jpeg>","width":1430,"height":804,"cursor":[779,981]}
```

Actions: `screenshot`, `tree` (`find?`, `window?`), `zoom` (`region`), `click` (`element?` or `x`, `y`; `button?`,
`count?`), `move` (`element?` or `x`, `y`), `drag` (`start_element?` or `start_x`, `start_y`; `end_element?` or
`end_x`, `end_y`), `scroll` (`element?` or `x`, `y`; `direction`, `amount`), `type` (`text`, `element?`, `window?`),
`focus` (`title`), `key` (`keys`, `repeat?`, `window?`), `wait` (`seconds`), `hide` (hide the overlay; answers without
an image), `read` (`element`, `offset?`; answers with `text`).

Coordinates are in screenshot pixel space; the helper scales them to the primary monitor. Responses carry `image`
(screenshot, zoom and actions), `tree` (`tree`) or `text` (`read`, `type`), plus `screenshot` (full-screenshot size),
`native` (capture pixels), `scale`, and `cursor` (OS input units).

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
7. With the terminal in front, `computer_focus` a window of another app: it comes to the front, or the call fails. It
   must never report success while the terminal stays frontmost. Every action result names the frontmost window.
8. With Slack (or another Electron app) in the background, `computer_tree({ window: "Slack", find: "Message" })`: the
   message box is listed. `computer_type({ element, text })` with its ID brings Slack to the front, focuses the box, and
   the result names it as the keyboard focus.
9. With the terminal in front, `computer_key({ keys: "cmd+a", window: "TextEdit" })`: the TextEdit document is
   selected, not the terminal.

## Manual test checklist (overlay)

1. The first action shows the border and the banner; the banner follows each action ("Clicking", "Typing in …").
2. macOS: the returned screenshot shows neither the border nor the banner. Windows: it shows both.
3. Clicks and drags under the border and the banner land on the windows below; the frontmost window in the results never
   names the overlay, and the app being controlled keeps keyboard focus (type right after the overlay first appears).
4. The overlay hides after 10 seconds without an action and reappears on the next action. Repeating the same action
   resets the timeout. It also disappears when the session finishes, fails, or is interrupted with Esc.
5. With display scaling at 150% (Windows) or on a Retina display (macOS), the border hugs the screen edges and the banner
   text is sharp.
