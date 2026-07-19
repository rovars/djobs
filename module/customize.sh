#!/bin/sh
# DailyJobs v4.0 installer — KernelSU / Magisk / APatch
SKIPUNZIP=1

PERSISTENT_DIR=/data/adb/dailyjobs

# ---- Detect CPU architecture first (use built-in $ARCH from installer) ----
case "$ARCH" in
  arm64) ARCH_SUFFIX="arm64" ;;
  arm)   ARCH_SUFFIX="arm" ;;
  *)     abort "Unsupported architecture: $ARCH" ;;
esac
ui_print "- Architecture: $ARCH"

# ---- Setup directories ----
mkdir -p "$PERSISTENT_DIR/bin"

# ---- Extract module lifecycle files to MODPATH (exclude persistent-only) ----
unzip -o "$ZIPFILE" -x 'djobs_bin/*' -x 'djobs.service' -x 'config.txt' -d "$MODPATH" >&2

# ---- Extract persistent runtime files directly to PERSISTENT_DIR ----
unzip -j -o "$ZIPFILE" "djobs_bin/djobsd_$ARCH_SUFFIX" -d "$PERSISTENT_DIR/bin" >&2
unzip -j -o "$ZIPFILE" 'djobs.service' -d "$PERSISTENT_DIR" >&2
if [ ! -f "$PERSISTENT_DIR/config.txt" ]; then
  unzip -j -o "$ZIPFILE" 'config.txt' -d "$PERSISTENT_DIR" >&2
  ui_print "- Created default config"
fi

# ---- Deploy ----
if [ -f "$PERSISTENT_DIR/bin/djobsd_$ARCH_SUFFIX" ]; then
  mv "$PERSISTENT_DIR/bin/djobsd_$ARCH_SUFFIX" "$PERSISTENT_DIR/bin/djobsd"
  set_perm "$PERSISTENT_DIR/bin/djobsd" 0 0 0755
  ui_print "- Deployed djobsd ($ARCH_SUFFIX)"
  ui_print ""
else
  abort "Binary not found for architecture: $ARCH (djobsd_$ARCH_SUFFIX)"
fi

set_perm "$PERSISTENT_DIR/djobs.service" 0 0 0755
ui_print "- Deployed djobs CLI (service script)"

ui_print "- [DailyJobs] Installation complete!"
ui_print "- Reboot or run: $PERSISTENT_DIR/djobs.service start"
