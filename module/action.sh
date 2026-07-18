#!/system/bin/sh
# KernelSU Action button — toggle scheduler on/off
if /data/adb/dailyjobs/djobs status | grep -q Running; then
  /data/adb/dailyjobs/djobs stop
else
  /data/adb/dailyjobs/djobs start
fi
