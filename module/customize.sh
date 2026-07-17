#!/bin/sh
# DailyJobs installer

PATH=/data/adb/ksu/bin:$PATH

if [ ! "$KSU" = true ]; then
    abort "[!] KernelSU only!"
fi

mkdir -p /data/adb/dailyjobs

if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
fi

chmod +x "$MODPATH/djobs.sh"

rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"
