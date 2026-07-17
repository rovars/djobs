#!/bin/sh
# update-cron.sh — rebuild crontab from config.txt and reload crond via SIGHUP.
#
# Called by:
#   - run-crond.sh          once at boot (via initrc)
#   - WebUI                 on every add/edit/toggle/delete

export PATH="/data/adb/ksu/bin:$PATH"

CONFIG=/data/adb/dailyjobs/config.txt
CRON_DIR=/data/adb/dailyjobs/crontabs
CRON_FILE=$CRON_DIR/root
CRON_FILE_TMP=$CRON_DIR/.root.tmp
LOG_FILE=/data/adb/dailyjobs/cron.log
MODDIR=/data/adb/modules/dailyjobs
JOBS_DIR=$MODDIR/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p "$CRON_DIR" "$CUSTOM_DIR"

# Rotate log if > 500 KB
if [ -f "$LOG_FILE" ]; then
  size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  [ "$size" -gt 512000 ] && : > "$LOG_FILE"
fi

if ! busybox crond -h >/dev/null 2>&1; then
  echo "$(date) dailyjobs: busybox crond not found, aborting" >> "$LOG_FILE"
  exit 0
fi

# === Build crontab ===
find_script() {
  local name="$1"
  if [ -f "$CUSTOM_DIR/$name" ]; then
    echo "$CUSTOM_DIR/$name"
  elif [ -f "$JOBS_DIR/$name" ]; then
    echo "$JOBS_DIR/$name"
  fi
}

: > "$CRON_FILE_TMP"

busybox grep -v '^#' "$CONFIG" 2>/dev/null | busybox grep -v '^[[:space:]]*$' | while read -r time action rest; do
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

  echo "$m $h * * * /bin/sh $script" >> "$CRON_FILE_TMP"
done

mv "$CRON_FILE_TMP" "$CRON_FILE"
chmod 644 "$CRON_FILE"

# === Reload crond via SIGHUP ===
CROND_PID=$(busybox pgrep -f "busybox crond.*dailyjobs" 2>/dev/null | head -1)
if [ -n "$CROND_PID" ]; then
  kill -HUP "$CROND_PID" 2>/dev/null
  echo "$(date) dailyjobs: crontab rebuilt, crond reloaded (PID $CROND_PID)" >> "$LOG_FILE"
  exit 0
fi

# crond not running — wait for initrc to restart it
echo "$(date) dailyjobs: crond not running, initrc will restart it shortly" >> "$LOG_FILE"
