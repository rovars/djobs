# Changelog

## v3.3
- Fix: dialogs not opening (CSS selector prefix bug in $())
- Fix: FAB replaced with wide text-only button
- Fix: Google Fonts CDN removed (privacy)
- Fix: yellow/gold accent replaced with slate gray
- Fix: unused Material Symbols icon dependency removed
- Security: atomic config write, popen() replaced, escHtml improved

## v3.2
- Fix: 8x duplicate execution on SIGHUP (EINTR + pipe race)
- Fix: stale PID / dual daemon / orphan children in control scripts
- Fix: SIGTERM ignored during task execution
- Fix: SIGTERM EINTR falsely triggering task execution
- Fix: child_count RMW race (atomic counter via stdatomic.h)
- Fix: MAX_CHILDREN=8 fork bomb guard
- Fix: uninstall now always removes everything (no silent prompt)
- Fix: webui index-based operations replaced with stable IDs
- Fix: webui deleteFromEdit was no-op (missing deleteId)
- Fix: shell injection via innerHTML (escHtml sanitization)
- Feat: FAB + dialog for adding jobs (was inline form)
- Feat: input validation for cron/time format client-side
- Feat: crash recovery in boot service (auto-restart loop)
- Build: use gnu11 + stdatomic.h (fix zig cc compatibility)

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
