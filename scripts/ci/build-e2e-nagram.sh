#!/usr/bin/env bash
set -euo pipefail

REF=${1:-main}
PATCHER_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SOURCE_ROOT="$PATCHER_ROOT/upstream/nagram-e2e"
OUTPUT_ROOT="$PATCHER_ROOT/artifacts/e2e-nagram-x86_64"

mkdir -p "$PATCHER_ROOT/upstream" "$OUTPUT_ROOT"
git clone --depth 1 --branch "$REF" https://github.com/NextAlone/Nagram.git "$SOURCE_ROOT"
git -C "$SOURCE_ROOT" submodule update --init --recursive

cd "$PATCHER_ROOT"
corepack yarn run patch:source --client nagram --source "$SOURCE_ROOT"
corepack yarn run e2e:source --client nagram --source "$SOURCE_ROOT"
corepack yarn run brand --client nagram --source "$SOURCE_ROOT" --brand qq
corepack yarn run prepare-build --client nagram --source "$SOURCE_ROOT" --variant x86_64

export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export CROSSGRAM_NATIVE_TARGETS=x86_64
export COMPILE_NATIVE=1

cd "$SOURCE_ROOT"
./run init libs libvpx
./run init libs ffmpeg
./run init libs boringssl
./gradlew :TMessagesProj:assembleDebug --build-cache --no-configuration-cache --max-workers=2

find "$SOURCE_ROOT" -type f -path '*/build/outputs/apk/debug/*.apk' -print0 \
  | while IFS= read -r -d '' apk; do cp "$apk" "$OUTPUT_ROOT/"; done
if ! compgen -G "$OUTPUT_ROOT/*.apk" >/dev/null; then
  echo "No Nagram debug APK produced" >&2
  exit 1
fi
(cd "$OUTPUT_ROOT" && sha256sum ./*.apk > SHA256SUMS.txt)
