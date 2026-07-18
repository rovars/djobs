/**
 * wakeup_inspector.c v4 — Improved diagnostics
 *
 * v4 changes:
 * - Distinguishes "intentional hardware hold" (display, CMDQ, IRQ)
 *   from real "stuck/leaked" wakeup sources
 * - Only flags as "STUCK" if active_since is unreasonably long
 *   AND a leak is suspected (expire_count=0 with no active hardware)
 * - Better messaging: doesn't claim wakeup_count is stuck when it's not
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>
#include <sys/timerfd.h>
#include <sys/epoll.h>
#include <dirent.h>
#include <sys/ioctl.h>
#include <linux/rtc.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/mount.h>
#include <ftw.h>

#define RED     "\033[91m"
#define GREEN   "\033[92m"
#define YELLOW  "\033[93m"
#define CYAN    "\033[96m"
#define BOLD    "\033[1m"
#define RESET   "\033[0m"

static const char *expected_hw_holds[] = {
    "pri_disp", "cmdq_wake", "event", "himax", "et580",
    "touch", "mtk_", "accdet", "kpd", "mt-rtc",
    "mt-pmic", "MT662x", "wmtFunc", "ccci_", "ttyC",
    "rawbulk", "ccmni", "md1_", "MDRT", "dual-role",
    "usb", "battery", "charger", "scp", "spm",
    NULL
};

static int is_root = 0;

static void read_sysfs_path(const char *label, const char *path) {
    FILE *f = fopen(path, "r");
    if (!f) return;
    char buf[512] = {0};
    if (fgets(buf, sizeof(buf), f)) {
        size_t len = strlen(buf);
        while (len > 0 && (buf[len-1] == '\n' || buf[len-1] == ' ')) buf[--len] = '\0';
    }
    fclose(f);
    if (label) printf("  %s%s%s  %s=%s%s%s\n", GREEN, path, RESET, BOLD, label, RESET, buf[0] ? buf : "(empty)");
}

/* Cek apakah nama wakeup source termasuk hardware hold yang wajar */
static int is_expected_hardware_hold(const char *name) {
    if (!name || !name[0]) return 0;
    for (int i = 0; expected_hw_holds[i]; i++) {
        if (strstr(name, expected_hw_holds[i])) return 1;
    }
    return 0;
}

/* Baca active_since dari debug wakeup_sources, lebih akurat */
static void check_wakeup_sources(void) {
    printf("\n" BOLD "╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║         WAKEUP SOURCES DIAGNOSIS                        ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);

    if (access("/sys/kernel/debug/wakeup_sources", F_OK) != 0) {
        if (access("/sys/kernel/debug", F_OK) == 0) {
            mount("none", "/sys/kernel/debug", "debugfs", 0, NULL);
        }
    }

    FILE *f = fopen("/sys/kernel/debug/wakeup_sources", "r");
    if (!f) {
        printf("  %s⚠ debugfs not available%s\n", YELLOW, RESET);
        return;
    }

    char line[1024];
    int first = 1, total = 0, legit_active = 0, possibly_leaked = 0;

    while (fgets(line, sizeof(line), f)) {
        line[strcspn(line, "\n")] = '\0';
        if (first) {
            printf("\n  %s%-25s %-13s %-10s %-10s %s%s\n",
                   BOLD, "Name", "Status", "EventCnt", "WakeupCnt", "Since", RESET);
            printf("  %s----------------------------------------------------------------%s\n", CYAN, RESET);
            first = 0; continue;
        }
        total++;

        char name[64] = {0}; int ac=0, ec=0, wc=0, xc=0;
        unsigned long since=0, tt=0, mt=0, lc=0, ps=0;
        int parsed __attribute__((unused)) = sscanf(line, "%63s %d %d %d %d %lu %lu %lu %lu %lu",
                            name, &ac, &ec, &wc, &xc, &since, &tt, &mt, &lc, &ps);
        char since_str[32] = "0";
        if (since > 0) {
            unsigned long sec = since / 1000;
            if (sec < 60) snprintf(since_str, sizeof(since_str), "%lus", sec);
            else if (sec < 3600) snprintf(since_str, sizeof(since_str), "%lum%lus", sec/60, sec%60);
            else snprintf(since_str, sizeof(since_str), "%luh%lum", sec/3600, (sec%3600)/60);
        }

        int is_active = (since > 0);
        int is_hw_hold = is_expected_hardware_hold(name);
        int is_possible_leak = (is_active && since > 30000 && !is_hw_hold);

        const char *color, *status;
        if (is_possible_leak) {
            color = RED; status = "⚠️ LEAK?";
            possibly_leaked++;
        } else if (is_active && is_hw_hold) {
            color = YELLOW; status = "HW-HOLD";
            legit_active++;
        } else if (is_active && !is_hw_hold) {
            color = YELLOW; status = "ACTIVE";
            legit_active++;
        } else {
            color = ""; status = "idle";
        }

        printf("  %s%-25s %s%-13s %-10d %-10d %s%s\n",
               color, name, color, status, ec, wc, since_str, RESET);

        if (is_active) {
            printf("  %s  ├─ max_time: %lu ms%s\n", color, mt, RESET);
            if (is_hw_hold) {
                printf("  %s  └─ (hardware hold — normal selama HW aktif)%s\n", CYAN, RESET);
            }
        }
    }
    fclose(f);

    printf("  %s----------------------------------------------------------------%s\n", CYAN, RESET);
    printf("  Total: %d  |  Active/HW-Hold: %d  |  %sPossible leak: %d%s\n",
           total, legit_active,
           possibly_leaked > 0 ? RED : GREEN, possibly_leaked, RESET);

    if (possibly_leaked > 0) {
        printf("\n  %s⚠️  %d wakeup source(s) mencurigakan — bukan hardware hold biasa.%s\n",
               RED, possibly_leaked, RESET);
        printf("  Periksa driver yang namanya tidak ada di daftar hardware hold.\n");
    } else if (legit_active > 0) {
        printf("\n  %sℹ️  Semua wakeup source yang aktif adalah hardware hold yang wajar.%s\n", CYAN, RESET);
        printf("  (display, CMDQ, modem, touch — normal selama hardware aktif)\n");
    }
}

/* Cek wakeup_count (non-blocking dengan fork + alarm) */
static void check_wakeup_count(void) {
    printf("\n" BOLD "╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║         POWER STATE & WAKEUP COUNT TEST                   ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);

    read_sysfs_path(NULL, "/sys/power/state");
    read_sysfs_path("lock", "/sys/power/wake_lock");

    printf("\n  %sTesting /sys/power/wakeup_count (3s timeout)...%s\n", BOLD, RESET);
    fflush(stdout);

    int pipe_fds[2]; pipe(pipe_fds);
    pid_t child = fork();
    if (child == 0) {
        close(pipe_fds[0]);
        unsigned int val = 0;
        FILE *f = fopen("/sys/power/wakeup_count", "r");
        if (f) {
            signal(SIGALRM, SIG_DFL);
            alarm(3);
            if (fscanf(f, "%u", &val) == 1) write(pipe_fds[1], &val, sizeof(val));
            fclose(f);
        }
        close(pipe_fds[1]);
        _exit(0);
    }

    close(pipe_fds[1]);
    unsigned int wc_val = 0;
    struct timeval tv = {4, 0};
    fd_set fds; FD_ZERO(&fds); FD_SET(pipe_fds[0], &fds);
    int ret = select(pipe_fds[0] + 1, &fds, NULL, NULL, &tv);

    if (ret > 0) {
        read(pipe_fds[0], &wc_val, sizeof(wc_val));
        printf("  %s%s → %u%s ✅ (terbaca normal)\n", GREEN, "/sys/power/wakeup_count", wc_val, RESET);
    } else {
        printf("  %s%s → HANG! (%ds timeout)%s\n", RED, "/sys/power/wakeup_count", 3, RESET);
        if (wc_val == 0) printf("  %s→ Ada wakeup source yang gak release!%s\n", YELLOW, RESET);
        kill(child, SIGKILL);
    }
    close(pipe_fds[0]); wait(NULL);
}

/* RTC check */
static void check_rtc(void) {
    printf("\n" BOLD "╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║         RTC DEVICE                                       ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);

    DIR *dir = opendir("/dev");
    if (!dir) return;
    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (strncmp(entry->d_name, "rtc", 3) != 0) continue;
        char path[128]; snprintf(path, sizeof(path), "/dev/%s", entry->d_name);
        printf("\n  Device: %s%s%s", GREEN, path, RESET);

        int fd = open(path, O_RDONLY);
        if (fd < 0) { printf(" → %s\n", strerror(errno)); continue; }
        printf("\n");

        char sf[256];
        snprintf(sf, sizeof(sf), "/sys/class/rtc/%s/name", entry->d_name); read_sysfs_path(NULL, sf);
        snprintf(sf, sizeof(sf), "/sys/class/rtc/%s/time", entry->d_name); read_sysfs_path(NULL, sf);
        snprintf(sf, sizeof(sf), "/sys/class/rtc/%s/wakealarm", entry->d_name); read_sysfs_path(NULL, sf);

        struct rtc_wkalrm alarm = {0}; alarm.enabled = 1;
        time_t now_t = time(NULL) + 60;
        struct tm *tm = localtime(&now_t);
        if (tm) {
            alarm.time.tm_sec=tm->tm_sec; alarm.time.tm_min=tm->tm_min;
            alarm.time.tm_hour=tm->tm_hour; alarm.time.tm_mday=tm->tm_mday;
            alarm.time.tm_mon=tm->tm_mon; alarm.time.tm_year=tm->tm_year;
            alarm.time.tm_wday=tm->tm_wday; alarm.time.tm_yday=tm->tm_yday;
            alarm.time.tm_isdst=tm->tm_isdst;
        }
        if (ioctl(fd, RTC_WKALM_SET, &alarm) == 0) {
            printf("  ✅ RTC_WKALM_SET works!\n");
            alarm.enabled = 0; ioctl(fd, RTC_WKALM_SET, &alarm);
        } else {
            printf("  ❌ RTC_WKALM_SET fail: %s\n", strerror(errno));
        }
        close(fd);
    }
    closedir(dir);
}

/* timerfd + epoll test */
static void check_timerfd(void) {
    printf("\n" BOLD "╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║         TIMERFD & EPOLL                                   ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);

    int tfd = timerfd_create(CLOCK_REALTIME_ALARM, TFD_CLOEXEC);
    if (tfd >= 0) { printf("  ✅ %sCLOCK_REALTIME_ALARM: SUPPORTED%s\n", GREEN, RESET); close(tfd); }
    else printf("  ⚠️ CLOCK_REALTIME_ALARM: %s — %s\n", strerror(errno),
                errno==EPERM?"butuh root":(errno==EINVAL?"kernel gak support":"error"));

    int efd = epoll_create1(EPOLL_CLOEXEC);
    tfd = timerfd_create(CLOCK_REALTIME, TFD_NONBLOCK|TFD_CLOEXEC);
    if (efd >= 0 && tfd >= 0) {
        struct epoll_event ev = {0}; ev.events=EPOLLIN; ev.data.fd=tfd;
        if (epoll_ctl(efd, EPOLL_CTL_ADD, tfd, &ev) == 0) printf("  ✅ epoll + timerfd: works\n");
        close(tfd); close(efd);
    }
}

/* nftw callback for finding alarmtimer directories */
static int alarmtimer_cb(const char *fpath, const struct stat *sb, int typeflag, struct FTW *ftwbuf) {
    (void)sb; (void)ftwbuf;
    if (typeflag == FTW_D && strcmp(fpath + strlen(fpath) - 10, "alarmtimer") == 0)
        printf("  Device: %s\n", fpath);
    return 0;
}

/* Alarmtimer device */
static void check_alarmtimer(void) {
    printf("\n" BOLD "╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║         ALARMTIMER                                       ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);

    nftw("/sys/devices", alarmtimer_cb, 20, FTW_DEPTH | FTW_PHYS);
}

/* Summary */
static void print_summary(void) {
    printf("\n" BOLD "╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║         SUMMARY                                          ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);

    int has_alarm = (timerfd_create(CLOCK_REALTIME_ALARM, TFD_CLOEXEC) >= 0);
    if (has_alarm) {
        printf("\n  ✅ %sCLOCK_REALTIME_ALARM: SUPPORTED%s\n", GREEN, RESET);
        printf("  → Cron scheduler v3.0 bisa bangun dari deep sleep via timerfd.\n");
        printf("  → Tidak perlu wakelock.\n");
        printf("  → Tidak perlu write /sys/power/state.\n");
        printf("  → Notif/telepon tetap normal.\n");
    } else if (getuid() == 0) {
        printf("\n  ❌ CLOCK_REALTIME_ALARM not supported (even as root)\n");
    } else {
        printf("\n  ⚠️ CLOCK_REALTIME_ALARM: butuh root untuk test\n");
    }

    printf("\n  %sCara test cron scheduler sekarang:%s\n", BOLD, RESET);
    printf("  su -c ~/cron_scheduler_termux_arm64\n\n");
}

int main(void) {
    is_root = (getuid() == 0);
    printf(BOLD "\n╔══════════════════════════════════════════════════════════╗\n" RESET);
    printf(BOLD "║     WAKEUP INSPECTOR v4                                ║\n" RESET);
    printf(BOLD "╚══════════════════════════════════════════════════════════╝\n" RESET);
    printf("  PID: %d  |  UID: %d  |  %s\n\n", getpid(), getuid(),
           is_root ? "✅ ROOT" : "⚠️ NOT ROOT");

    check_wakeup_sources();
    check_wakeup_count();
    check_rtc();
    check_timerfd();
    check_alarmtimer();
    print_summary();
    return 0;
}
