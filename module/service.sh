#!/bin/sh
# DailyJobs service script — runs automatically at boot.
#
# KernelSU (initrc):
#   init starts dailyjobs-crond via initrc/crond.rc after boot_completed.
#   This script simply generates the initial crontab; crond is managed by init.
#
# Magisk / APatch (legacy):
#   No initrc available — this script generates the crontab and starts crond
#   directly via the fallback in update-cron.sh.
#
PATH=/data/adb/ap/bin:/data/adb/ksu/bin:/data/adb/magisk:$PATH

# Wait for /data and modules to settle
sleep 30

/data/adb/modules/dailyjobs/update-cron.sh
