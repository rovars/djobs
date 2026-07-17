#!/system/bin/sh

mkdir -p /data/adb/dailyjobs/crontabs

if [ ! -f /data/adb/dailyjobs/config.txt ]; then
  cat > /data/adb/dailyjobs/config.txt <<EOF
# Format: HH:MM ACTION [ARGS]
# Actions: data on|off, airplane on|off, custom <cmd>
#
# 22:30 data off
# 07:00 data on
# 23:00 airplane on
# 06:00 airplane off
# 12:00 custom echo test > /sdcard/log.txt
EOF
fi

set_perm_recursive "$MODPATH/jobs" 0 0 0755 0755
set_perm "$MODPATH/service.sh" 0 0 0755
set_perm "$MODPATH/update-cron.sh" 0 0 0755
set_perm "$MODPATH/busybox.sh" 0 0 0644
sh "$MODPATH/update-cron.sh"
