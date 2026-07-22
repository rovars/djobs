mod config;
mod exec;

use clap::Parser;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::time::Duration;

fn close_fd(fd: i32) {
    if fd >= 0 { unsafe { libc::close(fd) }; }
}

fn drain_sigchld() {
    if SIGCHLD_PENDING.swap(false, Ordering::SeqCst) {
        let n = exec::reap_children();
        exec::log_reap_count(n);
    }
}

/// DailyJobs cron scheduler daemon — deep-sleep safe
#[derive(Parser)]
#[command(version = "4.0.0", about = None)]
struct Args {
    /// Cron config file path
    #[arg(short, long, default_value = "/data/adb/dailyjobs/config.txt")]
    config: PathBuf,

    /// Poll interval in seconds when no tasks are scheduled
    #[arg(short, long, default_value_t = 900)]
    poll: u64,

    /// Log file path
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
    if check > end {
        return;
    }

    while check <= end {
        execute_at(tasks, check, log_path);
        check += 60;
    }
    *last_check = now;
}

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

    let ret = unsafe { libc::timerfd_settime(tfd, flags, &spec, std::ptr::null_mut()) };
    if ret < 0 {
        spec.it_value.tv_sec = remaining as libc::time_t;
        let ret = unsafe { libc::timerfd_settime(tfd, 0, &spec, std::ptr::null_mut()) };
        if ret < 0 {
            log::error!("timerfd_settime (relative) failed");
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
        -1 => {
            log::error!("epoll_create1 failed");
            std::process::exit(1);
        }
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

        if !had_reboot {
            had_reboot = true;
            for task in &cfg.tasks {
                if task.reboot {
                    log::info!("Reboot task: {}", task.command);
                    if let Err(e) = exec::spawn_command(&task.command, &log_path) {
                        log::warn!("Failed to spawn reboot task \"{}\": {e}", task.command);
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
        let nfds = unsafe {
            libc::epoll_wait(epoll_fd, events.as_mut_ptr(), 4, -1)
        };

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
