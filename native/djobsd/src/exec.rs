use std::ffi::CString;
use std::fs::OpenOptions;
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const MAX_CHILDREN: usize = 8;
static CHILD_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Spawn a shell command as root via fork+exec, logging to log_path.
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
    let log_fd = log_file.as_raw_fd();

    let c_cmd = CString::new(cmd).map_err(|e| format!("invalid cmd: {e}"))?;
    let c_sh = CString::new("/system/bin/sh").map_err(|e| format!("invalid sh path: {e}"))?;
    let c_arg0 = CString::new("sh").unwrap();
    let c_arg1 = CString::new("-c").unwrap();

    // crond.c-style environment setup — must be declared before fork()
    let c_home = CString::new("HOME=/data/adb/dailyjobs").unwrap();
    let c_logname = CString::new("LOGNAME=root").unwrap();
    let c_user = CString::new("USER=root").unwrap();
    let c_shell = CString::new("SHELL=/system/bin/sh").unwrap();
    let c_path = CString::new("PATH=/data/adb/magisk:/data/adb/ksu/bin:/data/adb/ap/bin:/system/bin:/system/xbin").unwrap();

    unsafe {
        let pid = libc::fork();
        if pid < 0 {
            return Err(format!("fork failed: {}", std::io::Error::last_os_error()));
        }
        if pid == 0 {
            // Child: setuid/setgid to root, set environment, redirect stdio, exec
            libc::setuid(0);
            libc::setgid(0);
            libc::dup2(log_fd, 1);
            libc::dup2(log_fd, 2);
            libc::close(log_fd);
            libc::setsid();

            // Environment variables (per crond.c set_env_vars())
            libc::putenv(c_home.as_ptr() as *mut libc::c_char);
            libc::putenv(c_logname.as_ptr() as *mut libc::c_char);
            libc::putenv(c_user.as_ptr() as *mut libc::c_char);
            libc::putenv(c_shell.as_ptr() as *mut libc::c_char);
            libc::putenv(c_path.as_ptr() as *mut libc::c_char);

            let argv: [*const libc::c_char; 5] = [
                c_sh.as_ptr(),
                c_arg0.as_ptr(),
                c_arg1.as_ptr(),
                c_cmd.as_ptr(),
                std::ptr::null(),
            ];
            libc::execvp(c_sh.as_ptr(), argv.as_ptr());
            libc::_exit(127);
        }
        // Parent
        CHILD_COUNT.fetch_add(1, Ordering::SeqCst);
        log::info!("Exec: {cmd} (PID {pid})");
        Ok(())
    }
}

/// Reap terminated children. Async-signal-safe — no logging.
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

/// Log child reap count. Not signal-safe.
pub fn log_reap_count(count: usize) {
    if count > 0 {
        log::info!("Reaped {count} child process(es), running: {}",
            CHILD_COUNT.load(Ordering::SeqCst));
    }
}
