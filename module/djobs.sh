#!/system/bin/sh
# DailyJobs v3.4 — control script
# Manages the scheduler daemon (start/stop/restart/status)

PATH=/data/adb/ap/bin:/data/adb/ksu/bin:/data/adb/magisk:$PATH
MODDIR=/data/adb/modules/dailyjobs
PERSISTENT_DIR=/data/adb/dailyjobs
export TZ=$(getprop persist.sys.timezone 2>/dev/null)

SCHEDULER=/data/adb/dailyjobs/scheduler
PID_FILE=/data/adb/dailyjobs/scheduler.pid
LOG_FILE=/data/adb/dailyjobs/run.log
WAIT_TIMEOUT=5  # max seconds to wait for graceful stop
DISABLE_FILE="/data/adb/modules/dailyjobs/disable"

# Auto-detect module.prop path (KSU / APatch / Magisk)
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

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# Kill all child processes of the scheduler
kill_children() {
  local ppid="$1"
  [ -z "$ppid" ] && return
  # Children first, then parent (reverse order)
  pkill -P "$ppid" 2>/dev/null || true
  kill -0 "$ppid" 2>/dev/null && kill "$ppid" 2>/dev/null
}

case "${1:-status}" in
  start)
    if [ -f "$PID_FILE" ]; then
      local old_pid
      old_pid=$(cat "$PID_FILE")
      if kill -0 "$old_pid" 2>/dev/null; then
        echo "[DailyJobs] Already running (PID $old_pid)"
        exit 0
      fi
      # Stale PID file — clean it
      echo "[DailyJobs] Removing stale PID file"
      rm -f "$PID_FILE"
    fi
    if [ ! -f "$SCHEDULER" ]; then
      echo "[DailyJobs] Binary not found: $SCHEDULER"
      exit 1
    fi
    echo "[DailyJobs] Starting scheduler..."
    $SCHEDULER
    # Wait for PID file to appear (with timeout)
    local waited=0
    while [ "$waited" -lt 5 ]; do
      [ -f "$PID_FILE" ] && break
      sleep 1
      waited=$((waited + 1))
    done
    if is_running; then
      echo "[DailyJobs] Started OK (PID $(cat "$PID_FILE"))"
      update_status "✅ Running"
    else
      echo "[DailyJobs] Start failed"
      exit 1
    fi
    ;;
  stop)
    if [ ! -f "$PID_FILE" ]; then
      echo "[DailyJobs] Not running (no PID file)"
      update_status "⏹ Stopped"
      exit 0
    fi
    local pid
    pid=$(cat "$PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[DailyJobs] Not running (stale PID)"
      rm -f "$PID_FILE"
      update_status "⏹ Stopped"
      exit 0
    fi
    echo "[DailyJobs] Stopping scheduler (PID $pid)..."
    kill_children "$pid"
    # Wait for graceful exit
    local waited=0
    while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    # Force kill if still alive
    if kill -0 "$pid" 2>/dev/null; then
      echo "[DailyJobs] Force killing scheduler..."
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "[DailyJobs] Stopped"
    update_status "⏹ Stopped"
    ;;
  restart)
    local old_pid=""
    [ -f "$PID_FILE" ] && old_pid=$(cat "$PID_FILE")
    "$0" stop
    # Wait for old process to fully exit
    if [ -n "$old_pid" ]; then
      local waited=0
      while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
        if ! kill -0 "$old_pid" 2>/dev/null; then
          break
        fi
        sleep 1
        waited=$((waited + 1))
      done
    fi
    "$0" start
    ;;
  status)
    if is_running; then
      echo "[DailyJobs] Running (PID $(cat "$PID_FILE"))"
      if [ -f "$LOG_FILE" ]; then
        tail -3 "$LOG_FILE"
      else
        echo "[DailyJobs] No log file yet"
      fi
    else
      echo "[DailyJobs] Stopped"
    fi
    ;;
  logs)
    if [ -f "$LOG_FILE" ]; then
      tail -n "${2:-50}" "$LOG_FILE"
    else
      echo "[DailyJobs] No log file"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
