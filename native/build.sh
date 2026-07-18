#!/bin/bash
# build.sh — Build C binaries for DailyJobs module
# Usage: ./build.sh [arm|arm64|x86_64|all]

set -e
cd "$(dirname "$0")"

ZIG="${ZIG:-zig}"
STRIP="${STRIP:-sstrip}"
CFLAGS="-O2 -std=gnu11 -Wall -Wextra"

if [ -f "$PWD/zig" ]; then ZIG="$PWD/zig"; fi
if [ -f "$PWD/sstrip" ]; then STRIP="$PWD/sstrip"; fi

echo "[build] Using: $($ZIG version)"

build_native() {
    echo "[build] x86_64..."
    $ZIG cc $CFLAGS scheduler.c -o scheduler
}

build_arm64() {
    echo "[build] ARM64 (aarch64-linux-musl)..."
    $ZIG cc $CFLAGS -target aarch64-linux-musl -static scheduler.c -o scheduler_arm64
    if command -v "$STRIP" &>/dev/null; then
        $STRIP scheduler_arm64 2>/dev/null || true
    fi
}

build_arm() {
    echo "[build] ARM (arm-linux-musleabihf)..."
    $ZIG cc $CFLAGS -target arm-linux-musleabihf -static scheduler.c -o scheduler_arm
    if command -v "$STRIP" &>/dev/null; then
        $STRIP scheduler_arm 2>/dev/null || true
    fi
}

case "${1:-arm64}" in
    arm)     build_arm ;;
    arm64)   build_arm64 ;;
    x86_64)  build_native ;;
    all)     build_native; build_arm; build_arm64 ;;
    *)       echo "Usage: $0 [arm|arm64|x86_64|all]"; exit 1 ;;
esac

echo "[build] Done"
ls -lh scheduler* 2>/dev/null
