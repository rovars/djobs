use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TASKS: usize = 256;

const MONTH_ABBREVS: &[(&str, usize)] = &[
    ("jan", 1), ("feb", 2), ("mar", 3), ("apr", 4),
    ("may", 5), ("jun", 6), ("jul", 7), ("aug", 8),
    ("sep", 9), ("oct", 10), ("nov", 11), ("dec", 12),
];

const DOW_ABBREVS: &[(&str, usize)] = &[
    ("sun", 0), ("mon", 1), ("tue", 2), ("wed", 3),
    ("thu", 4), ("fri", 5), ("sat", 6),
];

const DOM_ABBREVS: &[(&str, usize)] = &[];

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

/// Bitmask-based cron task (crond.c-aligned)
#[derive(Debug, Clone)]
pub struct CronTask {
    pub minute: [bool; 60],
    pub hour: [bool; 24],
    pub dom: [bool; 32],   // 1-31 indexed, index 0 unused
    pub month: [bool; 12],
    pub dow: [bool; 7],
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

/// Resolve a token to a numeric value, checking abbreviations first.
fn resolve_token(token: &str, abbrevs: &[(&str, usize)]) -> Result<usize, String> {
    if let Ok(v) = token.parse::<usize>() {
        return Ok(v);
    }
    for &(name, val) in abbrevs {
        if token.eq_ignore_ascii_case(name) {
            return Ok(val);
        }
    }
    Err(format!("invalid value: {token}"))
}

/// Parse a cron field into a bitmask array. Supports: *, */N, N-M, N-M/N, N/M, N,M, abbreviations.
fn parse_cron_field<const N: usize>(field: &str, base: u8, abbrevs: &[(&str, usize)]) -> Result<[bool; N], String> {
    let mut bits = [false; N];

    if field == "*" {
        for b in &mut bits { *b = true; }
        return Ok(bits);
    }

    for token in field.split(',') {
        if let Some(slash_pos) = token.find('/') {
            let start_part = &token[..slash_pos];
            let step_str = &token[slash_pos + 1..];
            let step: usize = step_str.parse().map_err(|_| format!("invalid step: {token}"))?;
            if step == 0 { return Err("step cannot be 0".into()); }

            if start_part == "*" {
                // */N
                for i in (0..N).step_by(step) { bits[i] = true; }
            } else if let Some(dash_pos) = start_part.find('-') {
                // N-M/M
                let lo = resolve_token(&start_part[..dash_pos], abbrevs)?;
                let hi = resolve_token(&start_part[dash_pos + 1..], abbrevs)?;
                let lo = lo.saturating_sub(base as usize);
                let hi = std::cmp::min(hi.saturating_sub(base as usize), N - 1);
                for i in (lo..=hi).step_by(step) { bits[i] = true; }
            } else {
                // N/M — start at N, step M
                let start = resolve_token(start_part, abbrevs)?;
                let start = start.saturating_sub(base as usize);
                let mut i = start;
                while i < N { bits[i] = true; i += step; }
            }
        } else if let Some(dash_pos) = token.find('-') {
            // N-M range
            let lo = resolve_token(&token[..dash_pos], abbrevs)?;
            let hi = resolve_token(&token[dash_pos + 1..], abbrevs)?;
            let lo = lo.saturating_sub(base as usize);
            let hi = std::cmp::min(hi.saturating_sub(base as usize), N - 1);
            for i in lo..=hi { bits[i] = true; }
        } else {
            // Single value
            let v = resolve_token(token, abbrevs)?;
            let idx = v.saturating_sub(base as usize);
            if idx < N { bits[idx] = true; }
        }
    }

    Ok(bits)
}

fn is_wildcard_dom(dom: &[bool; 32]) -> bool {
    dom[1..=31].iter().all(|&b| b)
}

fn is_wildcard_dow(dow: &[bool; 7]) -> bool {
    dow.iter().all(|&b| b)
}

/// FixDayDow: if only one of dom/dow is wildcard, clear the other (OR logic).
fn fix_day_dow(task: &mut CronTask) {
    let dom_wild = is_wildcard_dom(&task.dom);
    let dow_wild = is_wildcard_dow(&task.dow);

    if dom_wild && !dow_wild {
        task.dom = [false; 32];
    } else if !dom_wild && dow_wild {
        task.dow = [false; 7];
    }
}

/// Parse a 5-field cron line into CronTask (or @reboot directive)
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

    // Check for @reboot
    if line_no_comment.starts_with("@reboot") {
        let cmd = line_no_comment["@reboot".len()..].trim();
        let mut task = CronTask::wildcard();
        task.reboot = true;
        task.command = cmd.to_string();
        return Ok(task);
    }

    let fields: Vec<&str> = line_no_comment.split_whitespace().collect();
    if fields.len() < 6 {
        return Err(format!("expected 5 cron fields + command, got {} fields", fields.len()));
    }

    let mut task = CronTask::wildcard();
    task.minute = parse_cron_field(fields[0], 0, &[])?;
    task.hour   = parse_cron_field(fields[1], 0, &[])?;
    task.dom    = parse_cron_field(fields[2], 0, DOM_ABBREVS)?;
    task.month  = parse_cron_field(fields[3], 1, MONTH_ABBREVS)?;
    task.dow    = parse_cron_field(fields[4], 0, DOW_ABBREVS)?;

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

/// OR logic for dom/dow per crond.c
pub fn cron_matches(task: &CronTask, minute: usize, hour: usize, dom: usize,
                    month: usize, dow: usize) -> bool {
    task.minute[minute] && task.hour[hour]
        && (task.dom[dom] || task.dow[dow])
        && task.month[month]
}

/// Find the next future time where any task matches. Iterates up to 30 days.
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
                let dom = tm.tm_mday as usize;  // 1-31, used directly (1-based dom)

                for task in tasks {
                    if task.reboot { continue; }
                    if cron_matches(task, m, h, dom, month, dow) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_field_wildcard() {
        let bits: [bool; 60] = parse_cron_field("*", 0, &[]).unwrap();
        assert!(bits.iter().all(|&b| b));
    }

    #[test]
    fn test_parse_field_step() {
        let bits: [bool; 24] = parse_cron_field("*/6", 0, &[]).unwrap();
        for i in 0..24 {
            assert_eq!(bits[i], i % 6 == 0, "hour {} mismatch", i);
        }
    }

    #[test]
    fn test_parse_field_range() {
        let bits: [bool; 60] = parse_cron_field("30-35", 0, &[]).unwrap();
        for i in 0..60 {
            assert_eq!(bits[i], (30..=35).contains(&i));
        }
    }

    #[test]
    fn test_parse_field_comma() {
        let bits: [bool; 60] = parse_cron_field("0,15,45", 0, &[]).unwrap();
        assert!(bits[0] && bits[15] && bits[45]);
        assert!(!bits[1] && !bits[30]);
    }

    #[test]
    fn test_parse_field_dom_base1() {
        let bits: [bool; 31] = parse_cron_field("15", 1, &[]).unwrap();
        assert!(bits[14]); // 15 - 1 = index 14
        assert!(!bits[13]);
    }

    #[test]
    fn test_parse_cron_line_valid() {
        let task = parse_cron_line("30 9 * * 1-5 /system/bin/echo hello").unwrap();
        assert!(task.minute[30]);
        assert!(task.hour[9]);
        // After FixDayDow: dom wildcard cleared (dow is specific)
        assert!(task.dom.iter().all(|&b| !b));
        assert!(task.dow[1] && task.dow[2] && task.dow[3] && task.dow[4] && task.dow[5]);
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
            dom: [true; 32],
            month: [true; 12],
            dow: [true; 7],
            command: "echo hi".into(),
            reboot: false,
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
        let result: Result<[bool; 60], String> = parse_cron_field("*/0", 0, &[]);
        assert!(result.is_err());
    }

    // --- New tests per spec ---

    #[test]
    fn test_parse_field_step_range() {
        let bits: [bool; 60] = parse_cron_field("1/15", 0, &[]).unwrap();
        assert!(bits[1] && bits[16] && bits[31] && bits[46]);
        assert!(!bits[0] && !bits[15]);
    }

    #[test]
    fn test_parse_month_abbrev() {
        let task = parse_cron_line("0 0 1 jan,mar * /bin/true").unwrap();
        assert!(task.month[0]);
        assert!(task.month[2]);
        assert!(!task.month[1]);
    }

    #[test]
    fn test_parse_dow_abbrev() {
        let task = parse_cron_line("0 0 * * mon,wed,fri /bin/true").unwrap();
        assert!(task.dow[1]);
        assert!(task.dow[3]);
        assert!(task.dow[5]);
        assert!(!task.dow[0]);
    }

    #[test]
    fn test_fix_day_dow_dom_wildcard() {
        let task = parse_cron_line("0 0 * * 1 /bin/true").unwrap();
        assert!(task.dom.iter().all(|&b| !b));
        assert!(task.dow[1]);
    }

    #[test]
    fn test_fix_day_dow_dow_wildcard() {
        let task = parse_cron_line("0 0 15 * * /bin/true").unwrap();
        assert!(task.dom[15]);
        assert!(task.dow.iter().all(|&b| !b));
    }

    #[test]
    fn test_fix_day_dow_both_specific() {
        let task = parse_cron_line("0 0 1,15 * 1 /bin/true").unwrap();
        assert!(task.dom[1]);
        assert!(task.dom[15]);
        assert!(task.dow[1]);
    }

    #[test]
    fn test_parse_at_reboot() {
        let task = parse_cron_line("@reboot /bin/true").unwrap();
        assert!(task.reboot);
        assert_eq!(task.command, "/bin/true");
    }

    #[test]
    fn test_cron_matches_or_logic() {
        let task = parse_cron_line("0 0 15 * * /bin/true").unwrap();
        assert!(cron_matches(&task, 0, 0, 15, 0, 0));
        assert!(!cron_matches(&task, 0, 0, 14, 0, 0));

        let task = parse_cron_line("0 0 * * 1 /bin/true").unwrap();
        assert!(cron_matches(&task, 0, 0, 1, 0, 1));
        assert!(cron_matches(&task, 0, 0, 15, 0, 1));
        assert!(!cron_matches(&task, 0, 0, 15, 0, 2));
    }

    #[test]
    fn test_parse_step_in_range() {
        let bits: [bool; 60] = parse_cron_field("1-30/2", 0, &[]).unwrap();
        assert!(bits[1] && bits[3] && bits[29]);
        assert!(!bits[0] && !bits[2] && !bits[30]);
    }
}
