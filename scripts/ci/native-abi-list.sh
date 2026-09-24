#!/usr/bin/env bash
# Print the Gradle ABI names for a release variant.
#
# The patcher maps these names onto the short native targets (arm/arm64/x86/
# x86_64) it passes to Forkgram and BoringSSL, while Nagram's
# TMessagesProj/jni/third_party scripts and Forkgram's prebuild scripts read the
# same list from the ABIS environment variable.
#
# Usage: source scripts/ci/native-abi-list.sh; abis=$(native_abi_list arm64)
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
