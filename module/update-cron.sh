#!/bin/sh
# update-cron.sh — (re)build crontab from config.txt, then reload crond.
#
# Behaviour by environment:
#   initrc (KSU)  — crond runs via run-crond.sh under init; SIGHUP reloads crontab.
#                   If crond is dead, init's "critical" flag restarts it.
#   Legacy        — crond runs via nohup; if dead we start a new instance.
#   (Magisk/APatch)
#
# This script is called by:
#   - service.sh         once at boot (generates initial crontab)
#   - WebUI              on every add/edit/toggle/delete of a schedule entry

export PATH="/data/adb/magisk:/data/adb/ksu/bin:/data/adb/ap/bin:/system/bin:/system/xbin:$PATH"

MODDIR=${0%/*}
CONFIG=/data/adb/dailyjobs/config.txt
CRON_DIR=/data/adb/dailyjobs/crontabs
CRON_FILE=$CRON_DIR/root
CRON_FILE_TMP=$CRON_DIR/.root.tmp
LOG_FILE=/data/adb/dailyjobs/cron.log
JOBS_DIR=$MODDIR/jobs
CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p "$CRON_DIR" "$CUSTOM_DIR"

# Rotate log if > 500 KB
if [ -f "$LOG_FILE" ]; then
  size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  [ "$size" -gt 512000 ] && : > "$LOG_FILE"
fi

# Sanity check — if no crond, log and exit (service.sh already has PATH)
if ! busybox crond -h >/dev/null 2>&1; then
  echo "$(date) dailyjobs: busybox crond not found, aborting" >> "$LOG_FILE"
  exit 0
fi

# ============================================================
# Build crontab (write to tmp then atomic rename)
# ============================================================

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

# Atomic move so crond never reads a half-written file
mv "$CRON_FILE_TMP" "$CRON_FILE"
chmod 644 "$CRON_FILE"

# ============================================================
# Reload crond
# ============================================================

# First try SIGHUP (reload crontab without restarting)
CROND_PIDS=$(busybox pgrep -f "busybox crond.*dailyjobs" 2>/dev/null)
if [ -n "$CROND_PIDS" ]; then
  # Busybox crond re-reads crontabs on SIGHUP
  # shellcheck disable=SC2086
  kill -HUP $CROND_PIDS 2>/dev/null
  echo "$(date) crontab rebuilt, crond reloaded (PID $CROND_PIDS)" >> "$LOG_FILE"
  exit 0
fi

# crond is not running — try to start it.
# On KernelSU with initrc, "critical" flag will restart it automatically;
# the sleep below gives init a moment to react.
# On legacy (Magisk/APatch), start crond ourselves.

if [ -f "$MODDIR/initrc/crond.rc" ]; then
  # KernelSU initrc is present — init should restart crond via critical flag.
  # Wait a moment for init to react, then check.
  sleep 2
  CROND_PIDS=$(busybox pgrep -f "busybox crond.*dailyjobs" 2>/dev/null)
  if [ -n "$CROND_PIDS" ]; then
    echo "$(date) crontab rebuilt, crond restarted by init (PID $CROND_PIDS)" >> "$LOG_FILE"
    exit 0
  fi
fi

# Fallback (Magisk / APatch / late-load mode): start crond ourselves.
# Use setsid + nohup to isolate from shell lifetime.
nohup busybox crond -c "$CRON_DIR" >/dev/null 2>&1 &
CROND_PID=$!
sleep 1
echo -1000 > /proc/$CROND_PID/oom_score_adj 2>/dev/null
renice -n 19 -p $CROND_PID 2>/dev/null
echo "$(date) crontab rebuilt, crond started via fallback (PID $CROND_PID)" >> "$LOG_FILE"
