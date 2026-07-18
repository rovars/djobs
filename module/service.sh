#!/system/bin/sh
# DailyJobs v3.1 — Boot service script
# Waits for boot, then starts the C scheduler daemon.

export PATH="/data/adb/ksu/bin:$PATH"

SCHEDULER=/data/adb/dailyjobs/scheduler
PID_FILE=/data/adb/dailyjobs/scheduler.pid

# Auto-detect module.prop path
MODULE_PROP=""
for d in /data/adb/ksu/modules/dailyjobs/module.prop \
          /data/adb/ap/modules/dailyjobs/module.prop \
          /data/adb/modules/dailyjobs/module.prop; do
  [ -f "$d" ] && MODULE_PROP="$d" && break
done

# Wait for boot
while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 5
done
sleep 15

# Start scheduler
if [ -f "$SCHEDULER" ]; then
  $SCHEDULER
  sleep 2
  if [ -n "$MODULE_PROP" ] && [ -f "$PID_FILE" ]; then
    sed -Ei "s/^description=(\[.*][[:space:]]*)?/description=[ ✅ Running ] /g" "$MODULE_PROP" 2>/dev/null
  fi
fi
