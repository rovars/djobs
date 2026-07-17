#!/system/bin/sh
MODDIR=${0%/*}
CRT_DIR=/data/adb/dailyjobs/crontabs

. "$MODDIR/busybox.sh"

sleep 30
sh "$MODDIR/update-cron.sh"
$busybox pgrep -f "crond.*$CRT_DIR" >/dev/null || $busybox crond -c "$CRT_DIR"