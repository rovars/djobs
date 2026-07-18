#!/system/bin/sh
# DailyJobs v3.1 — Boot service script
# Waits for boot, starts the C scheduler daemon, restarts on crash.

export PATH="/data/adb/ksu/bin:$PATH"

SCHEDULER=/data/adb/dailyjobs/scheduler
PID_FILE=/data/adb/dailyjobs/scheduler.pid
MODULE_DIR="/data/adb/modules/dailyjobs"
DISABLE_FILE="$MODULE_DIR/disable"

# Auto-detect module.prop path
MODULE_PROP=""
for d in /data/adb/ksu/modules/dailyjobs/module.prop \
          /data/adb/ap/modules/dailyjobs/module.prop \
          /data/adb/modules/dailyjobs/module.prop; do
  [ -f "$d" ] && MODULE_PROP="$d" && break
done

update_status() {
  local label="$1"
  [ -n "$MODULE_PROP" ] || return
  sed -Ei "s/^description=(\[.*][[:space:]]*)?/description=[ $label ] /g" "$MODULE_PROP" 2>/dev/null
}

# Wait for boot with timeout (120s max)
waited=0
while [ "$waited" -lt 12 ] && [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 10
  waited=$((waited + 1))
done
sleep 30

# Stop if module was disabled (via /data/adb/modules/dailyjobs/disable)
if [ -f "$DISABLE_FILE" ]; then
  update_status "⏹ Disabled"
  exit 0
fi

# Start scheduler (daemonizes, exits immediately)
if [ -f "$SCHEDULER" ]; then
  $SCHEDULER
  sleep 2
  if [ -f "$PID_FILE" ]; then
    update_status "✅ Running"
  fi
fi
