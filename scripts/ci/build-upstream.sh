#!/usr/bin/env bash
set -euo pipefail

CLIENT=${1:?client is required}
REPOSITORY=${2:?repository is required}
REF=${3:?ref is required}
VERSION=${4:?version is required}
VARIANT=${5:?variant is required}
GRADLE_TASK=${6:?gradle task is required}
NDK_VERSION=${7:?NDK version is required}
NATIVE_DEPS_NDK_VERSION=${8:-}

PATCHER_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SOURCE_ROOT="$PATCHER_ROOT/upstream/$CLIENT"
OUTPUT_ROOT="$PATCHER_ROOT/artifacts/$CLIENT/$VARIANT"

mkdir -p "$PATCHER_ROOT/upstream" "$OUTPUT_ROOT"
git clone --depth 1 --branch "$REF" "https://github.com/$REPOSITORY.git" "$SOURCE_ROOT"
case "$CLIENT" in
  mercurygram)
    # jni/prebuild/build_*.sh 会从源码编译各内置静态库，jni/CMakeLists.txt 也会在树内编译 libyuv 与 Abseil；
    # 上游自带的 patchNativeSources 只初始化了部分子模块，其余需在此处补齐。
    git -C "$SOURCE_ROOT" submodule update --init --recursive --depth 1 \
      TMessagesProj/jni/third_party/libvpx \
      TMessagesProj/jni/third_party/ffmpeg \
      TMessagesProj/jni/third_party/dav1d \
      TMessagesProj/jni/third_party/boringssl \
      TMessagesProj/jni/third_party/absl \
      TMessagesProj/jni/third_party/wamr \
      TMessagesProj/jni/td \
      TMessagesProj/jni/whisper
    ;;
  nnngram|nullgram)
    # 跳过上游未在 Gradle 中启用且公开 CI 不拉取的私有 libs/rust 子模块。
    git -C "$SOURCE_ROOT" -c submodule."libs/rust".update=none submodule update --init --recursive
    ;;
  *)
    git -C "$SOURCE_ROOT" submodule update --init --recursive
    ;;
esac

cd "$PATCHER_ROOT"
corepack yarn run patch:source --client "$CLIENT" --source "$SOURCE_ROOT"
corepack yarn run prepare-build --client "$CLIENT" --source "$SOURCE_ROOT" --variant "$VARIANT"
node scripts/ci/api-identity.mjs "$CLIENT" "$SOURCE_ROOT"

source "$PATCHER_ROOT/scripts/ci/native-abi-list.sh"
NATIVE_ABI_LIST=$(native_abi_list "$VARIANT")

NATIVE_TARGETS=()
for abi in $NATIVE_ABI_LIST; do
  case "$abi" in
    armeabi-v7a) NATIVE_TARGETS+=(arm) ;;
    arm64-v8a) NATIVE_TARGETS+=(arm64) ;;
    x86) NATIVE_TARGETS+=(x86) ;;
    x86_64) NATIVE_TARGETS+=(x86_64) ;;
  esac
done
export CROSSGRAM_NATIVE_TARGETS="${NATIVE_TARGETS[*]}"
# Nagram 的原生构建脚本通过环境变量 ABIS 读取与 Gradle 相同格式的 ABI 列表（Bash 数组无法跨进程导出，故以普通字符串传递）。
if [[ "$CLIENT" == "nagram" ]]; then
  export ABIS="$NATIVE_ABI_LIST"
fi

export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/$NDK_VERSION"
if [[ -n "$NATIVE_DEPS_NDK_VERSION" ]]; then
  export NATIVE_DEPS_NDK_DIR="$ANDROID_HOME/ndk/$NATIVE_DEPS_NDK_VERSION"
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

if [[ -n "$NATIVE_DEPS_NDK_VERSION" ]]; then
  printf 'NATIVE_DEPS_NDK_DIR=%s\n' "$NATIVE_DEPS_NDK_DIR" >> "$SOURCE_ROOT/local.properties"
fi

export KEYSTORE_PASS="$CROSSGRAM_KEYSTORE_PASSWORD"
export ALIAS_NAME="$CROSSGRAM_KEY_ALIAS"
export ALIAS_PASS="$CROSSGRAM_KEY_PASSWORD"
export ORG_GRADLE_PROJECT_RELEASE_STORE_PASSWORD="$CROSSGRAM_KEYSTORE_PASSWORD"
export ORG_GRADLE_PROJECT_RELEASE_KEY_ALIAS="$CROSSGRAM_KEY_ALIAS"
export ORG_GRADLE_PROJECT_RELEASE_KEY_PASSWORD="$CROSSGRAM_KEY_PASSWORD"
export ORG_GRADLE_PROJECT_RELEASE_KEYSTORE_FILE="$SOURCE_ROOT/TMessagesProj/config/release.keystore"
export COMPILE_NATIVE=1

EXTRA_GRADLE_ARGS=()
GRADLE_MAX_WORKERS=2
case "$CLIENT" in
  mercurygram)
    EXTRA_GRADLE_ARGS+=("-PMG_BUILD_TAG=$VERSION")
    ;;
  forkgram)
    # Forkgram 未将 buildNativeDeps 声明为全部 JNI 合并任务的依赖；串行执行 Gradle，防止 prepare.py 替换 dav1d 临时目标文件时与合并任务冲突。
    EXTRA_GRADLE_ARGS+=("--no-parallel")
    GRADLE_MAX_WORKERS=1
    ;;
esac

if [[ "$CLIENT" == "nagram" ]]; then
  # 新版 Nagram 在 jni/prebuild 下提交了各 ABI 的预编译静态库，但其中未开启 raw animation 所需的 APNG 解码器与 GIF parser；
  # 因此需从打好补丁的源码重新编译这三项依赖（旧版 tag 则走 `./run init libs`）。
  cd "$SOURCE_ROOT"
  if [[ -f "TMessagesProj/jni/build_boringssl.sh" ]]; then
    # 严格按 libvpx -> dav1d -> ffmpeg 顺序构建：FFmpeg 需链接前两者并打包供 JNI 编译使用的头文件目录。
    ./run init libs libvpx
    ./run init libs dav1d
    ./run init libs ffmpeg
    ./run init libs boringssl
  else
    # FFmpeg 依赖 libvpx 与 dav1d 的 pkg-config 文件，需先按相同 ABIS 构建前两者。
    for step in build_libvpx.sh build_dav1d.sh build_ffmpeg.sh; do
      echo ">> prebuild $step"
      bash "TMessagesProj/jni/prebuild/$step"
    done
  fi
fi

for brand in qq wechat wecom dingtalk discord; do
  cd "$PATCHER_ROOT"
  corepack yarn run brand --client "$CLIENT" --source "$SOURCE_ROOT" --brand "$brand"
  cd "$SOURCE_ROOT"
  # 保留增量编译缓存，仅清理已生成的 APK，确保每轮只收集当前品牌的产物。
  while IFS= read -r -d '' apk_output; do
    find "$apk_output" -mindepth 1 -delete
  done < <(find "$SOURCE_ROOT" -type d -path '*/build/outputs/apk' -print0)
  ./gradlew "$GRADLE_TASK" "${EXTRA_GRADLE_ARGS[@]}" \
    --build-cache --no-configuration-cache --max-workers="$GRADLE_MAX_WORKERS"

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

(
  cd "$OUTPUT_ROOT"
  sha256sum ./*.apk > "SHA256SUMS-${CLIENT}-${VARIANT}.txt"
)
