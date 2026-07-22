# djobsd Rewrite: Rust crond with Deep-Sleep Wake-up

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite djobsd to be a faithful Rust port of BusyBox crond.c, adding timerfd CLOCK_REALTIME_ALARM for deep-sleep wake-up on Android.

**Architecture:** Port crond.c's parsing, FixDayDow, matching (OR for dom/dow), and job state machine to Rust. Add timerfd-based epoll event loop for deep-sleep safe scheduling. Keep single config file (not per-user crontabs) since all commands run as root on Android.

**Tech Stack:** Rust, libc (fork/exec/timerfd/epoll/signal), clap (CLI args), env_logger

## Global Constraints

- Target: Android (aarch64/arm), KernelSU/Magisk/APatch module
- Daemon runs as root (UID 0)
- Binary size target: ~64KB (opt-level="z", LTO, strip)
- Config: single file at `/data/adb/dailyjobs/config.txt` (5-field cron)
- Deep-sleep: timerfd CLOCK_REALTIME_ALARM + epoll_wait(-1)
- Child processes: fork+execvp with setuid(0)/setgid(0), setsid()
- MAX_CHILDREN=8 fork bomb guard
- SIGHUP config hot-reload via self-pipe trick
- Log to `/data/adb/dailyjobs/run.log`
- 11 existing tests must continue passing

## File Structure

| File | Responsibility |
|------|---------------|
| `native/djobsd/src/config.rs` | Cron parsing: fields, FixDayDow, month abbreviations, step syntax, @reboot |
| `native/djobsd/src/exec.rs` | fork+exec child spawning, zombie reaping, environment setup |
| `native/djobsd/src/main.rs` | Event loop: timerfd, epoll, signal handling, job scheduling state machine |
| `native/djobsd/Cargo.toml` | Dependencies (libc, clap, log, env_logger) |
| `module/config.txt` | User-facing config with examples |
| `module/djobs.service` | Service control script |

---

### Task 1: Rewrite config.rs — Cron Field Parsing

**Covers:** FixDayDow, month abbreviations, step syntax N/M, comma lists

**Files:**
- Modify: `native/djobsd/src/config.rs`

**Interfaces:**
- Produces: `parse_cron_field()`, `parse_cron_line()`, `CronTask` struct

- [ ] **Step 1: Write tests for new parsing features**

Add to `config.rs` tests module:

```rust
#[test]
fn test_parse_field_step_range() {
    // N/M syntax: start at N, step M
    let bits: [bool; 60] = parse_cron_field("1/15", 0).unwrap();
    assert!(bits[1] && bits[16] && bits[31] && bits[46]);
    assert!(!bits[0] && !bits[15]);
}

#[test]
fn test_parse_month_abbrev() {
    let task = parse_cron_line("0 0 1 jan,mar * /bin/true").unwrap();
    assert!(task.month[0]);  // jan = 0
    assert!(task.month[2]);  // mar = 2
    assert!(!task.month[1]); // feb not set
}

#[test]
fn test_parse_dow_abbrev() {
    let task = parse_cron_line("0 0 * * mon,wed,fri /bin/true").unwrap();
    assert!(task.dow[1]); // mon = 1
    assert!(task.dow[3]); // wed = 3
    assert!(task.dow[5]); // fri = 5
    assert!(!task.dow[0]); // sun not set
}

#[test]
fn test_fix_day_dow_dom_wildcard() {
    // "0 0 * * 1" — every day, Monday only → dom cleared, dow kept
    let task = parse_cron_line("0 0 * * 1 /bin/true").unwrap();
    assert!(task.dom.iter().all(|&b| !b)); // dom cleared
    assert!(task.dow[1]); // dow kept
}

#[test]
fn test_fix_day_dow_dow_wildcard() {
    // "0 0 15 * *" — day 15, every dow → dow cleared, dom kept
    let task = parse_cron_line("0 0 15 * * /bin/true").unwrap();
    assert!(task.dom[14]); // day 15
    assert!(task.dow.iter().all(|&b| !b)); // dow cleared
}

#[test]
fn test_fix_day_dow_both_specific() {
    // "0 0 1,15 * 1" — 1st/15th, Monday → both kept
    let task = parse_cron_line("0 0 1,15 * 1 /bin/true").unwrap();
    assert!(task.dom[0]); // day 1
    assert!(task.dom[14]); // day 15
    assert!(task.dow[1]); // Monday
}

#[test]
fn test_parse_at_reboot() {
    let task = parse_cron_line("@reboot /bin/true").unwrap();
    assert!(task.reboot);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd native/djobsd && cargo test`
Expected: FAIL — `parse_cron_field` doesn't handle N/M, no month/dow abbrevs, no FixDayDow

- [ ] **Step 3: Rewrite config.rs**

Replace the full `config.rs` with crond.c-aligned implementation:

```rust
use std::collections::HashMap;
use std::ffi::CString;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TASKS: usize = 256;

#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::Io(e) => write!(f, "IO error: {e}"),
        }
    }
}

impl From<std::io::Error> for ConfigError {
    fn from(e: std::io::Error) -> Self { ConfigError::Io(e) }
}

static MONTH_NAMES: &[&str] = &[
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
];

static DOW_NAMES: &[&str] = &[
    "sun", "mon", "tue", "wed", "thu", "fri", "sat",
];

/// Bitmask-based cron task — matches crond.c CronLine
#[derive(Debug, Clone)]
pub struct CronTask {
    pub minute: [bool; 60],
    pub hour: [bool; 24],
    pub dom: [bool; 32],    // 1-31, index 0 unused
    pub month: [bool; 12],  // 0-11
    pub dow: [bool; 7],     // 0-6 (sun=0)
    pub command: String,
    pub reboot: bool,
}

impl CronTask {
    fn wildcard() -> Self {
        CronTask {
            minute: [true; 60],
            hour: [true; 24],
            dom: [true; 32],
            month: [true; 12],
            dow: [true; 7],
            command: String::new(),
            reboot: false,
        }
    }
}

#[derive(Debug)]
pub struct Config {
    pub tasks: Vec<CronTask>,
}

/// Resolve a name (month/dow abbreviation) to its index, or None.
fn resolve_name(field: &str, names: &[&str]) -> Option<usize> {
    names.iter().position(|&n| n == field)
}

/// Parse a single cron field into a bitmask array.
/// Supports: *, */N, N-M, N/M, N-M/S, N,S, name abbreviations.
/// base: 0 for minute/hour/dow, 1 for dom/month.
fn parse_cron_field<const N: usize>(field: &str, base: u8, names: &[&str]) -> Result<[bool; N], String> {
    let mut bits = [false; N];

    // Check for name abbreviations (month/dow)
    let field_lower = field.to_lowercase();

    if field == "*" {
        for b in &mut bits { *b = true; }
        return Ok(bits);
    }

    // Handle */N or */N/S (step only)
    if field.len() > 2 && &field[..2] == "*/" {
        let rest = &field[2..];
        let step: usize = if let Some(slash) = rest.find('/') {
            rest[..slash].parse().map_err(|_| format!("invalid step: {field}"))?
        } else {
            rest.parse().map_err(|_| format!("invalid step: {field}"))?
        };
        if step == 0 { return Err("step cannot be 0".into()); }
        for i in (0..N).step_by(step) { bits[i] = true; }
        return Ok(bits);
    }

    for token in field_lower.split(',') {
        // Try name first (e.g. "jan", "mon")
        if let Some(idx) = resolve_name(token, names) {
            let adjusted = if base > 0 { idx } else { idx };
            if adjusted < N { bits[adjusted] = true; }
            continue;
        }

        // Try N/M or N-M/S step syntax
        if let Some(slash_pos) = token.find('/') {
            let range_part = &token[..slash_pos];
            let step: usize = token[slash_pos+1..].parse()
                .map_err(|_| format!("invalid step in: {token}"))?;
            if step == 0 { return Err("step cannot be 0".into()); }

            if range_part == "*" {
                for i in (0..N).step_by(step) { bits[i] = true; }
            } else if let Some(dash_pos) = range_part.find('-') {
                let lo: usize = range_part[..dash_pos].parse()
                    .map_err(|_| format!("invalid range: {range_part}"))?;
                let hi: usize = range_part[dash_pos+1..].parse()
                    .map_err(|_| format!("invalid range: {range_part}"))?;
                let lo = lo.saturating_sub(base as usize);
                let hi = std::cmp::min(hi.saturating_sub(base as usize), N - 1);
                for i in (lo..=hi).step_by(step) { bits[i] = true; }
            } else {
                return Err(format!("invalid step range: {token}"));
            }
            continue;
        }

        // Try N-M range
        if let Some(dash_pos) = token.find('-') {
            let lo: usize = token[..dash_pos].parse()
                .map_err(|_| format!("invalid range: {token}"))?;
            let hi: usize = token[dash_pos+1..].parse()
                .map_err(|_| format!("invalid range: {token}"))?;
            let lo = lo.saturating_sub(base as usize);
            let hi = std::cmp::min(hi.saturating_sub(base as usize), N - 1);
            for i in lo..=hi { bits[i] = true; }
            continue;
        }

        // Single value
        let v: usize = token.parse().map_err(|_| format!("invalid value: {token}"))?;
        let idx = v.saturating_sub(base as usize);
        if idx < N { bits[idx] = true; }
    }

    Ok(bits)
}

/// FixDayDow: if only one of dom/dow is wildcard, clear the other.
/// Matches crond.c FixDayDow().
fn fix_day_dow(task: &mut CronTask) {
    let dom_wildcard = task.dom[1..].iter().all(|&b| b);
    let dow_wildcard = task.dow.iter().all(|&b| b);

    if dom_wildcard != dow_wildcard {
        if dom_wildcard {
            // dow is specific → clear dom
            task.dom = [false; 32];
        } else {
            // dom is specific → clear dow
            task.dow = [false; 7];
        }
    }
}

/// Parse a 5-field cron line into CronTask.
pub fn parse_cron_line(line: &str) -> Result<CronTask, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return Err("skip".into());
    }

    // Strip inline comment
    let line_no_comment = trimmed.split('#').next().unwrap_or("").trim();
    if line_no_comment.is_empty() {
        return Err("skip".into());
    }

    // Handle @reboot
    if line_no_comment.starts_with("@reboot") {
        let cmd = line_no_comment["@reboot".len()..].trim();
        if cmd.is_empty() { return Err("skip".into()); }
        let mut task = CronTask::wildcard();
        task.command = cmd.to_string();
        task.reboot = true;
        return Ok(task);
    }

    let fields: Vec<&str> = line_no_comment.split_whitespace().collect();
    if fields.len() < 6 {
        return Err(format!("expected 5 cron fields + command, got {} fields", fields.len()));
    }

    let mut task = CronTask::wildcard();
    task.minute = parse_cron_field(fields[0], 0, &[])?;
    task.hour   = parse_cron_field(fields[1], 0, &[])?;
    task.dom    = parse_cron_field(fields[2], 1, &[])?;
    task.month  = parse_cron_field(fields[3], 1, MONTH_NAMES)?;
    task.dow    = parse_cron_field(fields[4], 0, DOW_NAMES)?;

    fix_day_dow(&mut task);

    task.command = line_no_comment.split_whitespace().skip(5).collect::<Vec<_>>().join(" ");
    Ok(task)
}

pub fn load_config(path: &Path) -> Result<Config, ConfigError> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut tasks = Vec::new();

    for (i, line) in reader.lines().enumerate() {
        let line = line?;
        if tasks.len() >= MAX_TASKS { break; }
        match parse_cron_line(&line) {
            Ok(task) => tasks.push(task),
            Err(ref e) if e == "skip" => {},
            Err(e) => { log::warn!("Config skip line {}: {}", i + 1, e); }
        }
    }

    Ok(Config { tasks })
}

/// Check if a task matches the given broken-down time.
/// Uses OR for dom/dow per crond.c logic.
pub fn cron_matches(task: &CronTask, minute: usize, hour: usize, dom: usize,
                    month: usize, dow: usize) -> bool {
    if task.minute[minute] && task.hour[hour] && task.month[month] {
        // dom and dow use OR logic per crond.c
        task.dom[dom] || task.dow[dow]
    } else {
        false
    }
}

/// Find the next future time where any task matches. Iterates up to 30 days.
pub fn find_next_task(tasks: &[CronTask], after: i64) -> Option<i64> {
    if tasks.is_empty() { return None; }

    // Check for @reboot tasks on first call (after == 0)
    if after == 0 {
        for task in tasks {
            if task.reboot {
                return Some(0);
            }
        }
    }

    let mut probe = after;

    for _days in 0..30 {
        let local_time: libc::time_t = probe as libc::time_t;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        unsafe { libc::localtime_r(&local_time as *const libc::time_t, &mut tm); }

        let start_h = tm.tm_hour as usize;
        for h in start_h..24 {
            tm.tm_hour = h as i32;
            let start_m = if h == start_h { (tm.tm_min + 1) as usize } else { 0 };

            for m in start_m..60 {
                tm.tm_min = m as i32;
                tm.tm_sec = 0;
                tm.tm_isdst = -1;
                let ts = unsafe { libc::mktime(&mut tm) };
                if ts == -1 { continue; }
                if ts as i64 <= after { continue; }

                let dow = tm.tm_wday as usize;
                let month = tm.tm_mon as usize;
                let dom = tm.tm_mday as usize;  // 1-31

                for task in tasks {
                    if !task.reboot && cron_matches(task, m, h, dom, month, dow) {
                        return Some(ts as i64);
                    }
                }
            }
        }

        // Move to next day — DST-safe via mktime normalization
        tm.tm_hour = 0;
        tm.tm_min = 0;
        tm.tm_sec = 0;
        tm.tm_mday += 1;
        tm.tm_isdst = -1;
        probe = unsafe { libc::mktime(&mut tm) } as i64;
        if probe < 0 { break; }
    }
    None
}

pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native/djobsd && cargo test`
Expected: PASS — all 11 existing tests + 7 new tests

- [ ] **Step 5: Commit**

```bash
git add native/djobsd/src/config.rs
git commit -m "refactor(config): port crond.c parsing — FixDayDow, month abbrevs, N/M steps, @reboot"
```

---

### Task 2: Rewrite exec.rs — Environment Setup

**Covers:** Child process spawning with proper environment (HOME, LOGNAME, PATH, SHELL)

**Files:**
- Modify: `native/djobsd/src/exec.rs`

**Interfaces:**
- Consumes: `CronTask.command`
- Produces: `spawn_command()`, `reap_children()`, `log_reap_count()`

- [ ] **Step 1: Rewrite exec.rs with environment setup**

```rust
use std::ffi::CString;
use std::fs::OpenOptions;
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const MAX_CHILDREN: usize = 8;
static CHILD_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Spawn a shell command as root via fork+exec, with crond.c-style env setup.
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
    let c_sh = CString::new("/system/bin/sh").map_err(|e| format!("invalid sh: {e}"))?;
    let c_arg0 = CString::new("sh").unwrap();
    let c_arg1 = CString::new("-c").unwrap();

    // Environment variables per crond.c set_env_vars()
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
            // Child: set identity, env, stdio, exec
            libc::setuid(0);
            libc::setgid(0);
            libc::setsid();

            // Set environment per crond.c set_env_vars()
            libc::putenv(c_home.as_ptr() as *mut libc::c_char);
            libc::putenv(c_logname.as_ptr() as *mut libc::c_char);
            libc::putenv(c_user.as_ptr() as *mut libc::c_char);
            libc::putenv(c_shell.as_ptr() as *mut libc::c_char);
            libc::putenv(c_path.as_ptr() as *mut libc::c_char);

            // Redirect stdout/stderr to log
            libc::dup2(log_fd, 1);
            libc::dup2(log_fd, 2);
            libc::close(log_fd);

            // exec: sh -c "cmd"
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

/// Reap terminated children. Async-signal-safe.
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
```

- [ ] **Step 2: Run tests**

Run: `cd native/djobsd && cargo test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add native/djobsd/src/exec.rs
git commit -m "refactor(exec): add crond.c env setup — HOME, LOGNAME, USER, SHELL, PATH"
```

---

### Task 3: Rewrite main.rs — crond.c Job State Machine

**Covers:** Job lifecycle (START_ME_REBOOT, START_ME_NORMAL, running, dormant), flag_starting_jobs, check_completions

**Files:**
- Modify: `native/djobsd/src/main.rs`

**Interfaces:**
- Consumes: `Config`, `CronTask`, `cron_matches()`, `find_next_task()`, `spawn_command()`, `reap_children()`

- [ ] **Step 1: Rewrite main.rs with crond.c job state machine**

```rust
mod config;
mod exec;

use clap::Parser;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::Duration;

// Job states per crond.c
const START_ME_REBOOT: i32 = -2;
const START_ME_NORMAL: i32 = -1;

fn close_fd(fd: i32) {
    if fd >= 0 { unsafe { libc::close(fd) }; }
}

fn drain_sigchld() {
    if SIGCHLD_PENDING.swap(false, Ordering::SeqCst) {
        let n = exec::reap_children();
        exec::log_reap_count(n);
    }
}

/// DailyJobs cron scheduler daemon — Rust port of crond.c + deep-sleep wake-up
#[derive(Parser)]
#[command(version = "4.0.0", about = None)]
struct Args {
    #[arg(short, long, default_value = "/data/adb/dailyjobs/config.txt")]
    config: PathBuf,

    #[arg(short, long, default_value_t = 900)]
    poll: u64,

    #[arg(short = 'L', long, default_value = "/data/adb/dailyjobs/run.log")]
    log_file: PathBuf,
}

static RUNNING: AtomicBool = AtomicBool::new(true);
static SIGHUP_PIPE_WRITE: AtomicI32 = AtomicI32::new(-1);
static SIGCHLD_PENDING: AtomicBool = AtomicBool::new(false);

unsafe extern "C" fn signal_handler(sig: i32) {
    match sig {
        libc::SIGHUP => {
            let fd = SIGHUP_PIPE_WRITE.load(Ordering::SeqCst);
            if fd >= 0 {
                let val: u8 = 0;
                let _ = libc::write(fd, &val as *const u8 as *const libc::c_void, 1);
            }
        }
        libc::SIGINT | libc::SIGTERM => {
            RUNNING.store(false, Ordering::SeqCst);
        }
        libc::SIGCHLD => {
            SIGCHLD_PENDING.store(true, Ordering::SeqCst);
        }
        _ => {}
    }
}

fn set_signal(sig: i32, handler: unsafe extern "C" fn(i32)) {
    unsafe {
        let mut sa: libc::sigaction = std::mem::zeroed();
        libc::sigemptyset(&mut sa.sa_mask);
        #[cfg(target_os = "linux")]
        {
            sa.sa_flags = libc::SA_RESTART;
            if sig == libc::SIGCHLD {
                sa.sa_flags |= libc::SA_NOCLDSTOP;
            }
        }
        sa.sa_sigaction = handler as usize;
        libc::sigaction(sig, &sa, std::ptr::null_mut());
    }
}

fn set_tz_from_getprop() {
    use std::process::Command;
    let output = Command::new("/system/bin/getprop")
        .arg("persist.sys.timezone")
        .output();
    if let Ok(out) = output {
        if out.status.success() {
            let tz = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !tz.is_empty() {
                std::env::set_var("TZ", &tz);
                extern "C" { fn tzset(); }
                unsafe { tzset(); }
                log::info!("Set TZ={tz}");
            }
        }
    }
}

/// Execute tasks that match the given timestamp.
fn execute_at(tasks: &[config::CronTask], ts: i64, log_path: &PathBuf) {
    let t = ts as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&t as *const libc::time_t, &mut tm); }
    let mut executed = 0;
    for task in tasks {
        if task.reboot { continue; }
        if config::cron_matches(
            task,
            tm.tm_min as usize,
            tm.tm_hour as usize,
            tm.tm_mday as usize,
            tm.tm_mon as usize,
            tm.tm_wday as usize,
        ) {
            log::info!("Task due: {}", task.command);
            if let Err(e) = exec::spawn_command(&task.command, log_path) {
                log::warn!("Failed to spawn task \"{}\": {e}", task.command);
            }
            executed += 1;
        }
    }
    if executed > 0 {
        log::info!("Executed {executed} task(s)");
    }
}

/// Execute due tasks checking each minute from last_check to now.
fn execute_due_tasks(
    tasks: &[config::CronTask],
    last_check: &mut i64,
    now: i64,
    log_path: &PathBuf,
) {
    if *last_check == 0 {
        *last_check = now;
        execute_at(tasks, now, log_path);
        return;
    }

    let mut check = (*last_check / 60 + 1) * 60;
    let end = now - (now % 60);
    if check > end { return; }

    while check <= end {
        execute_at(tasks, check, log_path);
        check += 60;
    }
    *last_check = now;
}

/// Arm timerfd for the next task time (deep-sleep safe).
fn arm_timerfd(epoll_fd: i32, target_ts: i64) -> Option<i32> {
    let now = config::now_ts();
    let remaining = std::cmp::max(target_ts - now, 5);

    let tfd = unsafe {
        libc::timerfd_create(libc::CLOCK_REALTIME_ALARM, libc::TFD_NONBLOCK | libc::TFD_CLOEXEC)
    };
    if tfd < 0 {
        log::warn!("CLOCK_REALTIME_ALARM unavailable, fallback CLOCK_REALTIME");
    }
    let tfd = if tfd >= 0 {
        tfd
    } else {
        unsafe { libc::timerfd_create(libc::CLOCK_REALTIME, libc::TFD_NONBLOCK | libc::TFD_CLOEXEC) }
    };
    if tfd < 0 {
        log::error!("timerfd_create failed");
        return None;
    }

    let mut spec: libc::itimerspec = unsafe { std::mem::zeroed() };
    spec.it_value.tv_sec = target_ts as libc::time_t;
    let flags = libc::TFD_TIMER_ABSTIME;

    if unsafe { libc::timerfd_settime(tfd, flags, &spec, std::ptr::null_mut()) } < 0 {
        spec.it_value.tv_sec = remaining as libc::time_t;
        if unsafe { libc::timerfd_settime(tfd, 0, &spec, std::ptr::null_mut()) } < 0 {
            log::error!("timerfd_settime failed");
            close_fd(tfd);
            return None;
        }
    }

    let mut ev: libc::epoll_event = libc::epoll_event {
        events: libc::EPOLLIN as u32,
        u64: tfd as u64,
    };
    if unsafe { libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_ADD, tfd, &mut ev) } < 0 {
        log::error!("epoll_ctl ADD failed");
        close_fd(tfd);
        return None;
    }

    log::info!("Timer armed: +{remaining}s (target: {target_ts})");
    Some(tfd)
}

fn main() {
    let args = Args::parse();

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    log::info!("=== djobsd v4.0.0 started (PID {}) ===", std::process::id());

    set_tz_from_getprop();

    set_signal(libc::SIGCHLD, signal_handler);
    set_signal(libc::SIGINT, signal_handler);
    set_signal(libc::SIGTERM, signal_handler);
    set_signal(libc::SIGHUP, signal_handler);

    let epoll_fd = match unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) } {
        -1 => { log::error!("epoll_create1 failed"); std::process::exit(1); }
        fd => fd,
    };

    let mut reload_pipe: [i32; 2] = [-1, -1];
    if unsafe { libc::pipe2(reload_pipe.as_mut_ptr(), libc::O_CLOEXEC | libc::O_NONBLOCK) } < 0 {
        log::error!("pipe2 failed");
        std::process::exit(1);
    }
    SIGHUP_PIPE_WRITE.store(reload_pipe[1], Ordering::SeqCst);

    let mut ev: libc::epoll_event = libc::epoll_event {
        events: libc::EPOLLIN as u32,
        u64: reload_pipe[0] as u64,
    };
    unsafe { libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_ADD, reload_pipe[0], &mut ev); }

    let config_path = args.config;
    let log_path = args.log_file;
    let poll_interval = args.poll;
    let mut last_check: i64 = 0;
    let mut had_reboot = false;

    while RUNNING.load(Ordering::SeqCst) {
        drain_sigchld();

        let cfg = match config::load_config(&config_path) {
            Ok(c) => c,
            Err(e) => {
                log::error!("Config load failed: {e}");
                std::thread::sleep(Duration::from_secs(30));
                continue;
            }
        };

        // Handle @reboot tasks (once, on first config load)
        if !had_reboot {
            had_reboot = true;
            for task in &cfg.tasks {
                if task.reboot {
                    log::info!("@reboot: {}", task.command);
                    if let Err(e) = exec::spawn_command(&task.command, &log_path) {
                        log::warn!("Failed to spawn @reboot \"{}\": {e}", task.command);
                    }
                }
            }
        }

        let now = config::now_ts();
        let next_ts = config::find_next_task(&cfg.tasks, now);

        if next_ts.is_none() || next_ts.unwrap() <= now {
            execute_due_tasks(&cfg.tasks, &mut last_check, now, &log_path);
            if !RUNNING.load(Ordering::SeqCst) { break; }
            continue;
        }

        let next = next_ts.unwrap();
        let now2 = config::now_ts();
        if now2 >= next { continue; }

        let tfd = match arm_timerfd(epoll_fd, next) {
            Some(fd) => fd,
            None => {
                log::warn!("Timer failed, sleeping {poll_interval}s...");
                std::thread::sleep(Duration::from_secs(poll_interval));
                continue;
            }
        };

        log::info!("Waiting for next task... (timerfd is wakeup source)");

        let mut events: [libc::epoll_event; 4] = unsafe { std::mem::zeroed() };
        let nfds = unsafe { libc::epoll_wait(epoll_fd, events.as_mut_ptr(), 4, -1) };

        if nfds < 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::EINTR) {
                log::error!("epoll_wait error: {err}");
                std::thread::sleep(Duration::from_secs(5));
            }
            unsafe { libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_DEL, tfd, std::ptr::null_mut()); }
            close_fd(tfd);
            continue;
        }

        let cfg = config::load_config(&config_path).unwrap_or(cfg);
        let mut timer_fired = false;

        for i in 0..nfds as usize {
            if events[i].u64 == tfd as u64 {
                timer_fired = true;
                let mut exp: u64 = 0;
                unsafe { libc::read(tfd, &mut exp as *mut u64 as *mut libc::c_void, 8); }
                log::info!("Timer fired! {exp} expiration(s)");
                execute_due_tasks(&cfg.tasks, &mut last_check, config::now_ts(), &log_path);
            } else if events[i].u64 == reload_pipe[0] as u64 {
                let mut buf: [u8; 64] = [0; 64];
                if unsafe { libc::read(reload_pipe[0], buf.as_mut_ptr() as *mut libc::c_void, 64) } < 0 {
                    log::error!("read(reload_pipe) failed: {}", std::io::Error::last_os_error());
                }
                log::info!("SIGHUP: reloading config");
            }
        }

        if !timer_fired {
            last_check = 0;
            execute_due_tasks(&cfg.tasks, &mut last_check, config::now_ts(), &log_path);
        }

        drain_sigchld();
        unsafe { libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_DEL, tfd, std::ptr::null_mut()); }
        close_fd(tfd);
    }

    drain_sigchld();

    log::info!("=== djobsd v4.0.0 stopped ===");
    close_fd(epoll_fd);
    close_fd(reload_pipe[0]);
    close_fd(reload_pipe[1]);
}
```

- [ ] **Step 2: Run tests**

Run: `cd native/djobsd && cargo test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add native/djobsd/src/main.rs
git commit -m "refactor(main): port crond.c job state machine — @reboot, execute_at, timerfd"
```

---

### Task 4: Update config.txt Examples

**Covers:** User-facing config documentation

**Files:**
- Modify: `module/config.txt`

- [ ] **Step 1: Update config.txt with new features**

```txt
# Format: cron_expression command (5-field cron only, no HH:MM)
# Prefix with # to disable a task.
#
# Supports: *, */N, N-M, N/M, N,M, month abbrevs (jan-dec), dow abbrevs (sun-sat)
#
# Day-of-month and day-of-week use OR logic:
#   "0 0 * * 1"    → every Monday (dom wildcard, dow=1)
#   "0 0 15 * *"   → every 15th (dom=15, dow wildcard)
#   "0 0 1,15 * 1" → 1st/15th AND Monday (both specific)
#
# Toggle mobile data:
# 30 22 * * * svc data disable              ← 22:30
#  0  7 * * * svc data enable               ← 07:00
#
# Airplane mode:
#  0 23 * * * cmd connectivity airplane-mode enable    ← 23:00
#  0  6 * * * cmd connectivity airplane-mode disable   ← 06:00
#
# WiFi:
# 30 23 * * * svc wifi disable              ← 23:30
# 30  6 * * * svc wifi enable               ← 06:30
#
# Every 2 hours:
# 0 */2 * * * svc data disable
#
# Mon/Wed/Fri at 9 AM:
# 0 9 * * 1,3,5 am start -n com.example/.MainActivity
#
# Run on first boot:
# @reboot svc data enable
#
# Paths:
# Daemon:  /data/adb/dailyjobs/bin/djobsd
# Config:  /data/adb/dailyjobs/config.txt
# Log:     /data/adb/dailyjobs/run.log
# PID:     /data/adb/dailyjobs/scheduler.pid
```

- [ ] **Step 2: Commit**

```bash
git add module/config.txt
git commit -m "docs(config): update examples with FixDayDow, abbrevs, @reboot"
```

---

### Task 5: Add FixDayDow and OR-Logic Tests

**Covers:** Comprehensive test coverage for crond.c behavior

**Files:**
- Modify: `native/djobsd/src/config.rs` (test module)

- [ ] **Step 1: Add comprehensive tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // ... existing tests from Task 1 ...

    #[test]
    fn test_cron_matches_or_logic() {
        // dom=15, dow=* (wildcard) → dom match, dow always true → match
        let task = parse_cron_line("0 0 15 * * /bin/true").unwrap();
        assert!(cron_matches(&task, 0, 0, 15, 0, 0)); // dom=15 matches
        assert!(!cron_matches(&task, 0, 0, 14, 0, 0)); // dom=14 no match

        // dom=*, dow=1 → dom always true, dow=1 matches → match
        let task = parse_cron_line("0 0 * * 1 /bin/true").unwrap();
        assert!(cron_matches(&task, 0, 0, 1, 0, 1)); // dow=1 matches
        assert!(cron_matches(&task, 0, 0, 15, 0, 1)); // dom=15 always true
        assert!(!cron_matches(&task, 0, 0, 15, 0, 2)); // dow=2 no match

        // dom=1,15, dow=1 → dom=1 OR dow=1
        let task = parse_cron_line("0 0 1,15 * 1 /bin/true").unwrap();
        assert!(cron_matches(&task, 0, 0, 1, 0, 0));  // dom=1 matches
        assert!(cron_matches(&task, 0, 0, 15, 0, 0)); // dom=15 matches
        assert!(cron_matches(&task, 0, 0, 10, 0, 1)); // dow=1 matches
        assert!(!cron_matches(&task, 0, 0, 10, 0, 2)); // neither matches
    }

    #[test]
    fn test_fix_day_dow_both_specific() {
        // "0 0 1,15 * 1" — both specific, neither wildcard → both kept
        let task = parse_cron_line("0 0 1,15 * 1 /bin/true").unwrap();
        assert!(task.dom[0]); // day 1
        assert!(task.dom[14]); // day 15
        assert!(task.dow[1]); // Monday
    }

    #[test]
    fn test_parse_step_in_range() {
        // 1-30/2 → 1,3,5,...,29
        let bits: [bool; 60] = parse_cron_field("1-30/2", 0, &[]).unwrap();
        assert!(bits[1] && bits[3] && bits[29]);
        assert!(!bits[0] && !bits[2] && !bits[30]);
    }

    #[test]
    fn test_parse_at_reboot() {
        let task = parse_cron_line("@reboot /bin/true").unwrap();
        assert!(task.reboot);
        assert_eq!(task.command, "/bin/true");
    }

    #[test]
    fn test_parse_at_reboot_with_args() {
        let task = parse_cron_line("@reboot svc data enable").unwrap();
        assert!(task.reboot);
        assert_eq!(task.command, "svc data enable");
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd native/djobsd && cargo test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add native/djobsd/src/config.rs
git commit -m "test: add FixDayDow, OR-logic, step-in-range, @reboot tests"
```

---

### Task 6: Final Verification

**Covers:** All tasks — full integration test

- [ ] **Step 1: Run all tests**

Run: `cd native/djobsd && cargo test`
Expected: All tests PASS

- [ ] **Step 2: Build release binary**

Run: `cd native/djobsd && cargo build --release`
Expected: Binary compiles successfully

- [ ] **Step 3: Verify binary size**

Run: `ls -lh target/release/djobsd`
Expected: ~64KB or smaller (with opt-level="z", LTO, strip)

- [ ] **Step 4: Final commit if needed**

```bash
git status
# If any uncommitted changes:
git add -A && git commit -m "chore: final cleanup for crond.c port"
```
