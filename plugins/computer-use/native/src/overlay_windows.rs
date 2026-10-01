use std::{error::Error, ffi::c_void, io::BufRead, thread};
use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GdiFlush, GetDC, ReleaseDC,
    SelectObject, SetBkMode, SetTextColor, AC_SRC_ALPHA, AC_SRC_OVER, ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, BLENDFUNCTION, CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CALCRECT, DT_END_ELLIPSIS,
    DT_NOPREFIX, DT_SINGLELINE, FW_SEMIBOLD, HDC, OUT_DEFAULT_PRECIS, TRANSPARENT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetSystemMetrics, RegisterClassW,
    ShowWindow, UpdateLayeredWindow, MSG, SM_CXSCREEN, SM_CYSCREEN, SW_HIDE, SW_SHOWNOACTIVATE, ULW_ALPHA, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

const ACCENT: [f64; 3] = [255.0, 140.0, 40.0];
const BANNER: [f64; 3] = [23.0, 23.0, 28.0];
const BANNER_ALPHA: f64 = 0.9;
/// Depth of the edge glow, in 96-DPI pixels.
const GLOW: f64 = 20.0;

/// The window lives on the main thread, which only pumps messages; a reader thread redraws it for each line.
///
/// Screenshots include the overlay: Windows refuses display affinity (WDA_EXCLUDEFROMCAPTURE) for per-pixel
/// UpdateLayeredWindow windows, and a colour-keyed window that would accept it can't draw the glow.
pub fn run() -> Result<(), Box<dyn Error>> {
    unsafe {
        let instance = GetModuleHandleW(None)?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.into(),
            lpszClassName: w!("ComputerUseOverlay"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err(windows::core::Error::from_thread().into());
        }
        // The helper is per-monitor DPI aware, so these are physical pixels of the primary display.
        let (width, height) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        let hwnd = CreateWindowExW(
            // Per-pixel alpha, click-through, always on top, never activated, and not in Alt+Tab.
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            w!("ComputerUseOverlay"),
            w!(""),
            WS_POPUP,
            0,
            0,
            width,
            height,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        // HWND isn't Send; user32 accepts it from any thread.
        let handle = hwnd.0 as isize;
        thread::spawn(move || {
            let hwnd = HWND(handle as *mut c_void);
            let result = std::io::stdin().lock().lines().try_for_each(|line| update(hwnd, width, height, &line?));
            if let Err(error) = &result {
                eprintln!("computer-use overlay: {error}");
            }
            std::process::exit(result.is_err() as i32);
        });
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            DispatchMessageW(&message);
        }
    }
    Ok(())
}

unsafe extern "system" fn procedure(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn update(hwnd: HWND, width: i32, height: i32, text: &str) -> Result<(), Box<dyn Error>> {
    unsafe {
        if text.is_empty() {
            let _ = ShowWindow(hwnd, SW_HIDE);
            return Ok(());
        }
        let scale = GetDpiForWindow(hwnd) as f64 / 96.0;
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // Negative: rows run top-down.
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
        let previous = SelectObject(memory, bitmap.into());
        let banner = draw_text(memory, width, scale, text);
        // Premultiplied BGRA, i.e. 0xAARRGGBB per pixel. The text is white on black, so its brightness is its coverage.
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u32, (width * height) as usize);
        let coverage: Vec<f64> = (banner.top..banner.bottom)
            .flat_map(|y| (banner.left..banner.right).map(move |x| (y * width + x) as usize))
            .map(|index| (pixels[index] & 0xFF) as f64 / 255.0)
            .collect();
        pixels.fill(0);
        glow(pixels, width, height, scale);
        pill(pixels, width, banner, &coverage, scale);
        let size = SIZE { cx: width, cy: height };
        let origin = POINT::default();
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        let result = UpdateLayeredWindow(
            hwnd,
            Some(screen),
            None,
            Some(&size as *const SIZE),
            Some(memory),
            Some(&origin as *const POINT),
            COLORREF(0),
            Some(&blend as *const BLENDFUNCTION),
            ULW_ALPHA,
        );
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        result?;
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

/// Lay out the banner at the top center and draw its text white on black into the still empty bitmap. Returns the
/// banner rectangle.
fn draw_text(memory: HDC, width: i32, scale: f64, text: &str) -> RECT {
    let px = |value: f64| (value * scale).round() as i32;
    unsafe {
        // Grayscale antialiasing: ClearType's colored fringes would not work as coverage.
        let font = CreateFontW(
            -px(14.0),
            0,
            0,
            0,
            FW_SEMIBOLD.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            ANTIALIASED_QUALITY,
            0,
            w!("Segoe UI"),
        );
        let previous = SelectObject(memory, font.into());
        SetTextColor(memory, COLORREF(0x00FF_FFFF));
        SetBkMode(memory, TRANSPARENT);
        let mut text: Vec<u16> = text.encode_utf16().collect();
        let mut measured = RECT::default();
        DrawTextW(memory, &mut text, &mut measured, DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
        let text_width = measured.right.min(width / 2);
        let (pad_x, pad_y) = (px(14.0), px(6.0));
        let banner = RECT {
            left: (width - text_width) / 2 - pad_x,
            top: px(10.0),
            right: (width + text_width) / 2 + pad_x,
            bottom: px(10.0) + measured.bottom + 2 * pad_y,
        };
        let mut area = RECT { left: banner.left + pad_x, top: banner.top + pad_y, right: banner.right - pad_x, bottom: banner.bottom - pad_y };
        DrawTextW(memory, &mut text, &mut area, DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
        // GDI batches drawing; the bits are only complete after a flush.
        let _ = GdiFlush();
        SelectObject(memory, previous);
        let _ = DeleteObject(font.into());
        banner
    }
}

/// Accent at the screen edge, fading out over GLOW pixels.
fn glow(pixels: &mut [u32], width: i32, height: i32, scale: f64) {
    let depth = GLOW * scale;
    for y in 0..height {
        for x in 0..width {
            let distance = x.min(width - 1 - x).min(y).min(height - 1 - y) as f64;
            if distance < depth {
                let alpha = (1.0 - distance / depth).powi(2) * 0.85;
                pixels[(y * width + x) as usize] = pack(ACCENT.map(|channel| channel * alpha), alpha);
            }
        }
    }
}

/// The banner over the glow: a dark rounded rectangle with white text.
fn pill(pixels: &mut [u32], width: i32, banner: RECT, coverage: &[f64], scale: f64) {
    let radius = 9.0 * scale;
    let columns = banner.right - banner.left;
    let (w, h) = (columns as f64, (banner.bottom - banner.top) as f64);
    for (offset, &text) in coverage.iter().enumerate() {
        let (column, row) = (offset as i32 % columns, offset as i32 / columns);
        let (x, y) = (column as f64 + 0.5, row as f64 + 0.5);
        // Distance of the pixel center beyond the straight edges, inside a corner, for an antialiased rounded edge.
        let (dx, dy) = ((radius - x).max(x - (w - radius)).max(0.0), (radius - y).max(y - (h - radius)).max(0.0));
        let shape = (radius - (dx * dx + dy * dy).sqrt() + 0.5).clamp(0.0, 1.0);
        let background = BANNER_ALPHA * (1.0 - text);
        let alpha = (text + background) * shape;
        let color = BANNER.map(|channel| (255.0 * text + channel * background) * shape);
        let index = ((banner.top + row) * width + banner.left + column) as usize;
        // Source over the glow, both premultiplied.
        let below = pixels[index];
        let channel = |shift: u32| ((below >> shift) & 0xFF) as f64 * (1.0 - alpha);
        pixels[index] = pack(
            [color[0] + channel(16), color[1] + channel(8), color[2] + channel(0)],
            alpha + channel(24) / 255.0,
        );
    }
}

/// Premultiplied RGB (0–255) and alpha (0–1) as 0xAARRGGBB.
fn pack([r, g, b]: [f64; 3], alpha: f64) -> u32 {
    let byte = |value: f64| value.round().clamp(0.0, 255.0) as u32;
    byte(alpha * 255.0) << 24 | byte(r) << 16 | byte(g) << 8 | byte(b)
}
