#!/usr/bin/env bash
# 输出发布变体对应的 Gradle ABI 名称列表。
#
# patcher 会将这些名称映射为传给 Forkgram 与 BoringSSL 的简写目标（arm/arm64/x86/x86_64），
# 而 Nagram 的 jni/third_party 脚本与 Forkgram 的 prebuild 脚本则直接从环境变量 ABIS 读取此列表。
#
# 用法: source scripts/ci/native-abi-list.sh; abis=$(native_abi_list arm64)
native_abi_list() {
  case "${1:?variant is required}" in
    armAll) printf '%s\n' "armeabi-v7a arm64-v8a" ;;
    arm64) printf '%s\n' "arm64-v8a" ;;
    x86_64) printf '%s\n' "x86_64" ;;
    universal) printf '%s\n' "armeabi-v7a arm64-v8a x86 x86_64" ;;
    *)
      echo "Unknown variant: $1" >&2
      return 2
      ;;
  esac
}
