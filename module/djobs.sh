#!/system/bin/sh
# DailyJobs v3.0 — control script
# Manages the scheduler daemon (start/stop/restart/status)

export PATH="/data/adb/ksu/bin:$PATH"

SCHEDULER=/data/adb/dailyjobs/scheduler
PID_FILE=/data/adb/dailyjobs/scheduler.pid
LOG_FILE=/data/adb/dailyjobs/run.log

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
      is_running && echo "[DailyJobs] Started OK" || echo "[DailyJobs] Start failed"
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
