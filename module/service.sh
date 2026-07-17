#!/bin/sh
# DailyJobs service script — runs automatically at boot.
# Waits for boot completed signal, then starts the scheduler daemon.

export PATH="/data/adb/ksu/bin:$PATH"

# Wait until the device has fully booted
while [ "$(getprop sys.boot_completed)" != "1" ]; do
  sleep 5
done

# Let the system settle a bit more
sleep 10

nohup /data/adb/modules/dailyjobs/djobs.sh >/dev/null 2>&1 &
