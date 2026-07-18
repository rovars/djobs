#!/bin/sh
# DailyJobs v3.0 installer

PATH=/data/adb/ksu/bin:$PATH

if [ ! "$KSU" = true ]; then
    abort "[!] KernelSU only!"
fi

ui_print "- [DailyJobs] Installing scheduler..."

# Create runtime directory
mkdir -p /data/adb/dailyjobs

# Copy default config if not exists
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
  ui_print "- Created default config"
fi

# Deploy C binary
cp "$MODPATH/scheduler" /data/adb/dailyjobs/scheduler
chmod 755 /data/adb/dailyjobs/scheduler
ui_print "- Deployed scheduler binary"

# Symlink for service.d compatibility
mkdir -p /data/adb/service.d
cp "$MODPATH/djobs.sh" /data/adb/service.d/dailyjobs.sh
chmod 755 /data/adb/service.d/dailyjobs.sh

rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: /data/adb/service.d/dailyjobs.sh start"
