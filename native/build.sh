#!/bin/bash
# build.sh — Build Rust binaries for DailyJobs module
# Usage: ./build.sh [arm|arm64|x86_64|all]

set -e
cd "$(dirname "$0")"

CARGO="${CARGO:-cargo}"
OUTDIR="$(realpath "$(dirname "$0")/../module/djobs_bin")"
mkdir -p "$OUTDIR"

build_android() {
    local crate="$1"
    local target="$2"
    local outname="$3"
    echo "[build] $crate for $target..."
    (cd "$crate" && $CARGO build --target "$target" --release) || return 1
    cp "$crate/target/$target/release/$crate" "$OUTDIR/$outname"
}

build_native() {
    echo "[build] x86_64 (native)..."
    (cd djobsd && $CARGO build --release) || return 1
    cp djobsd/target/release/djobsd "$OUTDIR/djobsd_x86_64"
}

build_arm64() {
    echo "[build] ARM64 (aarch64-linux-android)..."
    build_android djobsd aarch64-linux-android djobsd_arm64
}

build_arm() {
    echo "[build] ARM (armv7-linux-androideabi)..."
    build_android djobsd armv7-linux-androideabi djobsd_arm
}

case "${1:-arm64}" in
    arm)     build_arm ;;
    arm64)   build_arm64 ;;
    x86_64)  build_native ;;
    all)     build_native; build_arm; build_arm64 ;;
    *)       echo "Usage: $0 [arm|arm64|x86_64|all]"; exit 1 ;;
esac

echo "[build] Done"
ls -lh "$OUTDIR"
