#!/usr/bin/env bash
set -euo pipefail

CLIENT=${1:?client is required}
REPOSITORY=${2:?repository is required}
REF=${3:?ref is required}
VERSION=${4:?version is required}
VARIANT=${5:?variant is required}
GRADLE_TASK=${6:?gradle task is required}

PATCHER_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SOURCE_ROOT="$PATCHER_ROOT/upstream/$CLIENT"
OUTPUT_ROOT="$PATCHER_ROOT/artifacts/$CLIENT/$VARIANT"

mkdir -p "$PATCHER_ROOT/upstream" "$OUTPUT_ROOT"
git clone --depth 1 --branch "$REF" "https://github.com/$REPOSITORY.git" "$SOURCE_ROOT"
# Nnngram/Nullgram intentionally keep an optional private Rust submodule that
# their own public CI skips. It is not enabled by their Android Gradle files.
git -C "$SOURCE_ROOT" -c submodule."libs/rust".update=none submodule update --init --recursive

cd "$PATCHER_ROOT"
corepack yarn run patch:source --client "$CLIENT" --source "$SOURCE_ROOT"
corepack yarn run prepare-build --client "$CLIENT" --source "$SOURCE_ROOT" --variant "$VARIANT"

case "$VARIANT" in
  armAll) ABIS=(armeabi-v7a arm64-v8a) ;;
  arm64) ABIS=(arm64-v8a) ;;
  x86_64) ABIS=(x86_64) ;;
  universal) ABIS=(armeabi-v7a arm64-v8a x86 x86_64) ;;
  *) echo "Unknown variant: $VARIANT" >&2; exit 2 ;;
esac

NATIVE_TARGETS=()
for abi in "${ABIS[@]}"; do
  case "$abi" in
    armeabi-v7a) NATIVE_TARGETS+=(arm) ;;
    arm64-v8a) NATIVE_TARGETS+=(arm64) ;;
    x86) NATIVE_TARGETS+=(x86) ;;
    x86_64) NATIVE_TARGETS+=(x86_64) ;;
  esac
done
export CROSSGRAM_NATIVE_TARGETS="${NATIVE_TARGETS[*]}"

case "$CLIENT" in
  nagram|telegram) NDK_VERSION=27.2.12479018 ;;
  nnngram) NDK_VERSION=28.2.13676358 ;;
  nullgram) NDK_VERSION=29.0.14206865 ;;
  *) echo "Unknown client: $CLIENT" >&2; exit 2 ;;
esac
(yes || true) | sdkmanager --install "ndk;$NDK_VERSION" "cmake;3.22.1"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"

SIGNING_DIR="$SOURCE_ROOT/.crossgram-signing"
mkdir -p "$SIGNING_DIR"
KEYSTORE="$SIGNING_DIR/release.keystore"
printf '%s' "${CROSSGRAM_KEYSTORE_BASE64:?missing keystore secret}" | base64 --decode > "$KEYSTORE"
chmod 600 "$KEYSTORE"

mkdir -p "$SOURCE_ROOT/TMessagesProj/config"
install -m 600 "$KEYSTORE" "$SOURCE_ROOT/TMessagesProj/config/release.keystore"
install -m 600 "$KEYSTORE" "$SOURCE_ROOT/TMessagesProj/release.keystore"

cat > "$SOURCE_ROOT/local.properties" <<EOF
sdk.dir=$ANDROID_HOME
KEYSTORE_PASS=$CROSSGRAM_KEYSTORE_PASSWORD
ALIAS_NAME=$CROSSGRAM_KEY_ALIAS
ALIAS_PASS=$CROSSGRAM_KEY_PASSWORD
RELEASE_STORE_PASSWORD=$CROSSGRAM_KEYSTORE_PASSWORD
RELEASE_KEY_ALIAS=$CROSSGRAM_KEY_ALIAS
RELEASE_KEY_PASSWORD=$CROSSGRAM_KEY_PASSWORD
EOF

export KEYSTORE_PASS="$CROSSGRAM_KEYSTORE_PASSWORD"
export ALIAS_NAME="$CROSSGRAM_KEY_ALIAS"
export ALIAS_PASS="$CROSSGRAM_KEY_PASSWORD"
export ORG_GRADLE_PROJECT_RELEASE_STORE_PASSWORD="$CROSSGRAM_KEYSTORE_PASSWORD"
export ORG_GRADLE_PROJECT_RELEASE_KEY_ALIAS="$CROSSGRAM_KEY_ALIAS"
export ORG_GRADLE_PROJECT_RELEASE_KEY_PASSWORD="$CROSSGRAM_KEY_PASSWORD"
export COMPILE_NATIVE=1

if [[ "$CLIENT" == "nagram" ]]; then
  sudo apt-get update
  sudo apt-get install -y bison gcc make curl ninja-build yasm patch
  cd "$SOURCE_ROOT"
  ./run init libs libvpx
  ./run init libs ffmpeg
  ./run init libs boringssl
fi

for brand in qq wechat wecom dingtalk discord; do
  cd "$PATCHER_ROOT"
  corepack yarn run brand --client "$CLIENT" --source "$SOURCE_ROOT" --brand "$brand"
  cd "$SOURCE_ROOT"
  # Keep incremental compilation caches, but remove packaged APKs so this
  # iteration can only publish files produced for the current brand.
  while IFS= read -r -d '' apk_output; do
    find "$apk_output" -mindepth 1 -delete
  done < <(find "$SOURCE_ROOT" -type d -path '*/build/outputs/apk' -print0)
  ./gradlew "$GRADLE_TASK" --build-cache --no-configuration-cache --max-workers=2

  found=0
  while IFS= read -r -d '' apk; do
    found=1
    destination="$OUTPUT_ROOT/${CLIENT}-${VERSION}-${VARIANT}-${brand}-$(basename "$apk")"
    cp "$apk" "$destination"
  done < <(find . -type f -path '*/build/outputs/apk/*' -name '*.apk' -print0)
  if [[ "$found" == 0 ]]; then
    echo "No APK produced for $CLIENT/$VARIANT/$brand" >&2
    exit 1
  fi
done

sha256sum "$OUTPUT_ROOT"/*.apk > "$OUTPUT_ROOT/SHA256SUMS.txt"
