#!/bin/bash
# build.sh — Build Rust binaries for DailyJobs module
# Usage: ./build.sh [arm|arm64|x86_64|all]

set -e
cd "$(dirname "$0")"

CARGO="${CARGO:-cargo}"
API_LEVEL="${API_LEVEL:-29}"

# Map NDK ABI → Rust target triple
ABI_TO_RUST=(
    [arm64-v8a]=aarch64-linux-android
    [armeabi-v7a]=armv7-linux-androideabi
    [x86]=i686-linux-android
    [x86_64]=x86_64-linux-android
)

build_daemon() {
    local abi="$1"
    local outname="$2"
    local rust_target="${ABI_TO_RUST[$abi]}"
    echo "[build] djobsd for $abi → $rust_target..."
    cd djobsd
    $CARGO ndk -t "$abi" -p "$API_LEVEL" build --release
    cd ..
    cp "djobsd/target/$rust_target/release/djobsd" "$outname"
}

build_cli() {
    local abi="$1"
    local outname="$2"
    local rust_target="${ABI_TO_RUST[$abi]}"
    echo "[build] djobs for $abi → $rust_target..."
    cd djobs
    $CARGO ndk -t "$abi" -p "$API_LEVEL" build --release
    cd ..
    cp "djobs/target/$rust_target/release/djobs" "$outname"
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
    build_daemon "arm64-v8a" "scheduler_arm64"
    build_cli "arm64-v8a" "djobs_arm64"
}

build_arm() {
    echo "[build] ARM (armv7-linux-androideabi)..."
    build_daemon "armeabi-v7a" "scheduler_arm"
    build_cli "armeabi-v7a" "djobs_arm"
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
