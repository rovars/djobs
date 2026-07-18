/**
 * cron_scheduler.c — Android Deep-Sleep Safe Cron Scheduler
 *
 * Cara kerja:
 * - timerfd_create(CLOCK_REALTIME_ALARM) → register wakeup source ke kernel
 * - epoll_wait() → block sampe timer fire (Android tetap manage power sendiri)
 * - Kernel otomatis set RTC HW alarm karena timerfd jadi wakeup source
 * - Device bisa deep sleep alami, dan pasti bangun pas jadwal task cron
 * - TIDAK perlu write "mem" ke /sys/power/state (gak override Android PM)
 *
 * ALL BUGS FIXED:
 *  #1 Zombie process → SIGCHLD = SIG_IGN
 *  #2 DST error → tm_isdst = -1 tiap iterasi + re-copy tm
 *  #3 Missed task → last_check_time + iterasi per menit
 *  #4 SIGHUP broken → signal handler nulis ke pipe
 *  #5 Relative timer → TFD_TIMER_ABSTIME
 *  #6 Integer overflow → time_t instead of int
 *  #7 tm_isdst not set → -1 before each mktime
 *
 * Compile native:   zig cc -O2 -std=c11 -Wall -Wextra cron_scheduler.c -o cron_scheduler
 * Cross Android:    zig cc -O2 -target aarch64-linux-musl -static cron_scheduler.c -o cron_scheduler_arm64
 * Strip:            ELFkickers-3.2/sstrip/sstrip cron_scheduler_arm64
 */

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>
#include <signal.h>
#include <sys/timerfd.h>
#include <sys/epoll.h>
#include <sys/wait.h>
#include <stdbool.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <getopt.h>

/* ============================================================
 *  Konfigurasi
 * ============================================================ */

#define CRON_ROOT       "/data/adb/dailyjobs/config.txt"
#define RUN_LOG         "/data/adb/dailyjobs/run.log"
#define PID_FILE        "/data/adb/dailyjobs/scheduler.pid"
#define BUSYBOX_KSU     "/data/adb/ksu/bin/busybox"
#define BUSYBOX_AP      "/data/adb/ap/bin/busybox"
#define BUSYBOX_MAGISK  "/data/adb/magisk/busybox"

#define DEFAULT_POLL_INTERVAL   900  /* 15 menit kalo gak ada task */
#define MAX_TASKS               256
#define MAX_LINE                512
#define LOG_BUF                 256

/* ============================================================
 *  Cron structures
 * ============================================================ */

typedef struct {
    unsigned char minute[60];   /* bitmask: 1 = aktif */
    unsigned char hour[24];
    unsigned char dom[31];
    unsigned char month[12];
    unsigned char dow[7];
    char command[MAX_LINE];
    bool valid;
} CronTask;

static CronTask tasks[MAX_TASKS];
static int task_count = 0;

/* ============================================================
 *  Global state
 * ============================================================ */

static volatile sig_atomic_t running = 1;
static atomic_int child_count = 0;
#define MAX_CHILDREN 8
static int sighup_pipe_write_fd = -1;
static time_t last_task_check = 0;
static char *config_path = CRON_ROOT;
static int poll_interval = DEFAULT_POLL_INTERVAL;

/* ============================================================
 *  Forward declarations
 * ============================================================ */

static int load_cron_tasks(void);
static time_t find_next_cron_task(void);
static void execute_due_tasks(time_t now);
static int arm_timerfd(int epoll_fd, time_t target_ts);

/* ============================================================
 *  Logging
 * ============================================================ */

static void log_message(const char *fmt, ...) {
    char buf[LOG_BUF];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);

    time_t now = time(NULL);
    struct tm *tm = localtime(&now);
    char ts[32];
    strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", tm);

    fprintf(stderr, "[%s] %s\n", ts, buf);

    FILE *f = fopen(RUN_LOG, "a");
    if (f) {
        fprintf(f, "[%s] %s\n", ts, buf);
        fclose(f);
    }
}

/* ============================================================
 *  Signal Handler (fixed #4: SIGHUP nulis ke pipe)
 * ============================================================ */

static void signal_handler(int sig) {
    if (sig == SIGHUP) {
        /* Tulis ke pipe biar epoll bangun dan reload config */
        if (sighup_pipe_write_fd >= 0)
            write(sighup_pipe_write_fd, "", 1);
        return;
    }
    if (sig == SIGCHLD) {
        while (waitpid(-1, NULL, WNOHANG) > 0)
            atomic_fetch_sub(&child_count, 1);
        return;
    }
    /* SIGINT / SIGTERM */
    running = 0;
}

/* ============================================================
 *  Cron Expression Parser — supports two formats:
 *
 *  Format 1 (full cron):  step/5 9-17 * * 1-5 /bin/command
 *  Format 2 (simple):     07:30 /bin/command  (auto ke cron)
 * ============================================================ */

static int parse_field(const char *str, unsigned char *bits, int max_val, int base) {
    memset(bits, 0, (size_t)max_val);

    if (strcmp(str, "*") == 0) {
        for (int i = 0; i < max_val; i++) bits[i] = 1;
        return 0;
    }

    if (strlen(str) > 2 && str[0] == '*' && str[1] == '/') {
        int step = atoi(str + 2);
        if (step <= 0) return -1;
        for (int i = 0; i < max_val; i += step) bits[i] = 1;
        return 0;
    }

    char copy[64];
    strncpy(copy, str, sizeof(copy) - 1);
    copy[sizeof(copy) - 1] = '\0';

    char *token = strtok(copy, ",");
    while (token) {
        char *dash = strchr(token, '-');
        if (dash) {
            *dash = '\0';
            int lo = atoi(token) - base;
            int hi = atoi(dash + 1) - base;
            if (lo < 0) lo = 0;
            if (hi >= max_val) hi = max_val - 1;
            for (int i = lo; i <= hi; i++) bits[i] = 1;
        } else {
            int v = atoi(token) - base;
            if (v >= 0 && v < max_val) bits[v] = 1;
        }
        token = strtok(NULL, ",");
    }
    return 0;
}

static int parse_cron_line(const char *line, CronTask *task) {
    memset(task, 0, sizeof(CronTask));

    char buf[MAX_LINE];
    strncpy(buf, line, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    char *p = buf;
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '#' || *p == '\0') return -1;

    /* Detect format: HH:MM (simple) vs full cron (5 fields) */
    /* HH:MM pattern = 2 digits, colon, 2 digits */
    int is_simple = 0;
    if (strlen(p) >= 5 && p[0] >= '0' && p[0] <= '2' &&
        p[1] >= '0' && p[1] <= '9' && p[2] == ':') {
        /* Check if followed by a space (command) not more time fields */
        const char *after = p + 5;
        if (*after == ' ' || *after == '\t') {
            is_simple = 1;
        }
    }

    if (is_simple) {
        /* Format: HH:MM command → convert to cron: MM HH * * * command */
        char hour_str[8] = {0}, min_str[8] = {0};
        snprintf(hour_str, sizeof(hour_str), "%.2s", p);     /* HH */
        snprintf(min_str, sizeof(min_str), "%s", p + 3);     /* MM (2 chars) */
        /* Trim MM at space */
        min_str[2] = '\0';

        /* Parse minute field */
        if (parse_field(min_str, task->minute, 60, 0) < 0) return -1;
        /* Parse hour field */
        if (parse_field(hour_str, task->hour, 24, 0) < 0) return -1;
        /* Set dom, month, dow to wildcard */
        for (int i = 0; i < 31; i++) task->dom[i] = 1;
        for (int i = 0; i < 12; i++) task->month[i] = 1;
        for (int i = 0; i < 7; i++) task->dow[i] = 1;

        /* Command = after HH:MM and space */
        const char *cmd_start = p + 5;
        while (*cmd_start == ' ' || *cmd_start == '\t') cmd_start++;
        strncpy(task->command, cmd_start, MAX_LINE - 1);
        task->command[MAX_LINE - 1] = '\0';
        task->valid = true;
        return 0;
    }

    char *fields[6];
    int nf = 0;
    char *save = NULL;
    char *tok = strtok_r(p, " \t", &save);
    while (tok && nf < 6) {
        fields[nf++] = tok;
        tok = strtok_r(NULL, " \t", &save);
    }
    if (nf < 6) return -1;

    if (parse_field(fields[0], task->minute, 60, 0) < 0) return -1;
    if (parse_field(fields[1], task->hour, 24, 0) < 0) return -1;
    if (parse_field(fields[2], task->dom, 31, 1) < 0) return -1;
    if (parse_field(fields[3], task->month, 12, 1) < 0) return -1;
    if (parse_field(fields[4], task->dow, 7, 0) < 0) return -1;

    /* Extract command (sisa line setelah field ke-5) */
    const char *cmd_start = line;
    int field_found = 0;
    const char *walker = line;
    while (*walker) {
        while (*walker == ' ' || *walker == '\t') walker++;
        if (*walker == '\0') break;
        field_found++;
        if (field_found == 6) {
            cmd_start = walker;
            break;
        }
        while (*walker && *walker != ' ' && *walker != '\t') walker++;
    }

    if (field_found >= 6)
        strncpy(task->command, cmd_start, MAX_LINE - 1);
    else
        strncpy(task->command, fields[5], MAX_LINE - 1);

    task->command[MAX_LINE - 1] = '\0';
    task->valid = true;
    return 0;
}

static int load_cron_tasks(void) {
    FILE *f = fopen(config_path, "r");
    if (!f) {
        log_message("Cannot open %s: %s", config_path, strerror(errno));
        return -1;
    }

    task_count = 0;
    char line[MAX_LINE];
    while (fgets(line, sizeof(line), f) && task_count < MAX_TASKS) {
        line[strcspn(line, "\n")] = '\0';
        if (parse_cron_line(line, &tasks[task_count]) == 0)
            task_count++;
    }
    fclose(f);

    log_message("Loaded %d cron tasks", task_count);
    return task_count;
}

static bool cron_matches(CronTask *t, struct tm *tm) {
    if (!t->minute[tm->tm_min])  return false;
    if (!t->hour[tm->tm_hour])   return false;
    if (!t->dom[tm->tm_mday - 1]) return false;
    if (!t->month[tm->tm_mon])   return false;
    if (!t->dow[tm->tm_wday])    return false;
    return true;
}

/* ============================================================
 *  find_next_cron_task (fixed #2, #7: DST + tm_isdst)
 *
 *  Set t = *tm FRESH tiap iterasi jam, bukan sekali per hari.
 *  Set tm_isdst = -1 sebelum tiap mktime().
 * ============================================================ */

static time_t find_next_cron_task(void) {
    time_t now = time(NULL);
    struct tm *tm = localtime(&now);

    for (int days = 0; days < 30; days++) {
        int start_h = (days == 0) ? tm->tm_hour : 0;
        for (int h = start_h; h < 24; h++) {
            /* COPY FRESH dari *tm (bukan dari t sebelumnya yang sudah di-mktime) */
            struct tm t = *tm;
            t.tm_sec = 0;
            t.tm_hour = h;
            t.tm_isdst = -1;  /* biar mktime yang tentuin DST (#7) */

            int start_m = (days == 0 && h == tm->tm_hour) ? tm->tm_min + 1 : 0;
            for (int m = start_m; m < 60; m++) {
                t.tm_min = m;
                time_t ts = mktime(&t);
                if (ts == (time_t)-1) continue;
                if (ts <= now) continue;
                for (int i = 0; i < task_count; i++)
                    if (cron_matches(&tasks[i], &t)) return ts;
            }
        }
        /* Next day */
        now += 86400;
        tm = localtime(&now);
    }

    return time(NULL) + poll_interval;
}

/* ============================================================
 *  Task Execution (fixed #3: missed task detection)
 *
 *  Iterasi setiap menit dari last_task_check sampai now.
 * ============================================================ */

static void run_command(const char *cmd) {
    if (atomic_fetch_add(&child_count, 1) >= MAX_CHILDREN) {
        atomic_fetch_sub(&child_count, 1);
        log_message("Too many children (%d), skipping: %s", child_count, cmd);
        return;
    }

    log_message("Exec: %s", cmd);

    pid_t pid = fork();
    if (pid < 0) {
        atomic_fetch_sub(&child_count, 1);
        log_message("Fork failed: %s", strerror(errno));
        return;
    }
    if (pid == 0) {
        setsid();
        int fd = open(RUN_LOG, O_WRONLY | O_APPEND | O_CREAT, 0644);
        if (fd >= 0) {
            dup2(fd, STDOUT_FILENO);
            dup2(fd, STDERR_FILENO);
            if (fd > 2) close(fd);
        }
        execl("/system/bin/sh", "sh", "-c", cmd, (char *)NULL);
        execl(BUSYBOX_KSU, "busybox", "sh", "-c", cmd, (char *)NULL);
        execl(BUSYBOX_AP, "busybox", "sh", "-c", cmd, (char *)NULL);
        execl(BUSYBOX_MAGISK, "busybox", "sh", "-c", cmd, (char *)NULL);
        _exit(127);
    }
    /* Parent: child already counted above */
}

static void execute_due_tasks(time_t now) {
    int executed = 0;

    if (last_task_check == 0) {
        /* First run: cek menit sekarang aja */
        last_task_check = now;
        struct tm *tm = localtime(&now);
        for (int i = 0; i < task_count; i++) {
            if (cron_matches(&tasks[i], tm)) {
                log_message("Task due: %s", tasks[i].command);
                run_command(tasks[i].command);
                executed++;
            }
        }
        if (executed > 0)
            log_message("Executed %d task(s)", executed);
        return;
    }

    /* Iterasi dari 1 menit SETELAH last_task_check sampe menit ini.
     * - (last_task_check / 60 + 1) * 60 = menit depan setelah last_check
     * - now - (now % 60) = rounding ke menit saat ini
     * Ini mencegah duplikasi: tiap menit cuma dieksekusi 1x. */
    time_t check = (last_task_check / 60 + 1) * 60;
    time_t end   = now - (now % 60);  /* current minute boundary */

    if (check > end) return;  /* nothing new to check */

    while (check <= end) {
        struct tm *tm = localtime(&check);
        for (int i = 0; i < task_count; i++) {
            if (cron_matches(&tasks[i], tm)) {
                log_message("Task due: %s", tasks[i].command);
                run_command(tasks[i].command);
                executed++;
            }
        }
        check += 60;
    }

    if (executed > 0)
        log_message("Executed %d task(s)", executed);

    last_task_check = now;
}

/* ============================================================
 *  TimerFD — Wakeup Source untuk Deep Sleep (fixed #5, #6)
 *
 *  #5: Pake TFD_TIMER_ABSTIME biar gak meleset kalo ada time change.
 *  #6: Pake time_t instead of int buat remaining.
 * ============================================================ */

static int arm_timerfd(int epoll_fd, time_t target_ts) {
    time_t now = time(NULL);
    time_t remaining = target_ts - now;  /* #6: time_t, not int */
    if (remaining < 0) remaining = 5;

    int tfd = timerfd_create(CLOCK_REALTIME_ALARM, TFD_NONBLOCK | TFD_CLOEXEC);
    if (tfd < 0) {
        log_message("CLOCK_REALTIME_ALARM unavailable, fallback CLOCK_REALTIME: %s",
                     strerror(errno));
        tfd = timerfd_create(CLOCK_REALTIME, TFD_NONBLOCK | TFD_CLOEXEC);
        if (tfd < 0) {
            log_message("timerfd_create failed: %s", strerror(errno));
            return -1;
        }
    }

    struct itimerspec spec = {0};
    /* #5: absolute time → resisten terhadap NTP/time change */
    spec.it_value.tv_sec = target_ts;

    if (timerfd_settime(tfd, TFD_TIMER_ABSTIME, &spec, NULL) < 0) {
        /* Fallback: relative time kalo absolute gagal */
        spec.it_value.tv_sec = remaining;
        if (timerfd_settime(tfd, 0, &spec, NULL) < 0) {
            log_message("timerfd_settime failed: %s", strerror(errno));
            close(tfd);
            return -1;
        }
    }

    struct epoll_event ev = {0};
    ev.events = EPOLLIN;
    ev.data.fd = tfd;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, tfd, &ev) < 0) {
        log_message("epoll_ctl ADD failed: %s", strerror(errno));
        close(tfd);
        return -1;
    }

    log_message("Timer armed: +%lds (target: %ld)", (long)remaining, (long)target_ts);
    return tfd;
}

/* ============================================================
 *  PID File
 * ============================================================ */

static void write_pid_file(void) {
    FILE *f = fopen(PID_FILE, "w");
    if (f) {
        fprintf(f, "%d\n", getpid());
        fclose(f);
    }
}

static void remove_pid_file(void) { unlink(PID_FILE); }

/* ============================================================
 *  Main Loop
 * ============================================================ */

static void print_usage(const char *prog) {
    fprintf(stderr,
        "Usage: %s [options] [status]\n"
        "Options:\n"
        "  -f, --foreground    Run in foreground (default: daemon)\n"
        "  -c, --config PATH   Cron config file (default: %s)\n"
        "  -p, --poll SEC      Poll interval if no tasks (default: %d)\n"
        "  -s, --status        Show scheduler status\n"
        "  status              Same as --status\n"
        "  -h, --help          This help\n",
        prog, CRON_ROOT, DEFAULT_POLL_INTERVAL);
}

int main(int argc, char *argv[]) {
    static struct option long_opts[] = {
        {"foreground", no_argument, 0, 'f'},
        {"config",     required_argument, 0, 'c'},
        {"poll",       required_argument, 0, 'p'},
        {"help",       no_argument, 0, 'h'},
        {0, 0, 0, 0}
    };

    bool foreground = false;
    bool show_status = false;

    int opt;
    while ((opt = getopt_long(argc, argv, "fc:p:hs", long_opts, NULL)) != -1) {
        switch (opt) {
            case 'f': foreground = true; break;
            case 'c': config_path = optarg; break;
            case 'p': poll_interval = atoi(optarg); if (poll_interval < 10) poll_interval = 10; break;
            case 's': show_status = true; break;
            case 'h': print_usage(argv[0]); return 0;
            default:  print_usage(argv[0]); return 1;
        }
    }

    /* Handle 'status' as first positional argument for convenience */
    if (!show_status && optind < argc && strcmp(argv[optind], "status") == 0)
        show_status = true;

    if (show_status) {
        FILE *f = fopen(PID_FILE, "r");
        if (f) {
            pid_t pid;
            if (fscanf(f, "%d", &pid) == 1 && kill(pid, 0) == 0) {
                printf("[scheduler] Running (PID %d)\n", pid);
                fclose(f);
                return 0;
            }
            fclose(f);
        }
        printf("[scheduler] Stopped\n");
        return 0;
    }

    /* #1: reap children and track count */
    {
        struct sigaction sa;
        sa.sa_handler = signal_handler;
        sigemptyset(&sa.sa_mask);
        sa.sa_flags = SA_RESTART | SA_NOCLDSTOP;
        sigaction(SIGCHLD, &sa, NULL);
    }

    /* SIGHUP → reload config via pipe (fixed #4) */
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);
    signal(SIGHUP, signal_handler);

    if (!foreground) {
        pid_t pid = fork();
        if (pid < 0) { perror("fork"); return 1; }
        if (pid > 0) { fprintf(stderr, "[scheduler] Daemon PID %d\n", pid); return 0; }
        setsid();
        freopen("/dev/null", "r", stdin);
        freopen("/dev/null", "w", stdout);
        freopen("/dev/null", "w", stderr);
    }

    write_pid_file();
    atexit(remove_pid_file);

    log_message("=== Cron Scheduler v3.0 started (PID %d) ===", getpid());

    int epoll_fd = epoll_create1(EPOLL_CLOEXEC);
    if (epoll_fd < 0) {
        log_message("epoll_create1 failed");
        return 1;
    }

    /* Pipe untuk SIGHUP reload (#4) */
    int reload_pipe[2];
    if (pipe2(reload_pipe, O_CLOEXEC | O_NONBLOCK) < 0) {
        log_message("pipe2 failed: %s", strerror(errno));
        return 1;
    }

    /* Register write end of pipe untuk signal handler */
    sighup_pipe_write_fd = reload_pipe[1];

    /* Add read end ke epoll */
    struct epoll_event ev = {0};
    ev.events = EPOLLIN;
    ev.data.fd = reload_pipe[0];
    epoll_ctl(epoll_fd, EPOLL_CTL_ADD, reload_pipe[0], &ev);

    /* Main loop */
    while (running) {
        load_cron_tasks();

        time_t next_ts = find_next_cron_task();
        time_t now = time(NULL);

        /* Execute overdue tasks right away */
        if (now >= next_ts) {
            execute_due_tasks(now);
            if (!running) break;
            load_cron_tasks();
            next_ts = find_next_cron_task();
        }

        now = time(NULL);
        if (!running) break;
        if (now >= next_ts) continue;

        int tfd = arm_timerfd(epoll_fd, next_ts);
        if (tfd < 0) {
            log_message("Timer failed, polling...");
            sleep(DEFAULT_POLL_INTERVAL);
            continue;
        }

        log_message("Waiting for next task... (timerfd is wakeup source)");

        struct epoll_event events[4];
        int nfds = epoll_wait(epoll_fd, events, 4, -1);

        if (nfds < 0) {
            if (errno == EINTR) {
                log_message("Interrupted by signal");
                /* Only execute if still running (SIGTERM also
                 * triggers EINTR and sets running=0). */
                if (running) {
                    last_task_check = 0;
                    load_cron_tasks();
                    execute_due_tasks(time(NULL));
                }
            } else {
                log_message("epoll_wait error: %s", strerror(errno));
                sleep(5);
            }
            epoll_ctl(epoll_fd, EPOLL_CTL_DEL, tfd, NULL);
            close(tfd);
            continue;
        }

        /* Handle events — reload config first to prevent race:
         * if SIGHUP (toggle off) and timer fire in same epoll cycle,
         * timer event must use FRESH config, not the old one. */
        load_cron_tasks();

        bool timer_fired = false;
        bool sighup_fired = false;

        for (int i = 0; i < nfds; i++) {
            if (events[i].data.fd == tfd) {
                timer_fired = true;
                uint64_t exp;
                read(tfd, &exp, sizeof(exp));
                log_message("Timer fired! %lu expiration(s)", (unsigned long)exp);
                execute_due_tasks(time(NULL));
            } else if (events[i].data.fd == reload_pipe[0]) {
                char buf[64];
                if (read(reload_pipe[0], buf, sizeof(buf)) > 0) {
                    sighup_fired = true;
                    log_message("SIGHUP: reloading config");
                }
            }
        }

        /* Only SIGHUP, no timer fire — config changed but current minute
         * was never checked with the new config. Do it now (first-run
         * sentinel = check current minute only). */
        if (sighup_fired && !timer_fired) {
            last_task_check = 0;
            execute_due_tasks(time(NULL));
        }

        /* Cleanup timerfd */
        epoll_ctl(epoll_fd, EPOLL_CTL_DEL, tfd, NULL);
        close(tfd);
    }

    log_message("=== Cron Scheduler v3.0 stopped ===");
    close(epoll_fd);
    close(reload_pipe[0]);
    close(reload_pipe[1]);
    return 0;
}
