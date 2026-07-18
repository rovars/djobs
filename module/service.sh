#!/system/bin/sh
# DailyJobs v3.0 — Boot service script
# Waits for boot, then starts the C scheduler daemon.

export PATH="/data/adb/ksu/bin:$PATH"

SCHEDULER=/data/adb/dailyjobs/scheduler

# Wait for boot completion
while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 5
done
sleep 15

# Start scheduler daemon if binary exists
if [ -f "$SCHEDULER" ]; then
  $SCHEDULER
fi
