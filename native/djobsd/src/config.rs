use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TASKS: usize = 256;

/// Error type for config loading
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

/// A single cron task — bitmask-based matching
#[derive(Debug, Clone)]
pub struct CronTask {
    pub minute: [bool; 60],
    pub hour: [bool; 24],
    pub dom: [bool; 31],
    pub month: [bool; 12],
    pub dow: [bool; 7],
    pub command: String,
}

impl CronTask {
    fn wildcard() -> Self {
        CronTask {
            minute: [true; 60],
            hour: [true; 24],
            dom: [true; 31],
            month: [true; 12],
            dow: [true; 7],
            command: String::new(),
        }
    }
}

/// Parsed config — list of tasks
#[derive(Debug)]
pub struct Config {
    pub tasks: Vec<CronTask>,
}

/// Parse a single cron field into a bitmask array.
/// Supports: *, */N, N-M, N,M,O (comma list), single value.
fn parse_cron_field<const N: usize>(field: &str, base: u8) -> Result<[bool; N], String> {
    let mut bits = [false; N];

    if field == "*" {
        for b in &mut bits { *b = true; }
        return Ok(bits);
    }

    if field.len() > 2 && &field[..2] == "*/" {
        let step: usize = field[2..].parse().map_err(|_| format!("invalid step: {field}"))?;
        if step == 0 { return Err("step cannot be 0".into()); }
        for i in (0..N).step_by(step) { bits[i] = true; }
        return Ok(bits);
    }

    for token in field.split(',') {
        if let Some(dash) = token.find('-') {
            let lo: usize = token[..dash].parse().map_err(|_| format!("invalid range: {token}"))?;
            let hi: usize = token[dash+1..].parse().map_err(|_| format!("invalid range: {token}"))?;
            let lo = lo.saturating_sub(base as usize);
            let hi = std::cmp::min(hi.saturating_sub(base as usize), N - 1);
            for i in lo..=hi { bits[i] = true; }
        } else {
            let v: usize = token.parse().map_err(|_| format!("invalid value: {token}"))?;
            let idx = v.saturating_sub(base as usize);
            if idx < N { bits[idx] = true; }
        }
    }

    Ok(bits)
}

/// Parse a 5-field cron line into CronTask
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

    let fields: Vec<&str> = line_no_comment.split_whitespace().collect();
    if fields.len() < 6 {
        return Err(format!("expected 5 cron fields + command, got {} fields", fields.len()));
    }

    let mut task = CronTask::wildcard();
    task.minute = parse_cron_field(fields[0], 0)?;
    task.hour   = parse_cron_field(fields[1], 0)?;
    task.dom    = parse_cron_field(fields[2], 1)?;
    task.month  = parse_cron_field(fields[3], 1)?;
    task.dow    = parse_cron_field(fields[4], 0)?;

    // Command = everything after the 5th field (collapse whitespace)
    task.command = line_no_comment.split_whitespace().skip(5).collect::<Vec<_>>().join(" ");

    Ok(task)
}

/// Load config from a file path
pub fn load_config(path: &Path) -> Result<Config, ConfigError> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut tasks = Vec::new();

    for (i, line) in reader.lines().enumerate() {
        let line = line?;
        if tasks.len() >= MAX_TASKS {
            break;
        }
        match parse_cron_line(&line) {
            Ok(task) => tasks.push(task),
            Err(ref e) if e == "skip" => {},
            Err(e) => {
                log::warn!("Config skip line {}: {}", i + 1, e);
            }
        }
    }

    Ok(Config { tasks })
}

/// Check if a task matches the given broken-down time
pub fn cron_matches(task: &CronTask, minute: usize, hour: usize, dom: usize,
                    month: usize, dow: usize) -> bool {
    task.minute[minute] && task.hour[hour]
        && task.dom[dom] && task.month[month] && task.dow[dow]
}

/// Find the next future time where any task matches.
/// Iterates up to 30 days ahead.
pub fn find_next_task(tasks: &[CronTask], after: i64) -> Option<i64> {
    if tasks.is_empty() { return None; }

    let mut probe = after;
    for _days in 0..30 {
        let local_time: libc::time_t = probe as libc::time_t;
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        unsafe {
            libc::localtime_r(&local_time as *const libc::time_t, &mut tm);
        }

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
                let dom = tm.tm_mday as usize;

                for task in tasks {
                    if cron_matches(task, m, h, dom.saturating_sub(1), month, dow) {
                        return Some(ts as i64);
                    }
                }
            }
        }
        probe += 86400;
    }
    None
}

/// Current unix timestamp in seconds
pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_field_wildcard() {
        let bits: [bool; 60] = parse_cron_field("*", 0).unwrap();
        assert!(bits.iter().all(|&b| b));
    }

    #[test]
    fn test_parse_field_step() {
        let bits: [bool; 24] = parse_cron_field("*/6", 0).unwrap();
        for i in 0..24 {
            assert_eq!(bits[i], i % 6 == 0, "hour {} mismatch", i);
        }
    }

    #[test]
    fn test_parse_field_range() {
        let bits: [bool; 60] = parse_cron_field("30-35", 0).unwrap();
        for i in 0..60 {
            assert_eq!(bits[i], (30..=35).contains(&i));
        }
    }

    #[test]
    fn test_parse_field_comma() {
        let bits: [bool; 60] = parse_cron_field("0,15,45", 0).unwrap();
        assert!(bits[0] && bits[15] && bits[45]);
        assert!(!bits[1] && !bits[30]);
    }

    #[test]
    fn test_parse_field_dom_base1() {
        let bits: [bool; 31] = parse_cron_field("15", 1).unwrap();
        assert!(bits[14]); // 15 - 1 = index 14
        assert!(!bits[13]);
    }

    #[test]
    fn test_parse_cron_line_valid() {
        let task = parse_cron_line("30 9 * * 1-5 /system/bin/echo hello").unwrap();
        assert!(task.minute[30]);
        assert!(task.hour[9]);
        assert!(task.dom.iter().all(|&b| b));
        assert_eq!(task.command, "/system/bin/echo hello");
    }

    #[test]
    fn test_parse_cron_line_comment() {
        assert!(parse_cron_line("# this is a comment").is_err());
    }

    #[test]
    fn test_parse_cron_line_inline_comment() {
        let task = parse_cron_line("0 9 * * 1-5 /bin/true # office hours").unwrap();
        assert_eq!(task.command, "/bin/true");
    }

    #[test]
    fn test_cron_matches() {
        let task = CronTask {
            minute: { let mut b = [false; 60]; b[30] = true; b },
            hour: { let mut b = [false; 24]; b[9] = true; b },
            dom: [true; 31],
            month: [true; 12],
            dow: [true; 7],
            command: "echo hi".into(),
        };
        assert!(cron_matches(&task, 30, 9, 14, 5, 3)); // matches
        assert!(!cron_matches(&task, 31, 9, 14, 5, 3)); // wrong minute
    }

    #[test]
    fn test_find_next_task_empty() {
        assert_eq!(find_next_task(&[], 1000), None);
    }

    #[test]
    fn test_cron_field_invalid_step_zero() {
        let result: Result<[bool; 60], String> = parse_cron_field("*/0", 0);
        assert!(result.is_err());
    }
}
