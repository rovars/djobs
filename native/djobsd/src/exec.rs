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

    let child = Command::new("sh")
        .args(["-c", cmd])
        .stdout(log_file.try_clone().map_err(|e| format!("dup stdout: {e}"))?)
        .stderr(log_file)
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;

    // Increment AFTER spawn succeeds — prevents counter drift if SIGCHLD
    // fires between fetch_add and spawn() completion.
    CHILD_COUNT.fetch_add(1, Ordering::SeqCst);
    log::info!("Exec: {cmd} (PID {})", child.id());
    Ok(())
}

/// Reap any terminated child processes (zombie cleanup).
/// Returns the number of children reaped.
/// Must be async-signal-safe — do NOT add logging here.
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

/// Log child reap count (only safe outside signal handler context).
pub fn log_reap_count(count: usize) {
    if count > 0 {
        log::info!("Reaped {count} child process(es), running: {}",
            CHILD_COUNT.load(Ordering::SeqCst));
    }
}
