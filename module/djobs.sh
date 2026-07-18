#!/system/bin/sh
# DailyJobs v3.1 — control script
# Manages the scheduler daemon (start/stop/restart/status)

export PATH="/data/adb/ksu/bin:$PATH"

SCHEDULER=/data/adb/dailyjobs/scheduler
PID_FILE=/data/adb/dailyjobs/scheduler.pid
LOG_FILE=/data/adb/dailyjobs/run.log

# Auto-detect module.prop path (KSU / APatch / Magisk)
MODULE_PROP=""
for d in /data/adb/ksu/modules/dailyjobs/module.prop \
          /data/adb/ap/modules/dailyjobs/module.prop \
          /data/adb/modules/dailyjobs/module.prop; do
  [ -f "$d" ] && MODULE_PROP="$d" && break
done

update_status() {
  local label="$1"  # e.g. "✅ Running" or "⏹ Stopped"
  [ -n "$MODULE_PROP" ] || return
  sed -Ei "s/^description=(\[.*][[:space:]]*)?/description=[ $label ] /g" "$MODULE_PROP" 2>/dev/null
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-status}" in
  start)
    if is_running; then
      echo "[DailyJobs] Already running (PID $(cat "$PID_FILE"))"
    elif [ -f "$SCHEDULER" ]; then
      echo "[DailyJobs] Starting scheduler..."
      $SCHEDULER
      sleep 1
      if is_running; then
        echo "[DailyJobs] Started OK"
        update_status "✅ Running"
      else
        echo "[DailyJobs] Start failed"
      fi
    else
      echo "[DailyJobs] Binary not found: $SCHEDULER"
      exit 1
    fi
    ;;
  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      kill "$PID" 2>/dev/null && echo "[DailyJobs] Stopped PID $PID" || echo "[DailyJobs] No process $PID"
      rm -f "$PID_FILE"
      update_status "⏹ Stopped"
    else
      echo "[DailyJobs] Not running (no PID file)"
    fi
    ;;
  restart)
    $0 stop; sleep 1; $0 start
    ;;
  status)
    if is_running; then
      echo "[DailyJobs] Running (PID $(cat "$PID_FILE"))"
      [ -f "$LOG_FILE" ] && tail -3 "$LOG_FILE"
    else
      echo "[DailyJobs] Stopped"
    fi
    ;;
  logs)
    [ -f "$LOG_FILE" ] && tail -n "${2:-50}" "$LOG_FILE" || echo "[DailyJobs] No log file"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    ;;
esac
