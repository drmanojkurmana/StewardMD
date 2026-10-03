#!/usr/bin/env bash
# Build ios/Frameworks/CNeedle.xcframework from the fetched static libraries (macOS + Xcode).
# The module map makes the C API importable from Swift as `import CNeedle`.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f build/ios-arm64/libneedle.a ] && [ -f include/needle.h ] || { echo "run scripts/fetch-needle.sh first"; exit 1; }
rm -rf build/headers ios/Frameworks/CNeedle.xcframework
mkdir -p build/headers ios/Frameworks
cp include/needle.h build/headers/
cat > build/headers/module.modulemap <<'MAP'
module CNeedle {
    header "needle.h"
    export *
}
MAP
ARGS=(-library build/ios-arm64/libneedle.a -headers build/headers)
if [ -f build/ios-sim-arm64/libneedle.a ]; then ARGS+=(-library build/ios-sim-arm64/libneedle.a -headers build/headers); fi
xcodebuild -create-xcframework "${ARGS[@]}" -output ios/Frameworks/CNeedle.xcframework
echo "ok  ios/Frameworks/CNeedle.xcframework"
