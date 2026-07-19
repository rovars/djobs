#!/system/bin/sh
# Boot wrapper — wait for boot complete, then start daemon
waited=0; while [ "$waited" -lt 12 ] && [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 10; waited=$((waited+1)); done
sleep 10
[ -f /data/adb/modules/dailyjobs/disable ] && exit 0
if [ -x /data/adb/dailyjobs/bin/djobs ]; then
  /data/adb/dailyjobs/bin/djobs start
else
  echo "[DailyJobs] Binary not found — skipping start"
fi
