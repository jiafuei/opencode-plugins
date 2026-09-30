use crate::{platform::Element, Display};
use std::{error::Error, fmt::Write};

const MAX_ELEMENTS: usize = 400;
const MAX_WINDOWS: usize = 20;
/// Labels of elements with children: their children carry the content, and web containers often repeat all of it.
const MAX_LABEL: usize = 80;
/// Leaf text (text runs, edit values, links). Only bounds pathological values such as a whole document in an editor.
const MAX_LEAF: usize = 2000;

/// One accessibility element as read from the platform backend. Rects are in OS input units.
pub struct Node {
    pub element: Element,
    pub role: String,
    pub name: String,
    pub value: Option<String>,
    /// `[x, y, width, height]`.
    pub rect: [f64; 4],
    pub states: Vec<&'static str>,
    /// Scrolled or collapsed out of view: skipped together with its subtree.
    pub hidden: bool,
    /// Layout-only container (pane, group); flattened into its parent when it has no name or value.
    pub structural: bool,
    pub children: Vec<Node>,
}

/// Render the roots as indented `[id] role "name" value="…" @(x,y wxh) states` lines in screenshot space. Returns the
/// text and the elements in ID order (ID = index + 1).
pub fn render(roots: &[Node], display: &Display) -> (String, Vec<Element>) {
    let mut out = String::new();
    let mut elements = Vec::new();
    for (index, root) in roots.iter().enumerate() {
        out.push_str(if index == 0 { "Foreground window:\n" } else { "Focused popup outside that window (e.g. an open menu):\n" });
        if !emit(root, 0, display, &mut out, &mut elements) {
            let _ = writeln!(out, "(truncated at {MAX_ELEMENTS} elements)");
            break;
        }
    }
    if roots.iter().any(empty_content) {
        out.push_str(
            "Note: some content areas are empty. Chrome, Edge and Electron apps build their accessibility tree on first \
             access, so a later computer_tree may show more.\n",
        );
    }
    (out, elements)
}

/// A visible, sizeable document or pane with no children, e.g. a Chromium page whose accessibility tree is still being
/// built. Small empty documents (hidden extension frames) don't count.
fn empty_content(node: &Node) -> bool {
    let [_, _, w, h] = node.rect;
    if node.hidden {
        return false;
    }
    let content = matches!(node.role.as_str(), "Document" | "Pane" | "WebArea");
    (content && node.children.is_empty() && w >= 50.0 && h >= 50.0) || node.children.iter().any(empty_content)
}

/// Returns false once the element cap is reached.
fn emit(node: &Node, depth: usize, display: &Display, out: &mut String, elements: &mut Vec<Element>) -> bool {
    if node.hidden {
        return true;
    }
    let [x, y, w, h] = node.rect;
    let flatten = w <= 0.0 || h <= 0.0 || (node.structural && node.name.is_empty() && node.value.is_none());
    let mut child_depth = depth;
    if !flatten {
        if elements.len() == MAX_ELEMENTS {
            return false;
        }
        elements.push(node.element.clone());
        // Clipped leaf text is content, so point at computer_read; clipped container labels repeat their children.
        let (max, more) = if node.children.is_empty() {
            (MAX_LEAF, format!("…(truncated; computer_read [{}])", elements.len()))
        } else {
            (MAX_LABEL, "…".to_string())
        };
        let factor = display.scale / display.input_per_pixel;
        let _ = write!(out, "{}[{}] {}", "  ".repeat(depth), elements.len(), node.role);
        if !node.name.is_empty() {
            let _ = write!(out, " \"{}\"", clip(&node.name, max, &more));
        }
        if let Some(value) = &node.value {
            let _ = write!(out, " value=\"{}\"", clip(value, max, &more));
        }
        let _ = write!(
            out,
            " @({},{} {}x{})",
            ((x - display.x) * factor).round(),
            ((y - display.y) * factor).round(),
            (w * factor).round(),
            (h * factor).round()
        );
        for state in &node.states {
            let _ = write!(out, " {state}");
        }
        out.push('\n');
        child_depth += 1;
    }
    node.children.iter().all(|child| emit(child, child_depth, display, out, elements))
}

/// Other visible top-level windows, so the model knows what it can switch to.
pub fn windows(display: &Display) -> Result<String, Box<dyn Error>> {
    let factor = display.scale / display.input_per_pixel;
    let mut out = String::from("Other windows:\n");
    for window in xcap::Window::all()? {
        let title = window.title().unwrap_or_default();
        if title.is_empty() || window.is_focused()? {
            continue;
        }
        // app_name fails for elevated processes; the title alone is still useful.
        let _ = write!(out, "- \"{}\" ({})", clip(&title, MAX_LABEL, "…"), window.app_name().unwrap_or_default());
        if window.is_minimized()? {
            out.push_str(" minimized\n");
        } else {
            let _ = writeln!(
                out,
                " @({},{} {}x{})",
                ((window.x()? as f64 - display.x) * factor).round(),
                ((window.y()? as f64 - display.y) * factor).round(),
                (window.width()? as f64 * factor).round(),
                (window.height()? as f64 * factor).round()
            );
        }
        if out.lines().count() > MAX_WINDOWS {
            break;
        }
    }
    Ok(out)
}

/// One line, at most `max` characters, with `more` appended when clipped.
fn clip(text: &str, max: usize, more: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.char_indices().nth(max) {
        Some((end, _)) => format!("{}{more}", &line[..end]),
        None => line,
    }
}
