use std::process::Command;
use std::fs::OpenOptions;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const MAX_CHILDREN: usize = 8;
static CHILD_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Spawn a shell command in the background.
/// Logs stdout/stderr to `log_path`. Skips if MAX_CHILDREN reached.
pub fn spawn_command(cmd: &str, log_path: &Path) -> Result<(), String> {
    let count = CHILD_COUNT.load(Ordering::SeqCst);
    if count >= MAX_CHILDREN {
        log::warn!("Too many children ({count} >= {MAX_CHILDREN}), skipping: {cmd}");
        return Err("max children reached".into());
    }

    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| format!("cannot open log: {e}"))?;

    CHILD_COUNT.fetch_add(1, Ordering::SeqCst);

    match Command::new("sh")
        .args(["-c", cmd])
        .stdout(log_file.try_clone().map_err(|e| format!("dup stdout: {e}"))?)
        .stderr(log_file)
        .spawn()
    {
        Ok(child) => {
            log::info!("Exec: {cmd} (PID {})", child.id());
            Ok(())
        }
        Err(e) => {
            CHILD_COUNT.fetch_sub(1, Ordering::SeqCst);
            Err(format!("spawn failed: {e}"))
        }
    }
}

/// Reap any terminated child processes (zombie cleanup).
/// Returns the number of children reaped.
pub fn reap_children() -> usize {
    let mut count = 0;
    unsafe {
        let mut status: i32 = 0;
        while libc::waitpid(-1, &mut status, libc::WNOHANG) > 0 {
            count += 1;
        }
    }
    if count > 0 {
        CHILD_COUNT.fetch_sub(count, Ordering::SeqCst);
    }
    count
}
