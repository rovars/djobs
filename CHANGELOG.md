# Changelog

## v3.1
- Fix: `-c` and `-p` CLI flags now work (were parsed but ignored)
- Fix: add() was missing `writeConfigFile()` — tasks never saved
- Fix: delete job stale index bug (identity-based now)
- Fix: race when task toggled OFF right before execution
- Feat: Delete button inside Edit dialog
- Refactor: long-press to delete (was swipe)
- Refactor: add form with separate Time + Command fields
- WebUI bug fixes: null reference, dead code, cascading errors

## v3.0 — C Scheduler
- Complete rewrite in C (was shell script)
- `timerfd(CLOCK_REALTIME_ALARM)` — wakeup source, no wakelock needed
- `epoll_wait(-1)` — 0% CPU when idle
- RTC HW alarm — deep sleep safe, notif tetap normal
- Config supports both cron and HH:MM format
- Fix: zombie process, DST safety, missed task detection
- SIGHUP reload config
- ARM64 static binary (~64KB)

## v2.0
- WebUI for task management (vite + material web)
- KernelSU module packaging
- RTC wakealarm support

## v1.0
- Initial release — pure shell scheduler
- HH:MM format config
- Basic service.d boot script
