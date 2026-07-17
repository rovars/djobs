#!/bin/sh
# DailyJobs service script (run automatically by Magisk/KSU at boot).
# Restarts the scheduler so the crontab is (re)built after every boot.
PATH=/data/adb/ap/bin:/data/adb/ksu/bin:/data/adb/magisk:$PATH

# Wait for the module to be ready / network idle-ish, more Doze-resistant
sleep 30

/data/adb/modules/dailyjobs/update-cron.sh
