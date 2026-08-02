#!/usr/bin/env bash
set -euo pipefail

APK_ROOT=${1:-artifacts/e2e-nagram-x86_64}
PACKAGE_NAME=${CROSSGRAM_E2E_PACKAGE:-xyz.nextalone.nagram.crossgram.qq}
COMPONENT="$PACKAGE_NAME/org.telegram.ui.CrossgramE2eActivity"
ACTION=org.telegram.messenger.CROSSGRAM_E2E
FIXTURE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../tests/fixtures/raw-animation" && pwd)

APK=$(find "$APK_ROOT" -type f -name '*.apk' -print -quit)
if [[ -z "$APK" ]]; then
  echo "No E2E APK found under $APK_ROOT" >&2
  exit 1
fi

adb wait-for-device
adb install -r -g "$APK"
adb shell input keyevent 82 || true
adb push "$FIXTURE_ROOT/two-frame.gif" /data/local/tmp/crossgram-two-frame.gif >/dev/null
adb push "$FIXTURE_ROOT/two-frame.apng" /data/local/tmp/crossgram-two-frame.apng >/dev/null

run_animation() {
  local format=$1
  local file=$2
  adb logcat -c
  adb shell am force-stop "$PACKAGE_NAME"
  adb shell am start -W \
    -n "$COMPONENT" \
    -a "$ACTION" \
    --es crossgram_e2e_command raw-animation-file \
    --es crossgram_e2e_file "$file" \
    --es crossgram_e2e_format "$format" >/dev/null

  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    local output
    output=$(adb logcat -d -s CrossgramE2E:V '*:S')
    if grep -F "raw_animation_failed" <<<"$output" | grep -F "format=$format" >/dev/null; then
      printf '%s\n' "$output" >&2
      return 1
    fi
    if grep -F "raw_animation_decoded format=$format" <<<"$output" \
      | grep -F "frames_changed=true" \
      | grep -F "looped=true" >/dev/null; then
      printf '%s\n' "$output"
      return 0
    fi
    sleep 1
  done
  adb logcat -d -s CrossgramE2E:V '*:S' >&2
  adb logcat -d -t 500 >&2
  echo "Timed out waiting for changing $format frames" >&2
  return 1
}

run_animation gif /data/local/tmp/crossgram-two-frame.gif
run_animation apng /data/local/tmp/crossgram-two-frame.apng
