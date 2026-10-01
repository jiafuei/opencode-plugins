use dispatch2::{run_on_main, MainThreadBound};
use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSColor, NSPanel, NSScreen, NSScreenSaverWindowLevel,
    NSWindowCollectionBehavior, NSWindowSharingType, NSWindowStyleMask,
};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::CGColor;
use objc2_foundation::NSString;
use objc2_quartz_core::{kCAAlignmentCenter, kCATruncationEnd, CALayer, CATextLayer, CATransaction};
use std::{error::Error, io::BufRead, thread};

struct Overlay {
    panel: Retained<NSPanel>,
    banner: Retained<CALayer>,
    text: Retained<CATextLayer>,
    width: f64,
    /// Bottom edge of the menu bar, in the panel's bottom-up coordinates.
    top: f64,
}

/// AppKit owns the main thread; a reader thread hands each line to it.
pub fn run() -> Result<(), Box<dyn Error>> {
    let mtm = MainThreadMarker::new().ok_or("the overlay must run on the main thread")?;
    let app = NSApplication::sharedApplication(mtm);
    // No Dock icon, and never activated: the overlay must not take focus from the app being controlled.
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    let overlay = MainThreadBound::new(create(mtm)?, mtm);
    thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(text) = line else { break };
            run_on_main(|mtm| show(overlay.get(mtm), &text));
        }
        std::process::exit(0);
    });
    app.run();
    Ok(())
}

fn create(mtm: MainThreadMarker) -> Result<Overlay, Box<dyn Error>> {
    // The first screen is the primary display.
    let screen = NSScreen::screens(mtm).firstObject().ok_or("no display")?;
    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        mtm.alloc(),
        frame,
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&*NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setIgnoresMouseEvents(true);
    // Above menus, Spotlight and full-screen apps, on every Space.
    panel.setLevel(NSScreenSaverWindowLevel);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    // Screen captures through CGWindowListCreateImage, as xcap takes them, leave the overlay out.
    panel.setSharingType(NSWindowSharingType::None);

    let accent = CGColor::new_srgb(1.0, 0.55, 0.16, 1.0);
    let root = CALayer::new();
    // A thin border along the screen edge whose shadow spreads into a glow.
    let glow = CALayer::new();
    glow.setFrame(CGRect::new(CGPoint::ZERO, frame.size));
    glow.setBorderWidth(3.0);
    glow.setBorderColor(Some(&*accent));
    glow.setShadowColor(Some(&*accent));
    glow.setShadowOpacity(1.0);
    glow.setShadowRadius(16.0);
    glow.setShadowOffset(CGSize::ZERO);
    root.addSublayer(&glow);
    let banner = CALayer::new();
    banner.setBackgroundColor(Some(&*CGColor::new_srgb(0.09, 0.09, 0.11, 0.9)));
    banner.setCornerRadius(9.0);
    let text = CATextLayer::new();
    text.setFontSize(13.0);
    text.setForegroundColor(Some(&*CGColor::new_srgb(1.0, 1.0, 1.0, 1.0)));
    text.setAlignmentMode(unsafe { kCAAlignmentCenter });
    text.setTruncationMode(unsafe { kCATruncationEnd });
    text.setContentsScale(screen.backingScaleFactor());
    banner.addSublayer(&text);
    root.addSublayer(&banner);
    let view = panel.contentView().ok_or("the overlay panel has no content view")?;
    // Setting the layer before enabling layers makes a layer-hosting view: AppKit leaves the sublayers alone.
    view.setLayer(Some(&*root));
    view.setWantsLayer(true);
    Ok(Overlay { panel, banner, text, width: frame.size.width, top: visible.origin.y + visible.size.height })
}

fn show(overlay: &Overlay, text: &str) {
    if text.is_empty() {
        overlay.panel.orderOut(None);
        return;
    }
    // Layer changes otherwise animate over a quarter second.
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    let string = NSString::from_str(text);
    let object: &AnyObject = &string;
    unsafe { overlay.text.setString(Some(object)) };
    let size = overlay.text.preferredFrameSize();
    let (pad_x, pad_y) = (14.0, 6.0);
    let text_size = CGSize::new(size.width.min(overlay.width / 2.0), size.height);
    let banner_size = CGSize::new(text_size.width + 2.0 * pad_x, text_size.height + 2.0 * pad_y);
    let origin = CGPoint::new((overlay.width - banner_size.width) / 2.0, overlay.top - banner_size.height - 8.0);
    overlay.banner.setFrame(CGRect::new(origin, banner_size));
    overlay.text.setFrame(CGRect::new(CGPoint::new(pad_x, pad_y), text_size));
    CATransaction::commit();
    overlay.panel.orderFrontRegardless();
}
