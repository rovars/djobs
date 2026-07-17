#!/bin/sh
# DailyJobs installer — lay down default config and generate initial crontab.

PATH=/data/adb/ksu/bin:$PATH

if [ ! "$KSU" = true ]; then
    abort "[!] KernelSU only!"
fi
CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p /data/adb/dailyjobs/crontabs "$CUSTOM_DIR"

# Default config (only if none exists)
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
fi

# Ensure scripts are executable
chmod +x "$MODPATH/run-crond.sh" "$MODPATH/update-cron.sh"
chmod +x "$MODPATH/jobs/"*.sh

# Symlink runtime data into module dir for WebUI fetch
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

# Build initial crontab
sh "$MODPATH/update-cron.sh"
