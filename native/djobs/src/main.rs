use clap::{Parser, Subcommand};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::process::Command;
use std::{fs, thread, time::Duration};

const DAEMON_BIN: &str = "/data/adb/dailyjobs/bin/djobsd";
const PID_FILE: &str = "/data/adb/dailyjobs/scheduler.pid";
const LOG_FILE: &str = "/data/adb/dailyjobs/run.log";
const WAIT_TIMEOUT: u64 = 5;

#[derive(Parser)]
#[command(version = "4.0.0", about = "DailyJobs scheduler control")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the scheduler daemon
    Start,
    /// Stop the scheduler daemon
    Stop,
    /// Restart the scheduler daemon
    Restart,
    /// Show scheduler status
    Status,
    /// Show recent log entries
    Logs {
        /// Number of lines to show (default 50)
        n: Option<usize>,
    },
}

fn read_pid() -> Option<u32> {
    let content = fs::read_to_string(PID_FILE).ok()?;
    content.trim().parse().ok()
}

fn is_running() -> bool {
    let pid = match read_pid() {
        Some(p) => p.to_string(),
        None => return false,
    };
    Command::new("kill")
        .arg("-0")
        .arg(&pid)
        .status()
        .map_or(false, |s| s.success())
}

fn is_daemon_installed() -> bool {
    fs::metadata(DAEMON_BIN).is_ok()
}

fn wait_for_death(pid: u32) {
    let pid_str = pid.to_string();
    for _ in 0..WAIT_TIMEOUT {
        let alive = Command::new("kill")
            .arg("-0")
            .arg(&pid_str)
            .status()
            .map_or(true, |s| s.success());
        if !alive {
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }
    eprintln!("[DailyJobs] Force killing PID {pid}...");
    if let Err(e) = Command::new("kill").arg("-9").arg(&pid_str).status() {
        eprintln!("[DailyJobs] kill -9 failed: {e}");
    }
}

fn start_daemon() {
    if is_running() {
        eprintln!(
            "[DailyJobs] Already running (PID {})",
            read_pid().unwrap_or(0)
        );
        return;
    }
    if !is_daemon_installed() {
        eprintln!("[DailyJobs] Binary not found: {DAEMON_BIN}");
        std::process::exit(1);
    }

    eprintln!("[DailyJobs] Starting scheduler...");

    let child = match Command::new(DAEMON_BIN)
        .arg("--config")
        .arg("/data/adb/dailyjobs/config.txt")
        .stdout(fs::File::create("/dev/null").unwrap_or_else(|e| {
            eprintln!("[DailyJobs] Cannot open /dev/null: {e}");
            std::process::exit(1);
        }))
        .stderr(fs::File::create("/dev/null").unwrap_or_else(|e| {
            eprintln!("[DailyJobs] Cannot open /dev/null: {e}");
            std::process::exit(1);
        }))
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[DailyJobs] Start failed: {e}");
            std::process::exit(1);
        }
    };

    if let Err(e) = fs::write(PID_FILE, child.id().to_string()) {
        eprintln!("[DailyJobs] Warning: could not write PID file: {e}");
    }
    thread::sleep(Duration::from_millis(500));

    if is_running() {
        eprintln!("[DailyJobs] Started OK (PID {})", child.id());
    } else {
        eprintln!("[DailyJobs] Start failed (process died)");
        std::process::exit(1);
    }
}

fn stop_daemon() {
    let pid = match read_pid() {
        Some(p) if is_running() => p,
        _ => {
            eprintln!("[DailyJobs] Not running");
            let _ = fs::remove_file(PID_FILE);
            return;
        }
    };

    eprintln!("[DailyJobs] Stopping scheduler (PID {pid})...");

    if let Err(e) = Command::new("sh")
        .args(["-c", &format!("pkill -P {pid} 2>/dev/null || true")])
        .status()
    {
        eprintln!("[DailyJobs] Warning: pkill failed: {e}");
    }
    if let Err(e) = Command::new("kill").arg(pid.to_string()).status() {
        eprintln!("[DailyJobs] Warning: kill failed: {e}");
    }

    wait_for_death(pid);
    if let Err(e) = fs::remove_file(PID_FILE) {
        eprintln!("[DailyJobs] Warning: could not remove PID file: {e}");
    }
    eprintln!("[DailyJobs] Stopped");
}

/// Read the last `n` lines from a file without loading it entirely.
fn read_last_lines(path: &str, n: usize) -> Result<Vec<String>, std::io::Error> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines: VecDeque<String> = VecDeque::with_capacity(n);

    for line in reader.lines() {
        let line = line?;
        if lines.len() >= n {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    Ok(lines.into())
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Start => start_daemon(),
        Commands::Stop => stop_daemon(),
        Commands::Restart => {
            stop_daemon();
            start_daemon();
        }
        Commands::Status => {
            if is_running() {
                let pid = read_pid().unwrap_or(0);
                println!("[DailyJobs] Running (PID {pid})");
                match read_last_lines(LOG_FILE, 3) {
                    Ok(lines) => {
                        for line in &lines {
                            println!("{line}");
                        }
                    }
                    Err(_) => {
                        println!("[DailyJobs] No log file yet");
                    }
                }
            } else {
                println!("[DailyJobs] Stopped");
            }
        }
        Commands::Logs { n: lines } => {
            let n = lines.unwrap_or(50);
            match read_last_lines(LOG_FILE, n) {
                Ok(lines) => {
                    for line in &lines {
                        println!("{line}");
                    }
                }
                Err(e) => {
                    eprintln!("[DailyJobs] Cannot read log file: {e}");
                    std::process::exit(1);
                }
            }
        }
    }
}
