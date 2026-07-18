#!/system/bin/sh
# DailyJobs v3.1 — Boot service script
# Waits for boot, starts the C scheduler daemon, restarts on crash.

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

update_status() {
  local label="$1"
  [ -n "$MODULE_PROP" ] || return
  sed -Ei "s/^description=(\[.*][[:space:]]*)?/description=[ $label ] /g" "$MODULE_PROP" 2>/dev/null
}

# Wait for boot with timeout (120s max)
# sys.boot_completed=1 means Android is fully up,
# including data decryption. No need to check
# dev.bootcomplete (OEM-specific) or vold.decrypt.
waited=0
while [ "$waited" -lt 12 ] && [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 10
  waited=$((waited + 1))
done
sleep 30

# Start scheduler with crash recovery
while [ -f "$SCHEDULER" ]; do
  $SCHEDULER
  update_status "⚠️ Crashed"
  sleep 10
  # Don't restart if module was removed
  [ -d "/data/adb/dailyjobs" ] || break
done
