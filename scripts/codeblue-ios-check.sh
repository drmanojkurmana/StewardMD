#!/usr/bin/env bash
# Compile the actual Code Blue views/model against the iOS SDK without signing or deployment.
set -euo pipefail
cd "$(dirname "$0")/.."
check_build=$(mktemp -d /tmp/codeblue-ios.XXXXXX)
ios_sdk=$(xcrun --sdk iphoneos --show-sdk-path)
core=Packages/StewardMDWatchCore/Sources/StewardMDWatchCore
feature=local-plugins/capacitor-watch-bridge/ios/Sources/WatchBridgePlugin/CodeBlue
xcrun swiftc -emit-module -parse-as-library -module-name StewardMDWatchCore \
  -target arm64-apple-ios16.0 -sdk "$ios_sdk" \
  "$core/Models/CodeEvent.swift" "$core/Models/CodeBlueState.swift" \
  "$core/Models/CodeSummary.swift" "$core/Models/CodeBluePresentation.swift" \
  "$core/Engines/TimerEngine.swift" "$core/Engines/RateCoach.swift" \
  "$core/Formatting/TimeFormat.swift" "$core/Widgets/CodeBlueActivity.swift" \
  -emit-module-path "$check_build/StewardMDWatchCore.swiftmodule"
xcrun swiftc -typecheck -swift-version 5 -target arm64-apple-ios16.0 -sdk "$ios_sdk" \
  -I "$check_build" test/codeblue-relay-stub.swift \
  "$feature/CodeBlueSyncService.swift" "$feature/CodeBlueLiveModel.swift" \
  "$feature/CodeBlueDashboard.swift" "$feature/CommandCenterView.swift"
echo "Code Blue iOS typecheck passed"
