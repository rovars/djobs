#!/system/bin/sh
# KernelSU Action button — toggle scheduler on/off
if /data/adb/dailyjobs/bin/djobs status | grep -q "^\[DailyJobs\] Running"; then
  /data/adb/dailyjobs/bin/djobs stop
else
  /data/adb/dailyjobs/bin/djobs start
fi
