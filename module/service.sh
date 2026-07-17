#!/bin/sh
# DailyJobs service script — runs automatically at boot.
# Starts the scheduler daemon in background.

export PATH="/data/adb/ksu/bin:$PATH"

sleep 30

nohup /data/adb/modules/dailyjobs/djobs.sh >/dev/null 2>&1 &
