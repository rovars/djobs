#!/system/bin/sh
# DailyJobs installer: lay down default config, a Doze-resistant service.d
# starter, then generate the crontab.

CUSTOM_DIR=/data/adb/dailyjobs/custom
SERVICE_D=/data/adb/service.d
SERVICE_SCRIPT=$SERVICE_D/dailyjobs.sh

mkdir -p /data/adb/dailyjobs/crontabs "$CUSTOM_DIR"

# Default config (only if one does not already exist)
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
fi

# Startup via service.d (more resistant to Doze than a post-fs-data one-shot)
mkdir -p "$SERVICE_D"
cat > "$SERVICE_SCRIPT" <<EOF
#!/system/bin/sh
if [ -f /data/adb/modules/dailyjobs/disable ]; then
  exit 0
fi
sleep 30
/data/adb/modules/dailyjobs/update-cron.sh
EOF
chmod 0755 "$SERVICE_SCRIPT"

# module/uninstall.sh is executed automatically by Magisk/KSU on uninstall

# Build the initial crontab
sh "$MODPATH/update-cron.sh"
