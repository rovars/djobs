CC = zig
CFLAGS = -O2 -std=gnu11 -Wall -Wextra
TARGET_ARM64 = aarch64-linux-musl
TARGET_ARM = arm-linux-musleabihf
STRIP = sstrip

all: arm arm64

arm: scheduler_arm wakeup_inspector_arm

arm64: scheduler_arm64 wakeup_inspector_arm64

scheduler_arm: scheduler.c
	$(CC) $(CFLAGS) -target $(TARGET_ARM) -static scheduler.c -o scheduler_arm
	-$(STRIP) scheduler_arm 2>/dev/null

scheduler_arm64: scheduler.c
	$(CC) $(CFLAGS) -target $(TARGET_ARM64) -static scheduler.c -o scheduler_arm64
	-$(STRIP) scheduler_arm64 2>/dev/null

wakeup_inspector_arm: wakeup_inspector.c
	$(CC) $(CFLAGS) -target $(TARGET_ARM) -static wakeup_inspector.c -o wakeup_inspector_arm
	-$(STRIP) wakeup_inspector_arm 2>/dev/null

wakeup_inspector_arm64: wakeup_inspector.c
	$(CC) $(CFLAGS) -target $(TARGET_ARM64) -static wakeup_inspector.c -o wakeup_inspector_arm64
	-$(STRIP) wakeup_inspector_arm64 2>/dev/null

clean:
	rm -f scheduler_arm scheduler_arm64 wakeup_inspector_arm wakeup_inspector_arm64

.PHONY: all arm arm64 clean
