# computer-use plugin — plan

Screenshot-driven desktop control for OpenCode. The plugin exposes ordinary tools; a small Rust helper does
capture and input. OpenCode keeps the agent loop — the helper only ever receives concrete actions.

## Scope

v1 targets:

- **Windows host, OpenCode server in WSL2** (primary)
- **macOS, OpenCode server native** (second)

Out of scope for v1: Linux X11/Wayland, remote servers/VMs, multi-monitor selection, TUI panel,
provider-native computer-use toolsets, clipboard paste. Browser work is possible but a CDP/Playwright tool is the better
fit; not optimized here.

## Architecture

```
OpenCode (WSL or macOS)
  plugins/computer-use/server.ts
    - registers computer_* tools via ctx.tool.transform
    - spawns helper lazily on first call, keeps it alive, respawns if it dies
    - serializes tool calls through one promise chain
        │  stdin/stdout, JSON lines
        ▼
  helper binary (Rust)
    - WSL:   helper.exe spawned through WSL interop (Windows process)
    - macOS: native helper binary
    - xcap (capture), enigo (input), image (resize + JPEG encode)
```

No sockets, named pipes, daemon, or cross-process lock. One helper per OpenCode server process. Detect WSL via
`process.env.WSL_DISTRO_NAME`.

## Protocol

One JSON object per line.

```
→ {"id":1,"action":"click","coordinate":[640,400],"button":"left","count":1}
← {"id":1,"ok":true,"image":"<base64 jpeg>","width":1280,"height":720}
← {"id":1,"ok":false,"error":"..."}
```

Every action response carries a fresh screenshot (helper waits a short settle delay first, ~300ms). `wait` sleeps
then screenshots.

## Tools

Vocabulary follows Anthropic's computer toolset (xdotool key names, screenshot-space coordinates), kept
provider-neutral as ordinary OpenCode tools. Clicks are merged into one tool.

See the tool table in README.md (x/y are separate fields; some providers reject tuple schemas).

Result: `content: [{ type: "text", text: "<coordinate contract>" }, { type: "file", uri: "data:image/jpeg;base64,...", mime: "image/jpeg" }]`
(same shape MCP image results use in OpenCode's `packages/core/src/tool/mcp.ts`).

Tool access is gated by normal OpenCode permission config (e.g. `"computer_*": "ask"`).

## Coordinates

The helper owns scaling. On each capture it computes

```
scale = min(1, 1568 / longEdge, sqrt(1_150_000 / (w*h)))
```

resizes the image, and stores `scale` plus the monitor origin. Incoming coordinates map as
`screen = origin + model / scale`. `zoom` coordinates are in full-screenshot space too; zoom crops the native capture
and resizes the crop to the same limits.

Platform notes:

- **Windows:** the helper must be per-monitor DPI aware (`SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` at
  startup or via manifest), otherwise capture and input disagree on pixel spaces under fractional scaling.
- **macOS:** capture is in physical pixels, CGEvent input is in points — divide by the backing scale factor (2 on Retina).

v1 uses the primary monitor only.

## Keyboard

- `computer_key`: parse `mod+mod+key`; modifiers `ctrl`, `alt`, `shift`, `super` (Win/Cmd). Map xdotool names
  (`Return`, `Escape`, `Tab`, `BackSpace`, `Delete`, `Home`, `End`, `Page_Up`, `Page_Down`, arrows, `F1`–`F12`) to enigo
  keys; single characters map to `Key::Unicode`. Press modifiers, tap key, release in reverse.
- `computer_type`: enigo `text()` — `KEYEVENTF_UNICODE` on Windows, `CGEventKeyboardSetUnicodeString` on macOS. Layout-
  and IME-independent for normal apps.

## Cancellation

If `context.signal` is aborted while a call is queued, skip it. In-flight actions are short and are not interrupted or
replayed. The helper releases any modifiers it pressed within the same action, so nothing stays held.

## Phases

### 0. Spike (Windows via WSL) — done

Goal: prove the three risky parts in one pass.

1. Rust helper with `screenshot` and `click` only; built from WSL with the Windows MSVC toolchain (see README).
2. Plugin spawns `helper.exe` via interop from the Linux filesystem path; confirm stdio works (and whether a UNC cwd
   causes trouble).
3. `computer_screenshot` returns the data-URI file part; confirm the model actually receives the image (check with the
   claude-oauth provider and one non-Anthropic provider).
4. On a display with 125–150% scaling, ask the model to click a specific small target; confirm it lands.

### 1. Full Windows tool set — implemented, awaiting manual checklist

All tools above, key mapping, Unicode typing (test with CJK text), call serialization, cancellation, helper respawn.
Manual checklist run against Notepad, Explorer, and one of the user's own GUI apps.

Decided during phase 1: fixed 300ms post-action settle with no per-call override — `computer_wait` covers slower
animations (the Start menu was captured mid-animation in testing). Coordinates are `Schema.Number` (plugin-side `Int`
checks fail inside opencode's effect copy); the helper rounds. Every result states the coordinate contract.

### 2. macOS backend — implemented, awaiting build and manual checklist on a Mac

Same helper, macOS build. Coordinate mapping now derives the input-units-per-capture-pixel ratio from xcap's monitor
geometry (points on macOS, physical pixels on DPI-aware Windows) against the captured image, and maps through the most
recent full screenshot. Screen Recording is checked with `CGPreflightScreenCaptureAccess` (prompt via
`CGRequestScreenCaptureAccess`); Accessibility via enigo, which prompts and fails with `NoPermission`. When either is
missing the helper answers every request with an error naming it. Permissions attach to the terminal app that launched
OpenCode; code signing and a stable helper identity are deferred to phase 3.

### 3. Distribution

Decide how the plugin obtains the helper: per-platform npm packages vs. download from GitHub releases on first use.
Build Windows and macOS binaries in CI. Sign the macOS helper if permissions should attach to it rather than the
terminal.

### Tree mode — implemented; Windows verified by helper-level checks, macOS unbuilt

`COMPUTER_USE_MODE=tree` swaps screenshots for the foreground window's accessibility tree (text only), for text-only
models, token cost, and element-precise targeting. Decisions:

- **Element IDs**: sequential per tree. The helper keeps id → native element (UIA element / AXUIElement) from the latest
  tree only, re-reads the element's live bounds on use, and acts at the center. Pointer tools take `element`
  (`start_element`/`end_element` for drag); x/y stay as a fallback and are optional in tree mode.
- **Scope**: foreground window, plus the top-level window or AXMenu holding keyboard focus when it lies outside (open
  menus), then a list of other windows (xcap's window list: title, app, bounds, minimized).
- **Pruning**: skip offscreen and zero-size elements; flatten unnamed pane/group containers; cap at 400 rendered elements.
- **Windows**: `uiautomation` crate, one cached Subtree request with the rendered properties. The cached subtree stops
  at browser documents (separate providers), so an empty Document gets a second cached request rooted at itself.
  Toggle/expand/selection states are only read when the pattern is available (otherwise UIA returns a sentinel).
- **macOS**: `accessibility-sys` + `core-foundation`: AXFocusedApplication → AXFocusedWindow → AXChildren recursion,
  bounded at 3000 visited elements; elements outside the window rect count as offscreen.
- Coordinates stay in the screenshot space (the helper still captures once per observation to keep the mapping fresh),
  so x/y and tree bounds agree across modes.
- **Text limits**: labels of elements with children are cut at 80 characters (web containers repeat their children), leaf
  text at 2,000; a cut leaf points at `computer_read`. No per-call length argument: the element cap bounds output.
- **`computer_read({ element, offset? })`**: full text of one element without acting or resetting IDs. Windows reads
  the Text-pattern document when available (terminals, editors, browser documents), else name + value; macOS reads
  AXValue/AXTitle/AXDescription (no text-range APIs). Right-trimmed lines, 50,000-character pages with a next-offset note.

### Post-action observation

Every action returns a fresh screenshot (or tree) except `computer_type`. Typing has a predictable outcome and in
practice is almost always followed by `computer_key` (Return, Tab) or a click, whose result shows the outcome anyway.
Instead it returns the role and name of the element with keyboard focus, which catches typing into the wrong field.
Move, key, scroll, drag, click, wait and focus keep their observation: each changes the screen in ways the model has to
see (hover menus, dialogs opened by shortcuts, new scroll content). In tree mode typing keeps the current IDs.

`computer_focus({ title })` brings a window to the front in both modes (Alt tap + `SetForegroundWindow` on Windows,
AXRaise + AXFrontmost on macOS); with no match, the error lists open windows, which is how screenshot mode discovers
titles.

## Open questions

- Helper delivery mechanism (phase 3).
- JPEG quality (80 now): check small-text legibility in phase 1; `zoom` is the fallback.
