#!/bin/sh
# DailyJobs service script — runs automatically at boot.
# Generates initial crontab; crond lifecycle managed by init via initrc/crond.rc.

export PATH="/data/adb/ksu/bin:$PATH"

# Wait for /data and modules to settle
sleep 30

/data/adb/modules/dailyjobs/update-cron.sh
