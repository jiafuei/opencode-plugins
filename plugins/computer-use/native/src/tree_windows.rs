use crate::tree::Node;
use std::error::Error;
use uiautomation::core::UICacheRequest;
use uiautomation::patterns::{UITextPattern, UIValuePattern};
use uiautomation::types::{ControlType, Handle, TreeScope, UIProperty};
use uiautomation::{UIAutomation, UIElement};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

pub type Element = UIElement;

pub struct Backend {
    automation: UIAutomation,
    /// Fetches the whole control-view subtree with the properties we render in one cross-process call.
    request: UICacheRequest,
}

impl Backend {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        let automation = UIAutomation::new()?;
        let request = automation.create_cache_request()?;
        for property in [
            UIProperty::Name,
            UIProperty::ControlType,
            UIProperty::BoundingRectangle,
            UIProperty::IsOffscreen,
            UIProperty::IsEnabled,
            UIProperty::HasKeyboardFocus,
            UIProperty::ValueValue,
            UIProperty::IsTogglePatternAvailable,
            UIProperty::IsExpandCollapsePatternAvailable,
            UIProperty::IsSelectionItemPatternAvailable,
            UIProperty::IsTextPatternAvailable,
            UIProperty::ToggleToggleState,
            UIProperty::SelectionItemIsSelected,
            UIProperty::ExpandCollapseExpandCollapseState,
        ] {
            request.add_property(property)?;
        }
        request.set_tree_scope(TreeScope::Subtree)?;
        Ok(Self { automation, request })
    }

    /// The foreground window, plus the top-level window holding keyboard focus when that is a separate popup such as
    /// an open menu.
    pub fn snapshot(&self) -> Result<Vec<Node>, Box<dyn Error>> {
        let handle = Handle::from(unsafe { GetForegroundWindow() });
        let foreground = self.automation.element_from_handle_build_cache(handle, &self.request)?;
        let mut roots = vec![node(&foreground, &self.request)];
        let root = self.automation.get_root_element()?;
        let walker = self.automation.get_control_view_walker()?;
        if let Ok(mut top) = self.automation.get_focused_element() {
            while let Ok(parent) = walker.get_parent(&top) {
                if self.automation.compare_elements(&parent, &root)? {
                    break;
                }
                top = parent;
            }
            if !self.automation.compare_elements(&top, &foreground)? && !self.automation.compare_elements(&top, &root)? {
                roots.push(node(&top.build_updated_cache(&self.request)?, &self.request));
            }
        }
        Ok(roots)
    }

    /// Current `[x, y, width, height]` in physical pixels (the helper is per-monitor DPI aware).
    pub fn bounds(&self, element: &Element) -> Result<[f64; 4], Box<dyn Error>> {
        let rect = element.get_bounding_rectangle()?;
        Ok([rect.get_left() as f64, rect.get_top() as f64, rect.get_width() as f64, rect.get_height() as f64])
    }

    /// Full text: the whole Text-pattern document (terminal and editor buffers, browser documents) when supported,
    /// otherwise the name and value.
    pub fn text(&self, element: &Element) -> Result<String, Box<dyn Error>> {
        let name = element.get_name()?;
        if let Ok(pattern) = element.get_pattern::<UITextPattern>() {
            return Ok(pattern.get_document_range()?.get_text(-1)?);
        }
        let value = element.get_pattern::<UIValuePattern>().and_then(|p| p.get_value()).unwrap_or_default();
        Ok([name, value].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n"))
    }
}

fn node(element: &UIElement, request: &UICacheRequest) -> Node {
    let control = element.get_cached_control_type().ok();
    let rect = element.get_cached_bounding_rectangle().unwrap_or_default();
    let property = |id: UIProperty| element.get_cached_property_value(id).ok();
    let flag = |id| property(id).and_then(|v| TryInto::<bool>::try_into(&v).ok()) == Some(true);
    let number = |id| property(id).and_then(|v| TryInto::<i32>::try_into(&v).ok());
    let mut states = Vec::new();
    if !element.is_cached_enabled().unwrap_or(true) {
        states.push("disabled");
    }
    if element.has_cached_keyboard_focus().unwrap_or(false) {
        states.push("focused");
    }
    // Pattern properties of elements without the pattern hold a "not supported" sentinel, so check availability first.
    if flag(UIProperty::IsSelectionItemPatternAvailable) && flag(UIProperty::SelectionItemIsSelected) {
        states.push("selected");
    }
    if flag(UIProperty::IsTextPatternAvailable) {
        states.push("text");
    }
    if flag(UIProperty::IsTogglePatternAvailable) {
        match number(UIProperty::ToggleToggleState) {
            Some(0) => states.push("unchecked"),
            Some(1) => states.push("checked"),
            Some(2) => states.push("mixed"),
            _ => {}
        }
    }
    if flag(UIProperty::IsExpandCollapsePatternAvailable) {
        match number(UIProperty::ExpandCollapseExpandCollapseState) {
            Some(0) => states.push("collapsed"),
            Some(1) => states.push("expanded"),
            _ => {}
        }
    }
    Node {
        element: element.clone(),
        role: control.map(|c| format!("{c:?}")).unwrap_or_else(|| "Unknown".into()),
        name: element.get_cached_name().unwrap_or_default(),
        value: property(UIProperty::ValueValue).and_then(|v| v.get_string().ok()).filter(|v| !v.is_empty()),
        rect: [rect.get_left() as f64, rect.get_top() as f64, rect.get_width() as f64, rect.get_height() as f64],
        states,
        hidden: element.is_cached_offscreen().unwrap_or(false),
        structural: matches!(control, Some(ControlType::Pane | ControlType::Group | ControlType::Custom)),
        children: children(element, control, request).iter().map(|child| node(child, request)).collect(),
    }
}

/// A leaf's cached child array is empty or null; both mean no children. Browser documents are separate providers the
/// window's cached subtree stops at, so their content is fetched with a second cached request rooted at the document.
fn children(element: &UIElement, control: Option<ControlType>, request: &UICacheRequest) -> Vec<UIElement> {
    let cached = element.get_cached_children().unwrap_or_default();
    if !cached.is_empty() || control != Some(ControlType::Document) {
        return cached;
    }
    element.build_updated_cache(request).and_then(|document| document.get_cached_children()).unwrap_or_default()
}
