#!/bin/sh
# DailyJobs v3.0 installer — KernelSU / Magisk / APatch

SERVICE_DIR="/data/adb/service.d"

# ---- Detect CPU architecture ----
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64)
    BINARY="scheduler_arm64"
    ui_print "- Architecture: ARM64 (aarch64)"
    ;;
  armv7l|armv8l|armv7*|arm*)
    BINARY="scheduler_arm"
    ui_print "- Architecture: ARM32 (armv7)"
    ;;
  x86_64|amd64)
    BINARY="scheduler_arm64"
    ui_print "- Architecture: x86_64 (fallback to ARM64)"
    ;;
  *)
    ui_print "- Unknown arch: $ARCH, trying ARM64"
    BINARY="scheduler_arm64"
    ;;
esac

# ---- Install ----
mkdir -p /data/adb/dailyjobs/bin "$SERVICE_DIR"

# Default config
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
  ui_print "- Created default config"
fi

# Deploy correct architecture binaries
if [ -f "$MODPATH/bin/$BINARY" ]; then
  cp "$MODPATH/bin/$BINARY" /data/adb/dailyjobs/bin/scheduler
  chmod 755 /data/adb/dailyjobs/bin/scheduler
  # Symlink to root for backward compat
  ln -sf bin/scheduler /data/adb/dailyjobs/scheduler
  ui_print "- Deployed $BINARY"
else
  ui_print "! Scheduler binary not found: bin/$BINARY"
  abort "Architecture not supported"
fi

# Control script
cp "$MODPATH/djobs.sh" /data/adb/dailyjobs/djobs.sh
chmod 755 /data/adb/dailyjobs/djobs.sh
ui_print "- Installed control script"

# Boot service — MODULE/service.sh runs automatically at late_start
# No need to copy to service.d (that would duplicate execution)
ui_print "- Boot service: module/service.sh (auto)"

# Symlink for module manager
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: $SERVICE_DIR/dailyjobs.sh start"
