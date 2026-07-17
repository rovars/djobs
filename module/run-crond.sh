#!/bin/sh
# run-crond.sh — daemon wrapper for KernelSU initrc service.
# Called by init via initrc/crond.rc at boot_completed.
# Builds crontab then exec's crond -f so init tracks its PID directly.

export PATH="/data/adb/ksu/bin:$PATH"

MODDIR=/data/adb/modules/dailyjobs
CONFIG=/data/adb/dailyjobs/config.txt
CRON_DIR=/data/adb/dailyjobs/crontabs
CRON_FILE=$CRON_DIR/root
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=$MODDIR/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p "$CRON_DIR" "$CUSTOM_DIR"

# Rotate log if > 500 KB
if [ -f "$LOG_FILE" ]; then
  size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  [ "$size" -gt 512000 ] && : > "$LOG_FILE"
fi

if ! command -v crond >/dev/null 2>&1; then
  echo "$(date) dailyjobs: busybox crond not found, will retry on next start" >> "$LOG_FILE"
  exit 0
fi

# === Build crontab ===
: > "$CRON_FILE"

find_script() {
  local name="$1"
  if [ -f "$CUSTOM_DIR/$name" ]; then
    echo "$CUSTOM_DIR/$name"
  elif [ -f "$JOBS_DIR/$name" ]; then
    echo "$JOBS_DIR/$name"
  fi
}

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

  echo "$m $h * * * /bin/sh $script" >> "$CRON_FILE"
done

chmod 644 "$CRON_FILE"

echo "$(date) dailyjobs: crontab rebuilt, starting crond" >> "$LOG_FILE"

exec busybox crond -c "$CRON_DIR" -f
