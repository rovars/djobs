#!/system/bin/sh
# KernelSU Action button — toggle scheduler on/off
if /data/adb/dailyjobs/djobs.sh status | grep -q Running; then
  /data/adb/dailyjobs/djobs.sh stop
else
  /data/adb/dailyjobs/djobs.sh start
fi
