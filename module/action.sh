#!/system/bin/sh
# KernelSU Action button — toggle scheduler on/off
if /data/adb/dailyjobs/djobs.service status | grep -q "^\[DailyJobs\] Running"; then
  /data/adb/dailyjobs/djobs.service stop
else
  /data/adb/dailyjobs/djobs.service start
fi
