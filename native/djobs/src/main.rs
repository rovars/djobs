use clap::{Parser, Subcommand};
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
    let pid = read_pid().map(|p| p.to_string());
    match pid {
        Some(p) => Command::new("kill")
            .arg("-0")
            .arg(&p)
            .status()
            .map_or(false, |s| s.success()),
        None => false,
    }
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
    let _ = Command::new("kill").arg("-9").arg(&pid_str).status();
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
        .stdout(fs::File::create("/dev/null").unwrap())
        .stderr(fs::File::create("/dev/null").unwrap())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[DailyJobs] Start failed: {e}");
            std::process::exit(1);
        }
    };

    fs::write(PID_FILE, child.id().to_string()).ok();
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

    let _ = Command::new("sh")
        .args(["-c", &format!("pkill -P {pid} 2>/dev/null || true")])
        .status();
    let _ = Command::new("kill").arg(pid.to_string()).status();

    wait_for_death(pid);
    let _ = fs::remove_file(PID_FILE);
    eprintln!("[DailyJobs] Stopped");
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Start => start_daemon(),
        Commands::Stop => stop_daemon(),
        Commands::Restart => {
            let old_pid = read_pid();
            if let Some(pid) = old_pid {
                if is_running() {
                    let _ = Command::new("sh")
                        .args(["-c", &format!("pkill -P {pid} 2>/dev/null || true")])
                        .status();
                    let _ = Command::new("kill").arg(pid.to_string()).status();
                    wait_for_death(pid);
                }
            }
            let _ = fs::remove_file(PID_FILE);
            start_daemon();
        }
        Commands::Status => {
            if is_running() {
                let pid = read_pid().unwrap_or(0);
                println!("[DailyJobs] Running (PID {pid})");
                if let Ok(log) = fs::read_to_string(LOG_FILE) {
                    let lines: Vec<&str> = log.lines().rev().take(3).collect();
                    for line in lines.iter().rev() {
                        println!("{line}");
                    }
                } else {
                    println!("[DailyJobs] No log file yet");
                }
            } else {
                println!("[DailyJobs] Stopped");
            }
        }
        Commands::Logs { n: lines } => {
            let n = lines.unwrap_or(50);
            if let Ok(file) = fs::File::open(LOG_FILE) {
                let reader = BufReader::new(file);
                let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
                let start = if all_lines.len() > n {
                    all_lines.len() - n
                } else {
                    0
                };
                for line in &all_lines[start..] {
                    println!("{line}");
                }
            } else {
                eprintln!("[DailyJobs] No log file");
                std::process::exit(1);
            }
        }
    }
}
