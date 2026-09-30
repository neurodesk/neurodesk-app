#!/usr/bin/env bash
# Download the pinned NeurodeskAppX (crumblecracker) release into ./ndappx/.
# Usage: scripts/fetch-ndappx.sh <linux_amd64|linux_arm64|darwin_arm64|windows_amd64>
# The version comes from "ndappx_version" in package.json.
set -euo pipefail

target="${1:?usage: $0 <linux_amd64|linux_arm64|darwin_arm64|windows_amd64>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(cd "$root" && python3 scripts/get_package_version.py --package_name ndappx)"
if [ -z "$version" ]; then
  echo "ndappx_version is missing from package.json" >&2
  exit 1
fi

case "$target" in
  linux_amd64 | linux_arm64) asset="NeurodeskAppX_v${version}_${target}" ;;
  windows_amd64) asset="NeurodeskAppX_v${version}_${target}.exe" ;;
  darwin_arm64) asset="NeurodeskAppX_v${version}_${target}.zip" ;;
  *)
    echo "unsupported target: $target" >&2
    exit 1
    ;;
esac

base="https://github.com/tinyrange/crumblecracker/releases/download/v${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/checksums.txt" "$base/checksums.txt"
curl -fSL -o "$work/$asset" "$base/$asset"

expected="$(awk -v f="$asset" '$2 == f || $2 == "*"f { print $1 }' "$work/checksums.txt")"
if [ -z "$expected" ]; then
  echo "$asset is not listed in checksums.txt" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$work/$asset" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$work/$asset" | awk '{ print $1 }')"
fi
if [ "$expected" != "$actual" ]; then
  echo "checksum mismatch for $asset: expected $expected, got $actual" >&2
  exit 1
fi

rm -rf "$root/ndappx"
mkdir -p "$root/ndappx"
case "$target" in
  linux_*)
    cp "$work/$asset" "$root/ndappx/NeurodeskAppX"
    chmod +x "$root/ndappx/NeurodeskAppX"
    ;;
  windows_amd64)
    cp "$work/$asset" "$root/ndappx/NeurodeskAppX.exe"
    ;;
  darwin_arm64)
    # ditto keeps the notarized bundle's signature, symlinks and xattrs intact.
    ditto -x -k "$work/$asset" "$root/ndappx"
    test -x "$root/ndappx/NeurodeskAppX.app/Contents/MacOS/NeurodeskAppX"
    ;;
esac

echo "NeurodeskAppX v${version} (${target}) installed in ndappx/"
