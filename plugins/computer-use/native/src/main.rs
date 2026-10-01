use base64::{engine::general_purpose::STANDARD, Engine};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, RgbaImage};
use serde::Deserialize;
use std::io::{BufRead, Write};
use std::{error::Error, thread, time::Duration};
use xcap::Monitor;

mod overlay;
mod tree;
#[cfg(target_os = "macos")]
#[path = "tree_macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "tree_windows.rs"]
mod platform;

// Screenshots are resized to fit every current vision model's limits; the model clicks in that space.
const MAX_EDGE: f64 = 1568.0;
const MAX_PIXELS: f64 = 1_150_000.0;
const SETTLE: Duration = Duration::from_millis(300);
/// After raising a window or focusing an element: activation and focus changes land asynchronously.
const FOCUS_SETTLE: Duration = Duration::from_millis(100);
const JPEG_QUALITY: u8 = 80;
const DRAG_STEPS: i32 = 10;
/// Characters per computer_read page.
const READ_PAGE: usize = 50_000;

#[derive(Deserialize)]
struct Request {
    id: u64,
    #[serde(flatten)]
    action: Action,
}

/// Pointer targets are an element ID from the latest tree, or x/y in screenshot space.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    /// Also lists the open windows; screenshots after actions only report the frontmost window and keyboard focus.
    Screenshot,
    /// `find` lists only elements whose name or value contains it. `window` reads that window instead of the
    /// foreground one, which is then raised before actions on its elements.
    Tree {
        find: Option<String>,
        window: Option<String>,
    },
    /// `[x0, y0, x1, y1]` in screenshot space.
    Zoom {
        region: [f64; 4],
    },
    Click {
        element: Option<usize>,
        x: Option<f64>,
        y: Option<f64>,
        button: Option<ClickButton>,
        count: Option<u8>,
    },
    Move {
        element: Option<usize>,
        x: Option<f64>,
        y: Option<f64>,
    },
    Drag {
        start_element: Option<usize>,
        start_x: Option<f64>,
        start_y: Option<f64>,
        end_element: Option<usize>,
        end_x: Option<f64>,
        end_y: Option<f64>,
    },
    Scroll {
        element: Option<usize>,
        x: Option<f64>,
        y: Option<f64>,
        direction: ScrollDirection,
        amount: i32,
    },
    /// Types without a screenshot: the outcome is predictable and the next action shows it. `window` is raised and
    /// `element` focused first.
    Type {
        text: String,
        window: Option<String>,
        element: Option<usize>,
    },
    /// Bring a top-level window to the front by title.
    Focus {
        title: String,
    },
    /// `window` is raised first.
    Key {
        keys: String,
        repeat: Option<u32>,
        window: Option<String>,
    },
    Wait {
        seconds: f64,
    },
    /// Hide the overlay: OpenCode's session stopped using the computer. The next action shows it again.
    Hide,
    /// Full text of a tree element, paged by character offset. Keeps the current tree and its IDs.
    Read {
        element: usize,
        offset: Option<usize>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ClickButton {
    Left,
    Right,
    Middle,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ScrollDirection {
    Up,
    Down,
    Left,
    Right,
}

/// Geometry of the most recent full capture; model coordinates refer to the screenshot made from it.
struct Display {
    monitor: Monitor,
    /// Monitor origin in input units.
    x: f64,
    y: f64,
    /// Capture size in physical pixels.
    width: u32,
    height: u32,
    /// Input units per capture pixel: 0.5 on a Retina Mac (points), 1 on DPI-aware Windows.
    input_per_pixel: f64,
    /// Screenshot pixels per capture pixel.
    scale: f64,
}

struct State {
    enigo: Enigo,
    display: Display,
    /// Accessibility backend: trees, element text, and the focused element after typing.
    backend: platform::Backend,
    /// Elements of the latest tree (ID = index + 1). Actions keep them; only the next tree replaces them.
    tree: Vec<platform::Element>,
    /// The window a tree was read from by title; raised before actions on its elements.
    tree_window: Option<xcap::Window>,
    /// Glowing border and banner that tell the user OpenCode is driving the computer, and what it is doing.
    overlay: overlay::Overlay,
}

fn fit_scale(w: f64, h: f64) -> f64 {
    1f64.min(MAX_EDGE / w.max(h)).min((MAX_PIXELS / (w * h)).sqrt())
}

fn capture() -> Result<(Display, RgbaImage), Box<dyn Error>> {
    let monitor = Monitor::all()?
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or("no primary monitor")?;
    let image = monitor.capture_image()?;
    let (width, height) = image.dimensions();
    let display = Display {
        x: monitor.x()? as f64,
        y: monitor.y()? as f64,
        width,
        height,
        // xcap reports monitor geometry in input units (points on macOS), but captures physical pixels.
        input_per_pixel: monitor.width()? as f64 / width as f64,
        scale: fit_scale(width as f64, height as f64),
        monitor,
    };
    Ok((display, image))
}

fn to_input(display: &Display, [x, y]: [f64; 2]) -> (i32, i32) {
    let factor = display.input_per_pixel / display.scale;
    ((display.x + x * factor).round() as i32, (display.y + y * factor).round() as i32)
}

fn lookup(state: &State, id: usize) -> Result<&platform::Element, Box<dyn Error>> {
    Ok(state.tree.get(id.wrapping_sub(1)).ok_or(format!("unknown element {id}; call computer_tree for current IDs"))?)
}

/// An element to act on. When its tree was read from a window by title, that window is raised first.
fn element(state: &mut State, id: usize) -> Result<platform::Element, Box<dyn Error>> {
    let element = lookup(state, id)?.clone();
    if let Some(window) = state.tree_window.clone() {
        raise(state, &window)?;
    }
    Ok(element)
}

/// Input-space point for an element ID from the latest tree (its live center), or screenshot-space x/y.
fn target(state: &mut State, element_id: Option<usize>, x: Option<f64>, y: Option<f64>) -> Result<(i32, i32), Box<dyn Error>> {
    let (x, y) = match (element_id, x, y) {
        (Some(id), _, _) => {
            let element = element(state, id)?;
            let [x, y, w, h] = state
                .backend
                .bounds(&element)
                .map_err(|_| format!("element {id} is no longer available; call computer_tree for current IDs"))?;
            return Ok(((x + w / 2.0).round() as i32, (y + h / 2.0).round() as i32));
        }
        (None, Some(x), Some(y)) => (x, y),
        _ => return Err("pass an element ID, or both x and y".into()),
    };
    Ok(to_input(&state.display, [x, y]))
}

/// Top-level window by title: case-insensitive, an exact title first, else the first title containing it. No match lists
/// the open windows.
fn find_window(title: &str) -> Result<xcap::Window, Box<dyn Error>> {
    let mut windows: Vec<(xcap::Window, String)> = xcap::Window::all()?
        .into_iter()
        .map(|window| {
            let title = window.title().unwrap_or_default();
            (window, title)
        })
        .filter(|(_, title)| !title.is_empty())
        .collect();
    let wanted = title.to_lowercase();
    let index = windows
        .iter()
        .position(|(_, title)| title.to_lowercase() == wanted)
        .or_else(|| windows.iter().position(|(_, title)| !wanted.is_empty() && title.to_lowercase().contains(&wanted)));
    let Some(index) = index else {
        let titles: Vec<String> = windows.iter().take(20).map(|(_, title)| format!("- {title}")).collect();
        return Err(format!("no window title matches \"{title}\". Open windows:\n{}", titles.join("\n")).into());
    };
    Ok(windows.swap_remove(index).0)
}

/// Bring the window to the front; the backend errors when the OS refuses. On macOS this always raises: even a window of
/// the frontmost app can sit behind another of its windows.
fn raise(state: &mut State, window: &xcap::Window) -> Result<(), Box<dyn Error>> {
    // Windows only lets a background process take the foreground right after an Alt press. A window already in front
    // is left alone.
    #[cfg(windows)]
    {
        if window.is_focused()? {
            return Ok(());
        }
        state.enigo.key(Key::Alt, Direction::Click)?;
    }
    state.backend.raise(window)?;
    thread::sleep(FOCUS_SETTLE);
    Ok(())
}

/// The window in front (on macOS: the first window of the frontmost app), or None when no app owns the foreground.
fn front_window() -> Result<Option<xcap::Window>, Box<dyn Error>> {
    Ok(xcap::Window::all()?.into_iter().find(|window| window.is_focused().unwrap_or(false)))
}

/// Where input goes now: the frontmost window and the element with keyboard focus. Reported after every action, so
/// input that lands in the wrong app shows up immediately.
fn input_target(state: &State) -> Result<String, Box<dyn Error>> {
    let front = front_window()?;
    let app = front.as_ref().map(|window| window.app_name().unwrap_or_default()).unwrap_or_default();
    let title = front.as_ref().map(|window| window.title().unwrap_or_default()).unwrap_or_default();
    let window = match (&front, title.is_empty()) {
        (None, _) => "unknown".to_string(),
        (Some(_), true) => app.clone(),
        (Some(_), false) => format!("\"{title}\" ({app})"),
    };
    Ok(match state.backend.focused(front.as_ref()) {
        Some((role, name)) if name.is_empty() => format!("Frontmost window: {window}. Keyboard focus: {role}."),
        Some((role, name)) => format!("Frontmost window: {window}. Keyboard focus: {role} \"{name}\"."),
        None => format!(
            "Frontmost window: {window}. WARNING: keyboard focus unknown: {} exposes no focused element, so keys and typed \
             text may be dropped. Pass element to computer_type, or click the target field and check this line again.",
            if app.is_empty() { "the frontmost app" } else { &app }
        ),
    })
}

/// Downscale to the model's image limits and JPEG-encode.
fn encode(image: &RgbaImage) -> Result<serde_json::Value, Box<dyn Error>> {
    let scale = fit_scale(image.width() as f64, image.height() as f64);
    let width = (image.width() as f64 * scale).round() as u32;
    let height = (image.height() as f64 * scale).round() as u32;
    let resized = image::imageops::resize(image, width, height, FilterType::Triangle);
    let mut jpeg = Vec::new();
    DynamicImage::ImageRgba8(resized).to_rgb8().write_with_encoder(JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY))?;
    Ok(serde_json::json!({ "image": STANDARD.encode(jpeg), "width": width, "height": height }))
}

/// Crop the native capture to a screenshot-space region; the crop is only downscaled if it exceeds the image limits.
fn zoom(display: &Display, [x0, y0, x1, y1]: [f64; 4]) -> Result<serde_json::Value, Box<dyn Error>> {
    let captured = display.monitor.capture_image()?;
    let native = |v: f64| (v / display.scale).round().max(0.0) as u32;
    let (x, y) = (native(x0), native(y0));
    let cropped = image::imageops::crop_imm(&captured, x, y, native(x1).saturating_sub(x).max(1), native(y1).saturating_sub(y).max(1));
    encode(&cropped.to_image())
}

fn parse_key(name: &str) -> Result<Key, Box<dyn Error>> {
    const F: [Key; 12] = [Key::F1, Key::F2, Key::F3, Key::F4, Key::F5, Key::F6, Key::F7, Key::F8, Key::F9, Key::F10, Key::F11, Key::F12];
    let lower = name.to_lowercase();
    Ok(match lower.as_str() {
        "super" | "win" | "windows" | "cmd" | "command" | "meta" => Key::Meta,
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "return" | "enter" => Key::Return,
        "escape" | "esc" => Key::Escape,
        "tab" => Key::Tab,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "page_up" | "pageup" => Key::PageUp,
        "page_down" | "pagedown" => Key::PageDown,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "space" => Key::Space,
        #[cfg(not(target_os = "macos"))]
        "insert" => Key::Insert,
        #[cfg(target_os = "macos")]
        "insert" => return Err("Insert is not supported on macOS".into()),
        _ => match (lower.strip_prefix('f').and_then(|n| n.parse::<usize>().ok()), lower.chars().count()) {
            (Some(n @ 1..=12), _) => F[n - 1],
            (_, 1) => Key::Unicode(lower.chars().next().unwrap()),
            _ => return Err(format!("unknown key: {name}").into()),
        },
    })
}

/// Banner text for the overlay while the action runs; empty hides the overlay.
fn describe(action: &Action) -> String {
    let doing = match action {
        Action::Hide => return String::new(),
        Action::Screenshot | Action::Zoom { .. } => "Looking at the screen".to_string(),
        Action::Tree { window: Some(title), .. } => format!("Reading {title}"),
        Action::Tree { .. } | Action::Read { .. } => "Reading the screen".to_string(),
        Action::Click { .. } => "Clicking".to_string(),
        Action::Move { .. } => "Moving the pointer".to_string(),
        Action::Drag { .. } => "Dragging".to_string(),
        Action::Scroll { .. } => "Scrolling".to_string(),
        Action::Type { window: Some(title), .. } => format!("Typing in {title}"),
        Action::Type { .. } => "Typing".to_string(),
        Action::Key { keys, window: Some(title), .. } => format!("Pressing {keys} in {title}"),
        Action::Key { keys, .. } => format!("Pressing {keys}"),
        Action::Focus { title } => format!("Switching to {title}"),
        Action::Wait { .. } => "Waiting".to_string(),
    };
    format!("OpenCode is using your computer · {doing}")
}

/// Perform the action. Screenshot, tree, zoom, read, type and hide answer directly; everything else is followed by a
/// fresh screenshot.
fn act(state: &mut State, action: Action) -> Result<Option<serde_json::Value>, Box<dyn Error>> {
    state.overlay.set(&describe(&action))?;
    match action {
        Action::Hide => return Ok(Some(serde_json::json!({}))),
        Action::Screenshot => {
            let mut screenshot = observe(state)?;
            screenshot["context"] = format!("{}\n{}", input_target(state)?, tree::windows(&state.display)?).into();
            return Ok(Some(screenshot));
        }
        Action::Tree { find, window } => {
            let window = window.map(|title| find_window(&title)).transpose()?;
            let header = match &window {
                Some(window) => format!(
                    "Window \"{}\" ({}); actions on its elements bring it to the front first",
                    window.title()?,
                    window.app_name().unwrap_or_default()
                ),
                None => "Foreground window".to_string(),
            };
            let (text, elements) = tree::render(&state.backend.snapshot(window.as_ref())?, &header, &state.display, find.as_deref());
            state.tree = elements;
            state.tree_window = window;
            return Ok(Some(serde_json::json!({ "tree": text })));
        }
        Action::Zoom { region } => return zoom(&state.display, region).map(Some),
        Action::Read { element, offset } => {
            let text = state
                .backend
                .text(lookup(state, element)?)
                .map_err(|_| format!("element {element} is no longer available; call computer_tree for current IDs"))?;
            // Terminal buffers pad every line and end in blank lines.
            let text = text.lines().map(str::trim_end).collect::<Vec<_>>().join("\n");
            let text = text.trim_end();
            // One page of READ_PAGE characters from `offset`, with a note on the range when it is not the whole text.
            let total = text.chars().count();
            let start = offset.unwrap_or(0).min(total);
            let end = (start + READ_PAGE).min(total);
            let mut page: String = text.chars().skip(start).take(end - start).collect();
            if start > 0 || end < total {
                let more = if end < total { format!("; call computer_read with offset={end} for more") } else { String::new() };
                page.push_str(&format!("\n[showing chars {start}–{end} of {total}{more}]"));
            }
            return Ok(Some(serde_json::json!({ "text": page })));
        }
        Action::Move { element, x, y } => {
            let (x, y) = target(state, element, x, y)?;
            state.enigo.move_mouse(x, y, Coordinate::Abs)?;
        }
        Action::Click { element, x, y, button, count } => {
            let (x, y) = target(state, element, x, y)?;
            state.enigo.move_mouse(x, y, Coordinate::Abs)?;
            let button = match button {
                None | Some(ClickButton::Left) => Button::Left,
                Some(ClickButton::Right) => Button::Right,
                Some(ClickButton::Middle) => Button::Middle,
            };
            for _ in 0..count.unwrap_or(1) {
                state.enigo.button(button, Direction::Click)?;
            }
        }
        Action::Drag { start_element, start_x, start_y, end_element, end_x, end_y } => {
            let (sx, sy) = target(state, start_element, start_x, start_y)?;
            let (ex, ey) = target(state, end_element, end_x, end_y)?;
            let enigo = &mut state.enigo;
            enigo.move_mouse(sx, sy, Coordinate::Abs)?;
            enigo.button(Button::Left, Direction::Press)?;
            // Intermediate moves so apps see a real drag rather than a jump.
            for step in 1..=DRAG_STEPS {
                enigo.move_mouse(sx + (ex - sx) * step / DRAG_STEPS, sy + (ey - sy) * step / DRAG_STEPS, Coordinate::Abs)?;
                thread::sleep(Duration::from_millis(15));
            }
            enigo.button(Button::Left, Direction::Release)?;
        }
        Action::Scroll { element, x, y, direction, amount } => {
            let (x, y) = target(state, element, x, y)?;
            state.enigo.move_mouse(x, y, Coordinate::Abs)?;
            // enigo: positive scrolls down / right.
            let (length, axis) = match direction {
                ScrollDirection::Up => (-amount, Axis::Vertical),
                ScrollDirection::Down => (amount, Axis::Vertical),
                ScrollDirection::Left => (-amount, Axis::Horizontal),
                ScrollDirection::Right => (amount, Axis::Horizontal),
            };
            state.enigo.scroll(length, axis)?;
        }
        Action::Type { text, window, element: id } => {
            if let Some(title) = window {
                raise(state, &find_window(&title)?)?;
            }
            if let Some(id) = id {
                let element = element(state, id)?;
                state.backend.focus(&element).map_err(|error| format!("could not focus element {id}: {error}"))?;
                thread::sleep(FOCUS_SETTLE);
            }
            state.enigo.text(&text)?;
            // Name where the text went, so typing into the wrong place shows up without a screenshot.
            let typed = format!("Typed {} characters. {}", text.chars().count(), input_target(state)?);
            return Ok(Some(serde_json::json!({ "text": typed })));
        }
        Action::Focus { title } => {
            raise(state, &find_window(&title)?)?;
        }
        Action::Key { keys, repeat, window } => {
            // Parse the whole chord before pressing anything.
            let keys = keys.split('+').map(parse_key).collect::<Result<Vec<_>, _>>()?;
            let (last, modifiers) = keys.split_last().ok_or("empty key chord")?;
            if let Some(title) = window {
                raise(state, &find_window(&title)?)?;
            }
            for _ in 0..repeat.unwrap_or(1) {
                for key in modifiers {
                    state.enigo.key(*key, Direction::Press)?;
                }
                state.enigo.key(*last, Direction::Click)?;
                for key in modifiers.iter().rev() {
                    state.enigo.key(*key, Direction::Release)?;
                }
            }
        }
        Action::Wait { seconds } => thread::sleep(Duration::from_secs_f64(seconds)),
    }
    thread::sleep(SETTLE);
    Ok(None)
}

/// Refresh the display mapping and take a screenshot.
fn observe(state: &mut State) -> Result<serde_json::Value, Box<dyn Error>> {
    let (display, image) = capture()?;
    state.display = display;
    encode(&image)
}

fn main() -> Result<(), Box<dyn Error>> {
    // Without per-monitor DPI awareness, Windows virtualizes coordinates under display scaling and
    // capture and input stop agreeing on pixel space.
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)?;
    }
    if std::env::args().nth(1).as_deref() == Some("--overlay") {
        return overlay::run();
    }
    let enigo = Enigo::new(&Settings::default());
    // macOS grants Screen Recording and Accessibility to the app that launched OpenCode (the terminal). Missing
    // grants are requested here (the system shows its prompt) and only take effect after that app restarts.
    #[cfg(target_os = "macos")]
    {
        let mut missing = Vec::new();
        if !macos::screen_recording() {
            missing.push("Screen Recording");
        }
        // Enigo checks Accessibility itself and opens the system prompt when it is missing.
        if matches!(enigo, Err(enigo::NewConError::NoPermission)) {
            missing.push("Accessibility");
        }
        if !missing.is_empty() {
            return refuse(&format!(
                "macOS {} permission missing. Grant it to the terminal app that runs OpenCode in System Settings > Privacy & Security, then quit and reopen that app and OpenCode.",
                missing.join(" and ")
            ));
        }
    }
    // UI Automation initializes COM, so the backend is created before anything else touches it.
    let backend = platform::Backend::new()?;
    let mut state = State { enigo: enigo?, display: capture()?.0, backend, tree: Vec::new(), tree_window: None, overlay: Default::default() };
    let mut stdout = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let request: Request = serde_json::from_str(&line?)?;
        let result = act(&mut state, request.action).and_then(|answer| match answer {
            Some(answer) => Ok(answer),
            None => observe(&mut state).and_then(|mut screenshot| {
                screenshot["context"] = input_target(&state)?.into();
                Ok(screenshot)
            }),
        });
        let response = match result {
            Ok(mut response) => {
                let display = &state.display;
                response["id"] = request.id.into();
                response["ok"] = true.into();
                response["screenshot"] = serde_json::json!([
                    (display.width as f64 * display.scale).round() as u32,
                    (display.height as f64 * display.scale).round() as u32
                ]);
                response["native"] = serde_json::json!([display.width, display.height]);
                response["scale"] = display.scale.into();
                response["cursor"] = serde_json::json!(state.enigo.location()?);
                response
            }
            Err(error) => serde_json::json!({ "id": request.id, "ok": false, "error": error.to_string() }),
        };
        writeln!(stdout, "{response}")?;
        stdout.flush()?;
    }
    Ok(())
}

/// Answer every request with the same error, for when the helper cannot work at all.
#[cfg(target_os = "macos")]
fn refuse(error: &str) -> Result<(), Box<dyn Error>> {
    let mut stdout = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let request: serde_json::Value = serde_json::from_str(&line?)?;
        writeln!(stdout, "{}", serde_json::json!({ "id": request["id"], "ok": false, "error": error }))?;
        stdout.flush()?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    /// Whether Screen Recording is granted; opens the system prompt when it is not.
    pub fn screen_recording() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() }
    }
}
