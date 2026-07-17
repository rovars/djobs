#!/system/bin/sh
# daemon.sh — DailyJobs scheduler: polls config.txt every 60s.
# Called by init via initrc/daemon.rc at boot_completed.
# No crond, no cron, no busybox dependencies — pure /bin/sh loop.

export PATH="/data/adb/ksu/bin:$PATH"

CONFIG=/data/adb/dailyjobs/config.txt
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=/data/adb/modules/dailyjobs/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p "$CUSTOM_DIR"

# Rotate log if > 512KB
[ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 512000 ] && : > "$LOG_FILE"
echo "$(date) dailyjobs: daemon started" >> "$LOG_FILE"

while true; do
  NOW=$(date +%H:%M)

  grep -v '^#' "$CONFIG" 2>/dev/null | grep -v '^[[:space:]]*$' | while read -r time action sub; do
    [ -z "$time" ] && continue
    [ "$time" != "$NOW" ] && continue

    # Resolve script: custom dir takes precedence over built-in jobs dir
    case "$action" in
      data|airplane)
        script="$CUSTOM_DIR/${action}_${sub}.sh"
        [ -f "$script" ] || script="$JOBS_DIR/${action}_${sub}.sh"
        ;;
      *)
        script="$CUSTOM_DIR/${action}_${sub}.sh"
        [ -f "$script" ] || script="$CUSTOM_DIR/${action}.sh"
        [ -f "$script" ] || script="$JOBS_DIR/${action}.sh"
        ;;
    esac

    [ -f "$script" ] || continue

    echo "$(date) dailyjobs: running $action $sub" >> "$LOG_FILE"
    /bin/sh "$script" &
  done

  sleep 60
done
