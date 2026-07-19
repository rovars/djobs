#!/bin/sh
# DailyJobs v4.0 installer — KernelSU / Magisk / APatch

# ---- Detect CPU architecture ----
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64)
    ARCH_SUFFIX="arm64"
    ui_print "- Architecture: ARM64 (aarch64)"
    ;;
  armv7l|armv8l|armv7*|arm*)
    ARCH_SUFFIX="arm"
    ui_print "- Architecture: ARM32 (armv7)"
    ;;
  x86_64|amd64)
    ARCH_SUFFIX="arm64"
    ui_print "- Architecture: x86_64 (fallback to ARM64)"
    ;;
  *)
    ui_print "- Unknown arch: $ARCH, trying ARM64"
    ARCH_SUFFIX="arm64"
    ;;
esac

# ---- Install ----
mkdir -p /data/adb/dailyjobs/bin

# Default config
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
  ui_print "- Created default config"
fi

# Deploy daemon binary
if [ -f "$MODPATH/bin/djobsd_$ARCH_SUFFIX" ]; then
  cp "$MODPATH/bin/djobsd_$ARCH_SUFFIX" /data/adb/dailyjobs/bin/djobsd
  chmod 755 /data/adb/dailyjobs/bin/djobsd
  ui_print "- Deployed djobsd ($ARCH_SUFFIX)"
else
  ui_print "! Daemon binary not found: bin/djobsd_$ARCH_SUFFIX"
  abort "Architecture not supported"
fi

# Deploy CLI binary
if [ -f "$MODPATH/bin/djobs_$ARCH_SUFFIX" ]; then
  cp "$MODPATH/bin/djobs_$ARCH_SUFFIX" /data/adb/dailyjobs/bin/djobs
  chmod 755 /data/adb/dailyjobs/bin/djobs
  ui_print "- Deployed djobs CLI ($ARCH_SUFFIX)"
fi

# Boot service — MODULE/service.sh runs automatically at late_start
ui_print "- Boot service: module/service.sh (auto)"

# Symlink for module manager
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: /data/adb/dailyjobs/bin/djobs start"
