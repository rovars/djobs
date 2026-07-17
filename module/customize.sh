#!/system/bin/sh

CUSTOM_DIR=/data/adb/dailyjobs/custom

mkdir -p /data/adb/dailyjobs/crontabs "$CUSTOM_DIR"

if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cat > /data/adb/dailyjobs/config.txt <<EOF
# Format: HH:MM SCRIPT_NAME
#   SCRIPT_NAME = nama file .sh di jobs/ (tanpa .sh)
#
# Built-in:
#   22:30 data off       # matikan data jam 22:30
#   07:00 data on        # hidupkan data jam 07:00
#   23:00 airplane on    # mode pesawat jam 23:00
#   06:00 airplane off   # matikan mode pesawat jam 06:00
#
# Custom (buat dulu via WebUI > Custom Jobs):
#   12:00 my-logger      # jalankan /data/adb/dailyjobs/custom/my-logger.sh
EOF
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

# Uninstaller
cat > "$MODPATH/uninstall.sh" <<EOF
#!/system/bin/sh
rm -f /data/adb/service.d/dailyjobs.sh
rm -rf /data/adb/dailyjobs
EOF
chmod 0755 "$MODPATH/uninstall.sh"

sh "$MODPATH/update-cron.sh"
