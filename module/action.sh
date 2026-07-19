#!/system/bin/sh
# KernelSU Action button — toggle scheduler on/off
run_as_su() { su -c "$1"; }
if run_as_su "/data/adb/dailyjobs/djobs.service status" | grep -q "^\[DailyJobs\] Running"; then
  run_as_su "/data/adb/dailyjobs/djobs.service stop"
else
  run_as_su "/data/adb/dailyjobs/djobs.service start"
fi
