#!/usr/bin/env bash
# Build ios/Frameworks/CNeedle.xcframework from the fetched Cactus engine static libraries (macOS + Xcode).
# The module map makes the C API (cactus.h) importable from Swift as `import CNeedle`; the module keeps
# its old name so Package.swift and the Swift import did not change when the engine moved to Cactus 4.x.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f build/ios-arm64/libcactus.a ] && [ -f include/cactus.h ] || { echo "run scripts/fetch-needle.sh first"; exit 1; }
rm -rf build/headers ios/Frameworks/CNeedle.xcframework
mkdir -p build/headers ios/Frameworks
cp include/cactus.h build/headers/
cat > build/headers/module.modulemap <<'MAP'
module CNeedle {
    header "cactus.h"
    export *
}
MAP
ARGS=(-library build/ios-arm64/libcactus.a -headers build/headers)
if [ -f build/ios-sim-arm64/libcactus.a ]; then ARGS+=(-library build/ios-sim-arm64/libcactus.a -headers build/headers); fi
xcodebuild -create-xcframework "${ARGS[@]}" -output ios/Frameworks/CNeedle.xcframework
echo "ok  ios/Frameworks/CNeedle.xcframework"
