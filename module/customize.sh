#!/system/bin/sh
# DailyJobs installer: lay down default config, then generate the crontab.
# Boot-time startup is handled by module/service.sh (run automatically by
# Magisk/KSU), so nothing needs to be injected into /data/adb/service.d.

CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p /data/adb/dailyjobs/crontabs "$CUSTOM_DIR"

# Default config (only if one does not already exist)
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
fi

# Expose runtime data inside the module folder for direct editing / WebUI fetch.
# module/dailyjobs -> /data/adb/dailyjobs  (config.txt, custom/, crontabs/, ...)
rm -rf "$MODPATH/dailyjobs"
ln -s /data/adb/dailyjobs "$MODPATH/dailyjobs"

# module/uninstall.sh is executed automatically by Magisk/KSU on uninstall

# Build the initial crontab
sh "$MODPATH/update-cron.sh"
