#!/system/bin/sh
MODDIR=${0%/*}
CONFIG=/data/adb/dailyjobs/config.txt
CRON_FILE=/data/adb/dailyjobs/crontabs/root
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=/data/adb/modules/dailyjobs/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom

. "$MODDIR/busybox.sh"

mkdir -p /data/adb/dailyjobs/crontabs "$CUSTOM_DIR"
: > "$CRON_FILE"

$busybox pkill -f "busybox crond.*dailyjobs" 2>/dev/null

# Rotate log if >500K
[ -f "$LOG_FILE" ] && [ "$($busybox stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 512000 ] && : > "$LOG_FILE"

# Look up script: CUSTOM_DIR > JOBS_DIR
find_script() {
  local name="$1"
  if [ -f "$CUSTOM_DIR/$name" ]; then
    echo "$CUSTOM_DIR/$name"
  elif [ -f "$JOBS_DIR/$name" ]; then
    echo "$JOBS_DIR/$name"
  fi
}

$busybox grep -v '^#' "$CONFIG" 2>/dev/null | $busybox grep -v '^[[:space:]]*$' | while read -r time action rest; do
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
      # Try action_rest.sh then action.sh
      script_path=""
      [ -n "$rest" ] && script_path=$(find_script "${action}_${rest}.sh")
      [ -z "$script_path" ] && script_path=$(find_script "${action}.sh")
      [ -z "$script_path" ] && script_path="$CUSTOM_DIR/${action}.sh"  # fallback biar crond logged
      script="$script_path"
      ;;
  esac

  echo "$m $h * * * /system/bin/sh $script" >> "$CRON_FILE"
done

chmod 644 "$CRON_FILE"
nohup $busybox crond -c /data/adb/dailyjobs/crontabs >/dev/null 2>&1 &
