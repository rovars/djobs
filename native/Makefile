CC = /home/runner/rox/cron-prototype/zig-x86_64-linux-0.14.1/zig cc
STRIP = /home/runner/rox/cron-prototype/ELFkickers-3.2/sstrip/sstrip
CFLAGS = -O2 -std=c11 -Wall -Wextra
TARGET_ARM64 = aarch64-linux-musl

all: scheduler scheduler_arm64 wakeup_inspector wakeup_inspector_arm64

scheduler: scheduler.c
	$(CC) $(CFLAGS) scheduler.c -o scheduler

scheduler_arm64: scheduler.c
	$(CC) $(CFLAGS) -target $(TARGET_ARM64) -static scheduler.c -o scheduler_arm64
	-$(STRIP) scheduler_arm64 2>/dev/null

wakeup_inspector: wakeup_inspector.c
	$(CC) $(CFLAGS) wakeup_inspector.c -o wakeup_inspector

wakeup_inspector_arm64: wakeup_inspector.c
	$(CC) $(CFLAGS) -target $(TARGET_ARM64) -static wakeup_inspector.c -o wakeup_inspector_arm64
	-$(STRIP) wakeup_inspector_arm64 2>/dev/null

clean:
	rm -f scheduler scheduler_arm64 wakeup_inspector wakeup_inspector_arm64

.PHONY: all clean
