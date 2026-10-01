//! A glowing border and a status banner on the primary display while OpenCode controls the computer. The overlay is a
//! separate process (this binary started with `--overlay`), so its window event loop never blocks requests. It reads
//! one banner text per line on stdin, hides on an empty line, and exits when stdin closes, i.e. with the helper.

use std::error::Error;
use std::io::Write;
use std::process::{ChildStdin, Command, Stdio};

#[cfg(target_os = "macos")]
#[path = "overlay_macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "overlay_windows.rs"]
mod platform;

pub use platform::run;

#[derive(Default)]
pub struct Overlay {
    stdin: Option<ChildStdin>,
    text: String,
}

impl Overlay {
    /// Show the text in the banner, or hide the overlay when it is empty. The overlay process starts on the first show.
    pub fn set(&mut self, text: &str) -> Result<(), Box<dyn Error>> {
        let text = text.replace('\n', " ");
        if text == self.text {
            return Ok(());
        }
        let mut stdin = match self.stdin.take() {
            Some(stdin) => stdin,
            None => {
                let mut command = Command::new(std::env::current_exe()?);
                // stdout carries the helper's responses, so the overlay must not write to it.
                command.arg("--overlay").stdin(Stdio::piped()).stdout(Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                    command.creation_flags(CREATE_NO_WINDOW);
                }
                command.spawn()?.stdin.take().ok_or("the overlay process has no stdin")?
            }
        };
        writeln!(stdin, "{text}").map_err(|error| format!("the overlay process exited: {error}"))?;
        self.stdin = Some(stdin);
        self.text = text;
        Ok(())
    }
}
