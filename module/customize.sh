#!/system/bin/sh

CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p /data/adb/dailyjobs/crontabs "$CUSTOM_DIR"

# Default config (only if not present)
if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cp "$MODPATH/config.txt" /data/adb/dailyjobs/config.txt
fi

# Startup via service.d (lebih tahan Doze)
SERVICE_D=/data/adb/service.d
mkdir -p "$SERVICE_D"
cat > "$SERVICE_D/dailyjobs.sh" <<EOF
#!/system/bin/sh
if [ -f /data/adb/modules/dailyjobs/disable ]; then
  exit 0
fi
sleep 30
/data/adb/modules/dailyjobs/update-cron.sh
EOF
chmod 0755 "$SERVICE_D/dailyjobs.sh"

# Uninstaller (module/uninstall.sh is run automatically by Magisk/KSU on uninstall)

sh "$MODPATH/update-cron.sh"
