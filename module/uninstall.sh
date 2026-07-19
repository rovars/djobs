#!/system/bin/sh
# Remove DailyJobs runtime data

PERSISTENT_DIR=/data/adb/dailyjobs

# Stop daemon via CLI if available
if [ -x /data/adb/dailyjobs/bin/djobs ]; then
  /data/adb/dailyjobs/bin/djobs stop 2>/dev/null || true
elif [ -f /data/adb/dailyjobs/scheduler.pid ]; then
  PID=$(cat /data/adb/dailyjobs/scheduler.pid 2>/dev/null)
  if [ -n "$PID" ]; then
    pkill -P "$PID" 2>/dev/null || true
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
fi

# Remove boot service
rm -f /data/adb/service.d/dailyjobs.sh

# Remove all runtime data (config, logs, binaries, everything)
rm -rf "$PERSISTENT_DIR"
