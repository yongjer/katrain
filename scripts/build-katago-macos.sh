#!/usr/bin/env bash
# Builds the KataGo that the macOS app bundles: the Metal backend on Apple Silicon, OpenCL on Intel.
# Its Homebrew libraries are copied next to it (katago-libs/) so the app works without Homebrew.
#
#   scripts/build-katago-macos.sh [output dir]     (default: resources/KataGo)
#
# Needs Xcode (Swift 5.9+ for the Metal backend) and Homebrew. KATAGO_REF picks the KataGo branch or tag.
set -euo pipefail

out="$(cd "$(dirname "$0")/.." && pwd)/${1:-resources/KataGo}"
ref="${KATAGO_REF:-stable}"
if [ "$(uname -m)" = "arm64" ]; then backend=METAL; else backend=OPENCL; fi
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

brew list ninja >/dev/null 2>&1 || brew install ninja
brew list dylibbundler >/dev/null 2>&1 || brew install dylibbundler
if [ "$backend" = METAL ]; then
  for f in protobuf abseil; do brew list "$f" >/dev/null 2>&1 || brew install "$f"; done
fi

git clone --depth 1 --branch "$ref" https://github.com/lightvector/KataGo.git "$work/KataGo"
# Without BUILD_DISTRIBUTED and libzip: KaTrain only uses the analysis engine.
cmake -S "$work/KataGo/cpp" -B "$work/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DUSE_BACKEND="$backend"
cmake --build "$work/build" -j"$(sysctl -n hw.ncpu)"

mkdir -p "$out"
rm -rf "$out/katago-osx" "$out/katago-libs"
cp "$work/build/katago" "$out/katago-osx"
mkdir -p "$out/katago-libs"
printf 'Libraries used by katago-osx (KataGo %s, %s backend), copied from Homebrew by scripts/build-katago-macos.sh.\n' \
  "$ref" "$backend" > "$out/katago-libs/README.txt"
dylibbundler -of -b -x "$out/katago-osx" -d "$out/katago-libs" -p @executable_path/katago-libs/
# rewriting the load paths invalidates the signatures; Apple Silicon needs (ad-hoc) signed code
find "$out/katago-libs" -name '*.dylib' -exec codesign --force --sign - {} \;
codesign --force --sign - "$out/katago-osx"

# everything it loads must be part of macOS or bundled
if otool -L "$out/katago-osx" "$out"/katago-libs/*.dylib 2>/dev/null | grep -E '^\s+/(opt/homebrew|usr/local)/'; then
  echo "katago-osx still depends on Homebrew libraries" >&2
  exit 1
fi
"$out/katago-osx" version
