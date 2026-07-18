#!/bin/sh
# DailyJobs v3.0 installer — supports KernelSU / Magisk / APatch

# Detect root environment
if [ "$KSU" = "true" ]; then
  ui_print "- [DailyJobs] KernelSU detected"
  BUSYBOX="/data/adb/ksu/bin/busybox"
  SERVICE_DIR="/data/adb/service.d"
elif [ "$APATCH" = "true" ]; then
  ui_print "- [DailyJobs] APatch detected"
  BUSYBOX="/data/adb/ap/bin/busybox"
  SERVICE_DIR="/data/adb/service.d"
elif [ "$MAGISK_VER_CODE" ] || [ "$MAGISK_VER" ]; then
  ui_print "- [DailyJobs] Magisk detected"
  BUSYBOX="/data/adb/magisk/busybox"
  SERVICE_DIR="/data/adb/service.d"
else
  # Fallback detection
  if [ -d "/data/adb/ksu" ]; then
    BUSYBOX="/data/adb/ksu/bin/busybox"
    SERVICE_DIR="/data/adb/service.d"
  elif [ -d "/data/adb/ap" ]; then
    BUSYBOX="/data/adb/ap/bin/busybox"
    SERVICE_DIR="/data/adb/service.d"
  elif [ -d "/data/adb/magisk" ]; then
    BUSYBOX="/data/adb/magisk/busybox"
    SERVICE_DIR="/data/adb/service.d"
  else
    BUSYBOX="/data/adb/magisk/busybox"
    SERVICE_DIR="/data/adb/service.d"
  fi
  ui_print "- [DailyJobs] Auto-detected root environment"
fi

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

# Install boot service
mkdir -p "$SERVICE_DIR"
cp "$MODPATH/service.sh" "$SERVICE_DIR/dailyjobs.sh"
chmod 755 "$SERVICE_DIR/dailyjobs.sh"
ui_print "- Installed boot service"

# Symlink for module manager
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: $SERVICE_DIR/dailyjobs.sh start"
