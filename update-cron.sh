#!/system/bin/sh
MODDIR=${0%/*}
CONFIG=/data/adb/dailyjobs/config.txt
CRON_FILE=/data/adb/dailyjobs/crontabs/root
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=/data/adb/modules/dailyjobs/jobs

. "$MODDIR/busybox.sh"

mkdir -p /data/adb/dailyjobs/crontabs /data/adb/dailyjobs/.custom
: > "$CRON_FILE"

$busybox pkill -f "busybox crond.*dailyjobs" 2>/dev/null

[ -f "$LOG_FILE" ] && [ "$($busybox stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 512000 ] && : > "$LOG_FILE"

$busybox grep -v '^#' "$CONFIG" 2>/dev/null | $busybox grep -v '^[[:space:]]*$' | while read -r time action rest; do
  [ -z "$time" ] && continue
  case "$time" in [0-2][0-9]:[0-5][0-9]) ;; *) continue ;; esac
  h=${time%%:*}; m=${time##*:}
  h=$((10#$h)); m=$((10#$m))

  case "$action" in
    data|airplane) echo "$m $h * * * /system/bin/sh $JOBS_DIR/${action}_${rest}.sh" >> "$CRON_FILE" ;;
    *)       [ -n "$rest" ] && echo "$m $h * * * /system/bin/sh $JOBS_DIR/${action}_${rest}.sh" >> "$CRON_FILE" \
             || echo "$m $h * * * /system/bin/sh $JOBS_DIR/${action}.sh" >> "$CRON_FILE" ;;
  esac
done

chmod 644 "$CRON_FILE"
$busybox crond -c /data/adb/dailyjobs/crontabs
