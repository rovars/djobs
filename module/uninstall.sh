#!/system/bin/sh
# Remove DailyJobs runtime data

SCHEDULER=/data/adb/dailyjobs/scheduler
PID_FILE=/data/adb/dailyjobs/scheduler.pid
SERVICE_SCRIPT=/data/adb/service.d/dailyjobs.sh
DATA_DIR=/data/adb/dailyjobs

# Stop scheduler if running
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$PID" ]; then
    # Kill children first, then parent
    pkill -P "$PID" 2>/dev/null || true
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Remove boot service
rm -f "$SERVICE_SCRIPT"

# Remove scheduler binary
rm -f "$SCHEDULER"

# Ask about config+logs (silently skip if non-interactive)
if [ -t 0 ]; then
  echo ""
  echo "  Remove config.txt and run.log? (y/N)"
  read -r ans
  case "$ans" in
    y|Y|yes|YES)
      rm -rf "$DATA_DIR"
      echo "  Removed: $DATA_DIR"
      ;;
    *)
      echo "  Preserved: $DATA_DIR/config.txt"
      echo "  Preserved: $DATA_DIR/run.log"
      ;;
  esac
fi
