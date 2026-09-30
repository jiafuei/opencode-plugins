use crate::tree::Node;
use accessibility_sys::{
    kAXChildrenAttribute, kAXDescriptionAttribute, kAXEnabledAttribute, kAXErrorSuccess, kAXExpandedAttribute,
    kAXFocusedApplicationAttribute, kAXFocusedAttribute, kAXFocusedUIElementAttribute, kAXFocusedWindowAttribute,
    kAXParentAttribute, kAXPositionAttribute, kAXRoleAttribute, kAXSelectedAttribute, kAXSizeAttribute,
    kAXSubroleAttribute, kAXTitleAttribute, kAXValueAttribute, kAXValueTypeCGPoint, kAXValueTypeCGSize,
    AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide, AXUIElementRef, AXValueGetValue, AXValueRef, AXValueType,
};
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use std::{error::Error, ffi::c_void};

/// Upper bound on elements read per snapshot: every attribute is a cross-process call, and web views can be huge.
const MAX_VISITED: usize = 3000;

pub type Element = CFType;

pub struct Backend {
    system: CFType,
}

impl Backend {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        Ok(Self { system: unsafe { CFType::wrap_under_create_rule(AXUIElementCreateSystemWide() as CFTypeRef) } })
    }

    /// The focused window of the frontmost app, plus the open menu holding keyboard focus (menus are not part of the
    /// window on macOS).
    pub fn snapshot(&self) -> Result<Vec<Node>, Box<dyn Error>> {
        let app = attribute(&self.system, kAXFocusedApplicationAttribute).ok_or("no focused application")?;
        let window = attribute(&app, kAXFocusedWindowAttribute).ok_or("the focused application has no focused window")?;
        let mut visited = 0;
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
