#!/system/bin/sh
# djobs.sh — DailyJobs scheduler: polls config.txt every 60s.
# Each line = HH:MM <shell command>. Pure /bin/sh, no cron.
# Sets RTC wakealarm to wake device from deep sleep for next job.

export PATH="/data/adb/ksu/bin:$PATH"

CONFIG=/data/adb/dailyjobs/config.txt
LOG_FILE=/data/adb/dailyjobs/cron.log

# Rotate log if > 512KB
[ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 512000 ] && : > "$LOG_FILE"
echo "$(date) dailyjobs: daemon started" >> "$LOG_FILE"

while true; do
  NOW=$(date +%H:%M)

  # Set RTC wakealarm for the nearest job
  NEXT_JOB=$(grep -v '^#' "$CONFIG" 2>/dev/null | grep -v '^[[:space:]]*$' | \
    awk -v now="$NOW" '{if ($1 > now) {print $1; exit}}')
  if [ -z "$NEXT_JOB" ]; then
    # No more jobs today — pick tomorrow's first
    NEXT_JOB=$(grep -v '^#' "$CONFIG" 2>/dev/null | grep -v '^[[:space:]]*$' | \
      awk '{print $1; exit}')
  fi

  if [ -n "$NEXT_JOB" ]; then
    # Convert HH:MM to epoch seconds
    H=${NEXT_JOB%%:*}
    M=${NEXT_JOB##*:}
    JOB_EPOCH=$(date +%s -d "$H:$M" 2>/dev/null)
    NOW_EPOCH=$(date +%s)
    if [ -n "$JOB_EPOCH" ] && [ "$JOB_EPOCH" -lt "$NOW_EPOCH" ]; then
      JOB_EPOCH=$((JOB_EPOCH + 86400))  # next day
    fi
    if [ -n "$JOB_EPOCH" ]; then
      # Alarm 30s early to account for kernel resume time
      WAKE=$((JOB_EPOCH - 30))
      echo "$WAKE" > /sys/class/rtc/rtc0/wakealarm 2>/dev/null || true
    fi
  fi

  # Run jobs matching current time
  grep -v '^#' "$CONFIG" 2>/dev/null | grep -v '^[[:space:]]*$' | while read -r time cmd; do
    [ -z "$time" ] && continue
    [ "$time" != "$NOW" ] && continue

    echo "$(date) dailyjobs: running $cmd" >> "$LOG_FILE"
    /bin/sh -c "$cmd" &
  done

  sleep 60
done
