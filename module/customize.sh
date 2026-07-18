#!/bin/sh
# DailyJobs v3.0 installer — KernelSU / Magisk / APatch

# ---- Detect root framework ----
if [ "$KSU" = "true" ]; then
  ui_print "- [DailyJobs] KernelSU detected"
  BUSYBOX="/data/adb/ksu/bin/busybox"
elif [ "$APATCH" = "true" ]; then
  ui_print "- [DailyJobs] APatch detected"
  BUSYBOX="/data/adb/ap/bin/busybox"
elif [ "$MAGISK_VER_CODE" ] || [ "$MAGISK_VER" ]; then
  ui_print "- [DailyJobs] Magisk detected"
  BUSYBOX="/data/adb/magisk/busybox"
else
  # Fallback auto-detect
  for d in ksu ap magisk; do
    [ -d "/data/adb/$d" ] && BUSYBOX="/data/adb/$d/bin/busybox" && break
  done
  : "${BUSYBOX:=/data/adb/magisk/busybox}"
  ui_print "- [DailyJobs] Auto-detected root"
fi

SERVICE_DIR="/data/adb/service.d"

# ---- Detect CPU architecture ----
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64)
    BINARY="scheduler_arm64"
    INSPECTOR="wakeup_inspector_arm64"
    ui_print "- Architecture: ARM64 (aarch64)"
    ;;
  armv7l|armv8l|armv7*|arm*)
    BINARY="scheduler_arm"
    INSPECTOR="wakeup_inspector_arm"
    ui_print "- Architecture: ARM32 (armv7)"
    ;;
  x86_64|amd64)
    BINARY="scheduler_arm64"
    INSPECTOR="wakeup_inspector_arm64"
    ui_print "- Architecture: x86_64 (fallback to ARM64)"
    ;;
  *)
    ui_print "- Unknown arch: $ARCH, trying ARM64"
    BINARY="scheduler_arm64"
    INSPECTOR="wakeup_inspector_arm64"
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

if [ -f "$MODPATH/bin/$INSPECTOR" ]; then
  cp "$MODPATH/bin/$INSPECTOR" /data/adb/dailyjobs/bin/wakeup_inspector
  chmod 755 /data/adb/dailyjobs/bin/wakeup_inspector
  ui_print "- Deployed $INSPECTOR"
fi

# Control script
cp "$MODPATH/djobs.sh" /data/adb/dailyjobs/djobs.sh
chmod 755 /data/adb/dailyjobs/djobs.sh
ui_print "- Installed control script"

# Boot service
cp "$MODPATH/service.sh" "$SERVICE_DIR/dailyjobs.sh"
chmod 755 "$SERVICE_DIR/dailyjobs.sh"
ui_print "- Installed boot service"

# Symlink for module manager
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: $SERVICE_DIR/dailyjobs.sh start"
