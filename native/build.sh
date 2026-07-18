#!/bin/bash
# build.sh — Build Rust binaries for DailyJobs module
# Usage: ./build.sh [arm|arm64|x86_64|all]

set -e
cd "$(dirname "$0")"

CARGO="${CARGO:-cargo}"
API_LEVEL="${API_LEVEL:-29}"

build_daemon() {
    local target="$1"
    local outname="$2"
    echo "[build] djobsd for $target..."
    cd djobsd
    $CARGO ndk -t "$target" -p "$API_LEVEL" build --release
    cd ..
    cp "djobsd/target/$target/release/djobsd" "$outname"
}

build_cli() {
    local target="$1"
    local outname="$2"
    echo "[build] djobs for $target..."
    cd djobs
    $CARGO ndk -t "$target" -p "$API_LEVEL" build --release
    cd ..
    cp "djobs/target/$target/release/djobs" "$outname"
}

build_native() {
    echo "[build] x86_64 (native)..."
    cd djobsd && $CARGO build --release && cd ..
    cp djobsd/target/release/djobsd scheduler
    cd djobs && $CARGO build --release && cd ..
    cp djobs/target/release/djobs djobs_cli
}

build_arm64() {
    echo "[build] ARM64 (aarch64-linux-android)..."
    build_daemon "arm64" "scheduler_arm64"
    build_cli "arm64" "djobs_arm64"
}

build_arm() {
    echo "[build] ARM (armv7-linux-androideabi)..."
    build_daemon "arm" "scheduler_arm"
    build_cli "arm" "djobs_arm"
}

case "${1:-arm64}" in
    arm)     build_arm ;;
    arm64)   build_arm64 ;;
    x86_64)  build_native ;;
    all)     build_native; build_arm; build_arm64 ;;
    *)       echo "Usage: $0 [arm|arm64|x86_64|all]"; exit 1 ;;
esac

echo "[build] Done"
ls -lh scheduler* djobs_cli 2>/dev/null || true
