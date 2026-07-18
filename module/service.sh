#!/system/bin/sh
# Boot wrapper — waits for boot then delegates to control script
waited=0; while [ "$waited" -lt 12 ] && [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 10; waited=$((waited+1)); done
sleep 30
[ -f /data/adb/modules/dailyjobs/disable ] && exit 0
exec /data/adb/dailyjobs/djobs.sh start
