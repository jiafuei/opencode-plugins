use crate::tree::Node;
use accessibility_sys::{
    kAXChildrenAttribute, kAXDescriptionAttribute, kAXEnabledAttribute, kAXErrorSuccess, kAXExpandedAttribute,
    kAXFocusedAttribute, kAXFocusedUIElementAttribute, kAXFocusedWindowAttribute, kAXFrontmostAttribute,
    kAXMainAttribute, kAXMinimizedAttribute, kAXParentAttribute, kAXPositionAttribute, kAXRaiseAction,
    kAXRoleAttribute, kAXSelectedAttribute, kAXSizeAttribute, kAXSubroleAttribute, kAXTitleAttribute,
    kAXValueAttribute, kAXValueTypeCGPoint, kAXValueTypeCGSize, kAXWindowsAttribute, AXUIElementCopyAttributeValue,
    AXUIElementCreateApplication, AXUIElementPerformAction, AXUIElementRef, AXUIElementSetAttributeValue,
    AXValueGetValue, AXValueRef, AXValueType,
};
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use std::{error::Error, ffi::c_void, process::Command, thread, time::Duration};

/// Upper bound on elements read per snapshot: every attribute is a cross-process call, and web views can be huge.
const MAX_VISITED: usize = 3000;

pub type Element = CFType;

pub struct Backend;

impl Backend {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        Ok(Self)
    }

    /// The window, or else the focused window of the frontmost app plus the open menu holding keyboard focus (menus
    /// are not part of the window on macOS).
    pub fn snapshot(&self, window: Option<&xcap::Window>) -> Result<Vec<Node>, Box<dyn Error>> {
        let mut visited = 0;
        if let Some(window) = window {
            let (_, window) = ax_window(window)?;
            return Ok(vec![node(&window, rect(&window).unwrap_or_default(), &mut visited)]);
        }
        let front = crate::front_window()?.ok_or("no app is frontmost")?;
        let app = application(front.pid()?);
        let window = attribute(&app, kAXFocusedWindowAttribute)
            .ok_or_else(|| format!("{} has no focused window", front.app_name().unwrap_or_default()))?;
        let mut roots = vec![node(&window, rect(&window).unwrap_or_default(), &mut visited)];
        let mut current = attribute(&app, kAXFocusedUIElementAttribute);
        while let Some(element) = current {
            if string(&element, kAXRoleAttribute) == "AXMenu" {
                roots.push(node(&element, rect(&element).unwrap_or_default(), &mut visited));
                break;
            }
            current = attribute(&element, kAXParentAttribute);
        }
        Ok(roots)
    }

    /// Current `[x, y, width, height]` in points (the input space on macOS).
    pub fn bounds(&self, element: &Element) -> Result<[f64; 4], Box<dyn Error>> {
        Ok(rect(element).ok_or("element has no position")?)
    }

    /// Full text: the string AXValue, AXTitle and AXDescription. An element without a role no longer exists.
    pub fn text(&self, element: &Element) -> Result<String, Box<dyn Error>> {
        if string(element, kAXRoleAttribute).is_empty() {
            return Err("element no longer exists".into());
        }
        let mut parts: Vec<String> = Vec::new();
        for part in [string(element, kAXValueAttribute), string(element, kAXTitleAttribute), string(element, kAXDescriptionAttribute)] {
            if !part.is_empty() && !parts.contains(&part) {
                parts.push(part);
            }
        }
        Ok(parts.join("\n"))
    }

    /// Role and name of the element with keyboard focus in the app owning the front window.
    pub fn focused(&self, front: Option<&xcap::Window>) -> Option<(String, String)> {
        let element = attribute(&application(front?.pid().ok()?), kAXFocusedUIElementAttribute)?;
        let title = string(&element, kAXTitleAttribute);
        let name = if title.is_empty() { string(&element, kAXDescriptionAttribute) } else { title };
        Some((string(&element, kAXRoleAttribute).trim_start_matches("AX").to_string(), name))
    }

    /// Give the element keyboard focus.
    pub fn focus(&self, element: &Element) -> Result<(), Box<dyn Error>> {
        if !set(element, kAXFocusedAttribute, CFBoolean::true_value()) {
            return Err("the element does not accept keyboard focus; click it instead".into());
        }
        Ok(())
    }

    /// Unminimize and raise the window, make its app frontmost, and wait until it is. macOS 14+ may ignore activation
    /// requested by a background process, so LaunchServices (`open` on the app bundle) is the fallback.
    pub fn raise(&self, window: &xcap::Window) -> Result<(), Box<dyn Error>> {
        let (app, target) = ax_window(window)?;
        set(&target, kAXMinimizedAttribute, CFBoolean::false_value());
        set(&target, kAXMainAttribute, CFBoolean::true_value());
        unsafe {
            AXUIElementPerformAction(target.as_CFTypeRef() as AXUIElementRef, CFString::new(kAXRaiseAction).as_concrete_TypeRef())
        };
        set(&app, kAXFrontmostAttribute, CFBoolean::true_value());
        if frontmost(window) {
            return Ok(());
        }
        // `ps` prints the executable path, e.g. /Applications/Slack.app/Contents/MacOS/Slack.
        let output = Command::new("ps").args(["-o", "comm=", "-p", &window.pid()?.to_string()]).output()?;
        let executable = String::from_utf8(output.stdout)?;
        if let Some(end) = executable.find(".app/") {
            Command::new("open").arg(&executable[..end + 4]).status()?;
            if frontmost(window) {
                return Ok(());
            }
        }
        Err(format!(
            "macOS did not bring \"{}\" ({}) to the front; click the window or its Dock icon instead",
            window.title()?,
            window.app_name().unwrap_or_default()
        )
        .into())
    }
}

/// Whether the window's app becomes frontmost within a second.
fn frontmost(window: &xcap::Window) -> bool {
    (0..10).any(|_| {
        let front = window.is_focused().unwrap_or(false);
        if !front {
            thread::sleep(Duration::from_millis(100));
        }
        front
    })
}

/// The app's accessibility element. Electron and Chromium apps (Slack, VS Code, Chrome) only build their tree for
/// clients that set AXManualAccessibility; other apps reject the attribute.
fn application(pid: u32) -> CFType {
    let app = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateApplication(pid as _) as CFTypeRef) };
    set(&app, "AXManualAccessibility", CFBoolean::true_value());
    app
}

/// The app element and the AX window matching an xcap window, by title.
fn ax_window(window: &xcap::Window) -> Result<(CFType, CFType), Box<dyn Error>> {
    let app = application(window.pid()?);
    let title = window.title()?;
    let windows = attribute(&app, kAXWindowsAttribute).and_then(|v| v.downcast::<CFArray>()).ok_or("the app lists no windows")?;
    let target = windows
        .iter()
        .map(|w| unsafe { CFType::wrap_under_get_rule(*w as CFTypeRef) })
        .find(|w| string(w, kAXTitleAttribute) == title)
        .ok_or("the window was not found in its app's accessibility windows")?;
    Ok((app, target))
}

/// Whether the app accepted the value.
fn set(element: &CFType, name: &str, value: CFBoolean) -> bool {
    let error = unsafe {
        AXUIElementSetAttributeValue(
            element.as_CFTypeRef() as AXUIElementRef,
            CFString::new(name).as_concrete_TypeRef(),
            value.as_CFTypeRef(),
        )
    };
    error == kAXErrorSuccess
}

/// `clip` is the root's rect: elements outside it are scrolled out of view.
fn node(element: &CFType, clip: [f64; 4], visited: &mut usize) -> Node {
    *visited += 1;
    let role = string(element, kAXRoleAttribute);
    let subrole = string(element, kAXSubroleAttribute);
    let flag = |name| attribute(element, name).and_then(|v| v.downcast::<CFBoolean>()).map(bool::from);
    let mut states = Vec::new();
    if flag(kAXEnabledAttribute) == Some(false) {
        states.push("disabled");
    }
    if flag(kAXFocusedAttribute) == Some(true) {
        states.push("focused");
    }
    if flag(kAXSelectedAttribute) == Some(true) {
        states.push("selected");
    }
    if flag(kAXExpandedAttribute) == Some(true) {
        states.push("expanded");
    }
    let rect = rect(element).unwrap_or_default();
    let mut children = Vec::new();
    if let Some(array) = attribute(element, kAXChildrenAttribute).and_then(|v| v.downcast::<CFArray>()) {
        for child in array.iter() {
            if *visited >= MAX_VISITED {
                break;
            }
            children.push(node(&unsafe { CFType::wrap_under_get_rule(*child as CFTypeRef) }, clip, visited));
        }
    }
    let title = string(element, kAXTitleAttribute);
    Node {
        element: element.clone(),
        role: if subrole.is_empty() {
            role.trim_start_matches("AX").to_string()
        } else {
            format!("{}:{}", role.trim_start_matches("AX"), subrole.trim_start_matches("AX"))
        },
        name: if title.is_empty() { string(element, kAXDescriptionAttribute) } else { title },
        value: attribute(element, kAXValueAttribute)
            .and_then(|v| {
                v.downcast::<CFString>()
                    .map(|s| s.to_string())
                    .or_else(|| v.downcast::<CFNumber>().and_then(|n| n.to_f64()).map(|n| n.to_string()))
            })
            .filter(|v| !v.is_empty()),
        rect,
        states,
        hidden: rect[0] + rect[2] <= clip[0]
            || rect[1] + rect[3] <= clip[1]
            || rect[0] >= clip[0] + clip[2]
            || rect[1] >= clip[1] + clip[3],
        structural: matches!(role.as_str(), "AXGroup" | "AXSplitGroup" | "AXScrollArea" | "AXLayoutArea" | "AXUnknown"),
        children,
    }
}

fn attribute(element: &CFType, name: &str) -> Option<CFType> {
    let mut value: CFTypeRef = std::ptr::null();
    let error = unsafe {
        AXUIElementCopyAttributeValue(
            element.as_CFTypeRef() as AXUIElementRef,
            CFString::new(name).as_concrete_TypeRef(),
            &mut value,
        )
    };
    (error == kAXErrorSuccess && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
}

fn string(element: &CFType, name: &str) -> String {
    attribute(element, name).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string()).unwrap_or_default()
}

/// AXPosition and AXSize, both `{f64, f64}` structs (CGPoint / CGSize).
fn rect(element: &CFType) -> Option<[f64; 4]> {
    let pair = |name, kind: AXValueType| {
        let value = attribute(element, name)?;
        let mut out = [0f64; 2];
        unsafe { AXValueGetValue(value.as_CFTypeRef() as AXValueRef, kind, out.as_mut_ptr() as *mut c_void) }.then_some(out)
    };
    let [x, y] = pair(kAXPositionAttribute, kAXValueTypeCGPoint)?;
    let [w, h] = pair(kAXSizeAttribute, kAXValueTypeCGSize)?;
    Some([x, y, w, h])
}
