#!/system/bin/sh
# Remove DailyJobs runtime data
rm -f /data/adb/service.d/dailyjobs.sh
rm -f /data/adb/dailyjobs/scheduler
rm -f /data/adb/dailyjobs/scheduler.pid
# Uncomment to also remove config + logs:
# rm -rf /data/adb/dailyjobs
