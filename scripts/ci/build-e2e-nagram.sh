#!/usr/bin/env bash
set -euo pipefail

REF=${1:-main}
PATCHER_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SOURCE_ROOT="$PATCHER_ROOT/upstream/nagram-e2e"
OUTPUT_ROOT="$PATCHER_ROOT/artifacts/e2e-nagram-x86_64"
SIGNING_ROOT=$(mktemp -d)

cleanup() {
  rm -f "$SOURCE_ROOT/TMessagesProj/release.keystore"
  rm -rf "$SIGNING_ROOT"
  unset KEYSTORE_PASS ALIAS_NAME ALIAS_PASS
}
trap cleanup EXIT

mkdir -p "$PATCHER_ROOT/upstream" "$OUTPUT_ROOT"
git clone --depth 1 --branch "$REF" https://github.com/NextAlone/Nagram.git "$SOURCE_ROOT"
git -C "$SOURCE_ROOT" submodule update --init --recursive

cd "$PATCHER_ROOT"
corepack yarn run patch:source --client nagram --source "$SOURCE_ROOT"
corepack yarn run e2e:source --client nagram --source "$SOURCE_ROOT"
corepack yarn run brand --client nagram --source "$SOURCE_ROOT" --brand qq
corepack yarn run prepare-build --client nagram --source "$SOURCE_ROOT" --variant x86_64

SIGNING_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
SIGNING_ALIAS=crossgram-e2e
keytool -genkeypair \
  -keystore "$SIGNING_ROOT/release.keystore" \
  -storepass "$SIGNING_PASSWORD" \
  -alias "$SIGNING_ALIAS" \
  -keypass "$SIGNING_PASSWORD" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 1 \
  -dname "CN=Crossgram E2E, OU=Testing, O=Crossgram" \
  >/dev/null 2>&1
install -m 600 "$SIGNING_ROOT/release.keystore" "$SOURCE_ROOT/TMessagesProj/release.keystore"
export KEYSTORE_PASS="$SIGNING_PASSWORD"
export ALIAS_NAME="$SIGNING_ALIAS"
export ALIAS_PASS="$SIGNING_PASSWORD"

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
