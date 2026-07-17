#!/system/bin/sh
# Remove the legacy service.d starter (from older installs) and all runtime data.
rm -f /data/adb/service.d/dailyjobs.sh
rm -rf /data/adb/dailyjobs
