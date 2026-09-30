use base64::{engine::general_purpose::STANDARD, Engine};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, RgbaImage};
use serde::Deserialize;
use std::io::{BufRead, Write};
use std::{error::Error, thread, time::Duration};
use xcap::Monitor;

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
    Screenshot,
    Tree,
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
    Type {
        text: String,
    },
    Key {
        keys: String,
        repeat: Option<u32>,
    },
    Wait {
        seconds: f64,
    },
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
    /// Tree mode: the accessibility backend and the elements of the latest tree (ID = index + 1).
    tree: Option<(platform::Backend, Vec<platform::Element>)>,
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

fn lookup(state: &State, id: usize) -> Result<(&platform::Backend, &platform::Element), Box<dyn Error>> {
    let (backend, elements) = state.tree.as_ref().ok_or("element IDs are only available in tree mode")?;
    let element = elements.get(id.wrapping_sub(1)).ok_or(format!("unknown element {id}; call computer_tree for current IDs"))?;
    Ok((backend, element))
}

/// Input-space point for an element ID from the latest tree (its live center), or screenshot-space x/y.
fn target(state: &State, element: Option<usize>, x: Option<f64>, y: Option<f64>) -> Result<(i32, i32), Box<dyn Error>> {
    let (x, y) = match (element, x, y) {
        (Some(id), _, _) => {
            let (backend, element) = lookup(state, id)?;
            let [x, y, w, h] = backend
                .bounds(element)
                .map_err(|_| format!("element {id} is no longer available; call computer_tree for current IDs"))?;
            return Ok(((x + w / 2.0).round() as i32, (y + h / 2.0).round() as i32));
        }
        (None, Some(x), Some(y)) => (x, y),
        _ => return Err("pass an element ID, or both x and y".into()),
    };
    Ok(to_input(&state.display, [x, y]))
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
        "insert" => Key::Insert,
        _ => match (lower.strip_prefix('f').and_then(|n| n.parse::<usize>().ok()), lower.chars().count()) {
            (Some(n @ 1..=12), _) => F[n - 1],
            (_, 1) => Key::Unicode(lower.chars().next().unwrap()),
            _ => return Err(format!("unknown key: {name}").into()),
        },
    })
}

/// Perform the action. Zoom and read answer directly; everything else is followed by a fresh observation.
fn act(state: &mut State, action: Action) -> Result<Option<serde_json::Value>, Box<dyn Error>> {
    let settle = !matches!(action, Action::Screenshot | Action::Tree);
    match action {
        Action::Screenshot | Action::Tree => {}
        Action::Zoom { region } => return zoom(&state.display, region).map(Some),
        Action::Read { element, offset } => {
            let (backend, found) = lookup(state, element)?;
            let text = backend
                .text(found)
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
        Action::Type { text } => state.enigo.text(&text)?,
        Action::Key { keys, repeat } => {
            // Parse the whole chord before pressing anything.
            let keys = keys.split('+').map(parse_key).collect::<Result<Vec<_>, _>>()?;
            let (last, modifiers) = keys.split_last().ok_or("empty key chord")?;
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
    if settle {
        thread::sleep(SETTLE);
    }
    Ok(None)
}

/// Refresh the display mapping and describe the screen: a screenshot, or in tree mode the foreground window's tree.
fn observe(state: &mut State) -> Result<serde_json::Value, Box<dyn Error>> {
    let (display, image) = capture()?;
    state.display = display;
    match &mut state.tree {
        Some((backend, elements)) => {
            let (text, fresh) = tree::render(&backend.snapshot()?, &state.display);
            *elements = fresh;
            Ok(serde_json::json!({ "tree": format!("{text}{}", tree::windows(&state.display)?) }))
        }
        None => encode(&image),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    // Without per-monitor DPI awareness, Windows virtualizes coordinates under display scaling and
    // capture and input stop agreeing on pixel space.
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)?;
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
    let tree = if std::env::args().any(|arg| arg == "--tree") { Some((platform::Backend::new()?, Vec::new())) } else { None };
    let mut state = State { enigo: enigo?, display: capture()?.0, tree };
    let mut stdout = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let request: Request = serde_json::from_str(&line?)?;
        let result = act(&mut state, request.action).and_then(|zoomed| match zoomed {
            Some(zoomed) => Ok(zoomed),
            None => observe(&mut state),
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
