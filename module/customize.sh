#!/bin/sh
# DailyJobs v4.0 installer — KernelSU / Magisk / APatch

PERSISTENT_DIR=/data/adb/dailyjobs

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

# ---- Setup PERSISTENT_DIR ----
mkdir -p "$PERSISTENT_DIR/bin"

# Default config (copy only if not exists — preserve existing)
if [ ! -f "$PERSISTENT_DIR/config.txt" ]; then
  cp "$MODPATH/config.txt" "$PERSISTENT_DIR/config.txt"
  ui_print "- Created default config"
fi

# Deploy daemon binary (mv — no stale copy in module dir)
if [ -f "$MODPATH/djobs_bin/djobsd_$ARCH_SUFFIX" ]; then
  mv "$MODPATH/djobs_bin/djobsd_$ARCH_SUFFIX" "$PERSISTENT_DIR/bin/djobsd"
  chmod 755 "$PERSISTENT_DIR/bin/djobsd"
  ui_print "- Deployed djobsd ($ARCH_SUFFIX)"
else
  ui_print "! Daemon binary not found: djobs_bin/djobsd_$ARCH_SUFFIX"
  abort "Architecture not supported"
fi

# Deploy CLI shell script
cp "$MODPATH/djobs.service" "$PERSISTENT_DIR/djobs.service"
chmod 755 "$PERSISTENT_DIR/djobs.service"
ui_print "- Deployed djobs CLI (service script)"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: $PERSISTENT_DIR/djobs.service start"
