#!/usr/bin/env bash
# Builds the KataGo that the macOS app bundles: the Metal backend on Apple Silicon, OpenCL on Intel.
# Its Homebrew libraries are copied next to it (katago-libs/) so the app works without Homebrew.
#
#   scripts/build-katago-macos.sh [output dir]     (default: resources/KataGo)
#
# Needs Xcode 16+ (a macOS 15 SDK; Swift 5.9+ for the Metal backend) and Homebrew. KATAGO_REF picks the KataGo branch or tag.
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
# quick_exit only exists in macOS 15+; _Exit does the same here (KataGo registers no at_quick_exit handlers)
sed -i '' 's/quick_exit(EXIT_FAILURE)/_Exit(EXIT_FAILURE)/' "$work/KataGo/cpp/core/global.cpp"

# Without BUILD_DISTRIBUTED and libzip: Katraineo only uses the analysis engine.
flags=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DUSE_BACKEND="$backend")
if [ "$backend" = OPENCL ]; then
  # OpenCL and zlib come with macOS: keep Homebrew's libraries (built for the newest macOS) out entirely
  flags+=(-DCMAKE_IGNORE_PREFIX_PATH="/usr/local;/opt/homebrew" -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0)
fi
cmake -S "$work/KataGo/cpp" -B "$work/build" "${flags[@]}"
cmake --build "$work/build" -j"$(sysctl -n hw.ncpu)"

mkdir -p "$out"
rm -rf "$out/katago-osx" "$out/katago-libs"
cp "$work/build/katago" "$out/katago-osx"
mkdir -p "$out/katago-libs"
printf 'Libraries used by katago-osx (KataGo %s, %s backend), copied from Homebrew by scripts/build-katago-macos.sh.\n' \
  "$ref" "$backend" > "$out/katago-libs/README.txt"
dylibbundler -of -b -x "$out/katago-osx" -d "$out/katago-libs" -p @executable_path/katago-libs/
# the binary can end up with this rpath several times, and dyld refuses duplicates when it is built for macOS 26+
rpath=@executable_path/katago-libs/
while [ "$(otool -l "$out/katago-osx" | grep -c "path $rpath ")" -gt 1 ]; do
  install_name_tool -delete_rpath "$rpath" "$out/katago-osx"
done
# rewriting the load paths invalidates the signatures; Apple Silicon needs (ad-hoc) signed code
find "$out/katago-libs" -name '*.dylib' -exec codesign --force --sign - {} \;
codesign --force --sign - "$out/katago-osx"

# everything it loads must be part of macOS or bundled
if otool -L "$out/katago-osx" "$out"/katago-libs/*.dylib 2>/dev/null | grep -E '^\s+/(opt/homebrew|usr/local)/'; then
  echo "katago-osx still depends on Homebrew libraries" >&2
  exit 1
fi
"$out/katago-osx" version
# the oldest macOS it runs on is the newest minimum of it and its libraries
for f in "$out/katago-osx" "$out"/katago-libs/*.dylib; do
  [ -f "$f" ] && echo "$(basename "$f"): macOS $(vtool -show-build "$f" 2>/dev/null | awk '/minos/ {print $2}')"
done | sort -t' ' -k3 -V | tail -1 || true
