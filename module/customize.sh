#!/bin/sh
# DailyJobs installer — lay down default config and set up runtime.

PATH=/data/adb/ksu/bin:$PATH

if [ ! "$KSU" = true ]; then
    abort "[!] KernelSU only!"
fi

CUSTOM_DIR=/data/adb/dailyjobs/custom
mkdir -p "$CUSTOM_DIR"

# Default config (only if none exists)
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
fi

# Ensure scripts are executable
chmod +x "$MODPATH/daemon.sh"
chmod +x "$MODPATH/jobs/"*.sh

# Symlink runtime data into module dir for WebUI fetch
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"
