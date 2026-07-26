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
  nagram) NDK_VERSION=27.2.12479018 ;;
  telegram) NDK_VERSION=21.4.7075529 ;;
  nnngram) NDK_VERSION=28.2.13676358 ;;
  nullgram) NDK_VERSION=29.0.14206865 ;;
  *) echo "Unknown client: $CLIENT" >&2; exit 2 ;;
esac
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"

# Nnngram and Nullgram publish FFmpeg/libvpx archives for ARM only. Build the
# missing x86 archives from the exact FFmpeg/libvpx revisions used by these
# clients before Gradle configures their native target.
if [[ "$CLIENT" == "nnngram" || "$CLIENT" == "nullgram" ]]; then
  X86_NATIVE_TARGETS=()
  X86_ABIS=()
  for target in "${NATIVE_TARGETS[@]}"; do
    case "$target" in
      x86) X86_NATIVE_TARGETS+=(x86); X86_ABIS+=(x86) ;;
      x86_64) X86_NATIVE_TARGETS+=(x86_64); X86_ABIS+=(x86_64) ;;
    esac
  done

  if (( ${#X86_NATIVE_TARGETS[@]} > 0 )); then
    JNI_ROOT="$SOURCE_ROOT/TMessagesProj/jni"
    LIBVPX_ROOT="$JNI_ROOT/libvpx"
    FFMPEG_SOURCE_ROOT="$JNI_ROOT/ffmpeg-source"
    if [[ ! -d "$LIBVPX_ROOT/.git" ]]; then
      git init "$LIBVPX_ROOT"
      git -C "$LIBVPX_ROOT" remote add origin https://github.com/webmproject/libvpx.git
    fi
    git -C "$LIBVPX_ROOT" fetch --depth=1 origin f51417671e062b9551d71c6d00635eb47f8c0254
    git -C "$LIBVPX_ROOT" checkout --detach --force FETCH_HEAD
    git -C "$LIBVPX_ROOT" clean -fdx

    if [[ ! -d "$FFMPEG_SOURCE_ROOT/.git" ]]; then
      git init "$FFMPEG_SOURCE_ROOT"
      git -C "$FFMPEG_SOURCE_ROOT" remote add origin https://github.com/FFmpeg/FFmpeg.git
    fi
    git -C "$FFMPEG_SOURCE_ROOT" fetch --depth=1 origin c3ad886251fdba1eaf9e461a6dd013df19ba54a8
    git -C "$FFMPEG_SOURCE_ROOT" checkout --detach --force FETCH_HEAD
    git -C "$FFMPEG_SOURCE_ROOT" clean -fdx

    mkdir -p "$JNI_ROOT/patches"
    install -m 644 "$PATCHER_ROOT/scripts/native/libvpx-x86-fix.patch" \
      "$JNI_ROOT/patches/libvpx_x86_fix.patch"
    cd "$JNI_ROOT"
    NDK="$ANDROID_NDK_HOME" bash "$PATCHER_ROOT/scripts/native/build-libvpx-clang.sh" \
      "${X86_NATIVE_TARGETS[@]}"
    NDK="$ANDROID_NDK_HOME" CROSSGRAM_FFMPEG_SOURCE=ffmpeg-source \
      bash "$PATCHER_ROOT/scripts/native/build-ffmpeg-clang.sh" "${X86_NATIVE_TARGETS[@]}"

    for abi in "${X86_ABIS[@]}"; do
      install -d "$JNI_ROOT/ffmpeg/$abi"
      for library in libavcodec.a libavformat.a libavutil.a libswresample.a libswscale.a; do
        install -m 644 "$JNI_ROOT/ffmpeg-source/build/$abi/lib/$library" \
          "$JNI_ROOT/ffmpeg/$abi/$library"
      done
      install -m 644 "$JNI_ROOT/libvpx/build/$abi/lib/libvpx.a" \
        "$JNI_ROOT/ffmpeg/$abi/libvpx.a"
    done
  fi
fi

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
