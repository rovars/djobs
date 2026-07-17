#!/bin/sh
# run-crond.sh — daemon wrapper for KernelSU initrc service
#
# Called by init via initrc/crond.rc (or directly by service.sh as fallback).
# Generates the crontab from config.txt, then exec's crond in foreground
# so init tracks crond's PID directly.
#
# When this process dies (e.g. after a crontab reload), init's "critical"
# flag restarts it immediately — no watchdog loop needed.

MODDIR=/data/adb/modules/dailyjobs
CONFIG=/data/adb/dailyjobs/config.txt
CRON_DIR=/data/adb/dailyjobs/crontabs
CRON_FILE=$CRON_DIR/root
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=$MODDIR/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom
BB=busybox

mkdir -p "$CRON_DIR" "$CUSTOM_DIR"

# Rotate log if > 500 KB
if [ -f "$LOG_FILE" ]; then
  size=$($BB stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  [ "$size" -gt 512000 ] && : > "$LOG_FILE"
fi

# Sanity check
if ! $BB crond -h >/dev/null 2>&1 && [ "$($BB 2>&1 | grep -c crond)" = "0" ]; then
  echo "$(date) ERROR: busybox ($BB) has no crond applet" >> "$LOG_FILE"
  exit 1
fi

# ---- Build crontab ----
: > "$CRON_FILE"

# Resolve a job script: custom dir takes precedence over built-in jobs dir
find_script() {
  local name="$1"
  if [ -f "$CUSTOM_DIR/$name" ]; then
    echo "$CUSTOM_DIR/$name"
  elif [ -f "$JOBS_DIR/$name" ]; then
    echo "$JOBS_DIR/$name"
  fi
}

$BB grep -v '^#' "$CONFIG" 2>/dev/null | $BB grep -v '^[[:space:]]*$' | while read -r time action rest; do
  [ -z "$time" ] && continue
  case "$time" in [0-2][0-9]:[0-5][0-9]) ;; *) continue ;; esac
  h=${time%%:*}; m=${time##*:}
  h=$((10#$h)); m=$((10#$m))

  case "$action" in
    data|airplane)
      script=$(find_script "${action}_${rest}.sh")
      [ -z "$script" ] && script="$JOBS_DIR/${action}_${rest}.sh"
      ;;
    *)
      script=""
      [ -n "$rest" ] && script=$(find_script "${action}_${rest}.sh")
      [ -z "$script" ] && script=$(find_script "${action}.sh")
      [ -z "$script" ] && script="$CUSTOM_DIR/${action}.sh"
      ;;
  esac

  echo "$m $h * * * /bin/sh $script" >> "$CRON_FILE"
done

chmod 644 "$CRON_FILE"

echo "$(date) DailyJobs crontab rebuilt, starting crond" >> "$LOG_FILE"

# ---- Exec crond in foreground ----
# init tracks THIS PID; when crond dies, critical restarts us.
exec $BB crond -c "$CRON_DIR" -f
