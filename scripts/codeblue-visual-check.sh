#!/usr/bin/env bash
# Native SwiftUI rendering using the real dashboard and shared Core module.
set -euo pipefail
cd "$(dirname "$0")/.."
swift build --package-path Packages/StewardMDWatchCore
core_build=$(swift build --package-path Packages/StewardMDWatchCore --show-bin-path)
render_build=$(mktemp -d /tmp/codeblue-render.XXXXXX)
swiftc -parse-as-library -I "$core_build" -I "$core_build/Modules" \
  -L "$core_build" -lStewardMDWatchCore \
  local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue/CodeBlueDashboard.swift \
  test/codeblue-render.swift -o "$render_build/render"
"$render_build/render" "${1:-/tmp/stewardmd-codeblue-ux}"
