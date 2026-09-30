#!/usr/bin/env python3
"""Normalize the release APK names and write crossgram-update.json.

GitHub rewrites every character outside [A-Za-z0-9._-] of an uploaded asset
name (Nagram names its APKs "...-v12.10.1(1248).apk", which is published as
"...-v12.10.1.1248.apk"), so a manifest built from the local file names points
at URLs that 404. The APKs are renamed to the published spelling first; the
manifest and the uploaded files then agree by construction.

Usage: release-manifest.py <assets-dir> <repository> <run-number> <notes-file>
"""

import hashlib
import json
import pathlib
import re
import sys

ASSET_PATTERN = re.compile(
    r"^(?P<client>[a-z]+)-(?P<version>.+)-(?P<variant>arm64|x86_64)"
    r"-(?P<brand>qq|wechat|wecom|dingtalk|discord)-.+\.apk$"
)


def published_name(name: str) -> str:
    """The name GitHub gives an uploaded release asset."""
    safe = re.sub(r"[^A-Za-z0-9._-]", ".", name)
    safe = re.sub(r"\.{2,}", ".", safe)
    return safe.strip(".")


def normalize(directory: pathlib.Path) -> list[pathlib.Path]:
    apks = []
    renamed = {}
    for path in sorted(directory.glob("*.apk")):
        target = path.with_name(published_name(path.name))
        if target != path:
            if target.exists():
                raise SystemExit(f"release asset name collision: {path.name} -> {target.name}")
            path.rename(target)
            renamed[path.name] = target.name
        apks.append(target)
    # Keep the published checksum lists in step with the renamed files.
    for sums in sorted(directory.glob("SHA256SUMS*.txt")):
        text = sums.read_bytes().decode("utf-8")
        updated = text
        for old, new in renamed.items():
            updated = updated.replace(old, new)
        if updated != text:
            sums.write_bytes(updated.encode("utf-8"))
    return sorted(apks)


def build_manifest(directory: pathlib.Path, repository: str, run: int, notes: str) -> dict:
    tag = f"crossgram-{run}"
    assets = []
    for path in normalize(directory):
        match = ASSET_PATTERN.match(path.name)
        if not match:
            raise SystemExit(f"unexpected release asset name: {path.name}")
        assets.append({
            **match.groupdict(),
            "url": f"https://github.com/{repository}/releases/download/{tag}/{path.name}",
            "size": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    return {"build": run, "assets": assets, "notes": notes}


def main(argv: list[str]) -> None:
    if len(argv) != 5:
        raise SystemExit(__doc__)
    directory = pathlib.Path(argv[1])
    notes = pathlib.Path(argv[4]).read_text(encoding="utf-8").strip()
    manifest = build_manifest(directory, argv[2], int(argv[3]), notes)
    (directory / "crossgram-update.json").write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )
    print(f"crossgram-update.json: {len(manifest['assets'])} assets for build {manifest['build']}")


if __name__ == "__main__":
    main(sys.argv)
