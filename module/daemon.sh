#!/system/bin/sh
# daemon.sh — DailyJobs scheduler: polls config.txt every 60s.
# Each line = HH:MM <shell command>. Pure /bin/sh, no cron.

export PATH="/data/adb/ksu/bin:$PATH"

CONFIG=/data/adb/dailyjobs/config.txt
LOG_FILE=/data/adb/dailyjobs/cron.log

# Rotate log if > 512KB
[ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 512000 ] && : > "$LOG_FILE"
echo "$(date) dailyjobs: daemon started" >> "$LOG_FILE"

while true; do
  NOW=$(date +%H:%M)

  grep -v '^#' "$CONFIG" 2>/dev/null | grep -v '^[[:space:]]*$' | while read -r time cmd; do
    [ -z "$time" ] && continue
    [ "$time" != "$NOW" ] && continue

    echo "$(date) dailyjobs: running $cmd" >> "$LOG_FILE"
    /bin/sh -c "$cmd" &
  done

  sleep 60
done
