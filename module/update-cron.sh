#!/system/bin/sh
# Regenerate crontab from /data/adb/dailyjobs/config.txt and (re)start crond.

MODDIR=${0%/*}
CONFIG=/data/adb/dailyjobs/config.txt
CRON_DIR=/data/adb/dailyjobs/crontabs
CRON_FILE=$CRON_DIR/root
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=/data/adb/modules/dailyjobs/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom

# Resolve busybox (KSU/Magisk/APatch all expose it; prefer PATH, then known locations)
BB=$(command -v busybox 2>/dev/null)
[ -z "$BB" ] && [ -f /data/adb/magisk/busybox ] && BB=/data/adb/magisk/busybox
[ -z "$BB" ] && [ -f /data/adb/ksu/bin/busybox ] && BB=/data/adb/ksu/bin/busybox
[ -z "$BB" ] && [ -f /data/adb/ap/bin/busybox ] && BB=/data/adb/ap/bin/busybox
[ -z "$BB" ] && BB=busybox

mkdir -p "$CRON_DIR" "$CUSTOM_DIR"
: > "$CRON_FILE"

# Stop any previous instance
$BB pkill -f "busybox crond.*dailyjobs" 2>/dev/null

# Rotate log if > 500K
if [ -f "$LOG_FILE" ]; then
  size=$($BB stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  [ "$size" -gt 512000 ] && : > "$LOG_FILE"
fi

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
      # Try action_rest.sh, then action.sh
      script=""
      [ -n "$rest" ] && script=$(find_script "${action}_${rest}.sh")
      [ -z "$script" ] && script=$(find_script "${action}.sh")
      [ -z "$script" ] && script="$CUSTOM_DIR/${action}.sh"  # fallback so crond logs the miss
      ;;
  esac

  echo "$m $h * * * /system/bin/sh $script" >> "$CRON_FILE"
done

chmod 644 "$CRON_FILE"
nohup $BB crond -c "$CRON_DIR" >/dev/null 2>&1 &
