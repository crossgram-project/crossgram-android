#!/usr/bin/env bash
set -euo pipefail

APT_OPTIONS=(
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
  -o Dpkg::Use-Pty=0
)

run_apt() {
  local limit=$1
  shift

  local attempt
  for attempt in 1 2 3; do
    if sudo timeout --signal=TERM --kill-after=30s "$limit" \
      env DEBIAN_FRONTEND=noninteractive \
      apt-get "${APT_OPTIONS[@]}" "$@"; then
      return 0
    fi

    if (( attempt < 3 )); then
      echo "apt-get $* failed or timed out (attempt $attempt/3); retrying..." >&2
      sleep $((attempt * 10))
    fi
  done

  echo "apt-get $* failed after 3 attempts" >&2
  return 1
}

run_apt 5m update
run_apt 15m install -y \
  autoconf automake bison ccache cmake curl gcc gperf libtool \
  libuv1-dev make meson nasm ninja-build patch pkg-config yasm
