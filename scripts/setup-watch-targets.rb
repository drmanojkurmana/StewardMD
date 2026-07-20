#!/usr/bin/env ruby
# frozen_string_literal: true
#
# StewardMD — programmatically add the Apple Watch app + widget targets to the
# Capacitor iOS Xcode project, so you don't have to click through Xcode dialogs.
#
#   Prereq:  gem install xcodeproj
#   Run:     ruby scripts/setup-watch-targets.rb
#            (QUIT Xcode first — editing the project while it's open loses changes.)
#
# What it does (additive; the ONLY change to the existing "App" target is an
# "Embed Watch Content" build phase + dependency so the watch app ships inside
# the iPhone app):
#   • Creates target  StewardMDWatch          (watchOS app,  in.stewardmd.app.watchkitapp)
#   • Creates target  StewardMDWatchWidgets    (widget ext,   in.stewardmd.app.watchkitapp.widgets)
#   • Adds the local Swift package  Packages/StewardMDWatchCore  and links it to both
#   • Adds every authored source file (ios/StewardMDWatch, ios/StewardMDWatchWidgets)
#     with correct target membership; wires Info.plist / entitlements via build settings
#   • Sets App Groups (via the entitlements files), team, deployment target (watchOS 10)
#   • Embeds the widget inside the watch app
#   • Adds an "Embed Watch Content" phase to the App target so the watch app is
#     bundled inside the iPhone app — required for it to auto-install on the paired
#     Apple Watch and show its Home Screen icon.
#
# Idempotent-ish: aborts if a StewardMDWatch target already exists (reset first).

require "xcodeproj"

TEAM        = "5QY4LUKX23"
GROUP_ID    = "group.in.stewardmd.app"
WATCH_BID   = "in.stewardmd.app.watchkitapp"
WIDGET_BID  = "in.stewardmd.app.watchkitapp.widgets"
WATCH_OS    = "10.0"
SWIFT_VER   = "5.0"

ROOT        = ENV["SMD_SETUP_ROOT"] || File.expand_path("..", __dir__)
PROJECT     = ENV["SMD_SETUP_PROJECT"] || File.join(ROOT, "ios/App/App.xcodeproj")
SRCROOT     = File.dirname(PROJECT)                       # ios/App
PKG_REL     = "../../Packages/StewardMDWatchCore"          # relative to SRCROOT

abort("✗ project not found: #{PROJECT}") unless File.exist?(PROJECT)
project = Xcodeproj::Project.open(PROJECT)

if project.targets.any? { |t| t.name == "StewardMDWatch" || t.name == "StewardMDWatchWidgets" }
  abort("✗ A watch target already exists. Reset first:\n" \
        "    git checkout -- ios/App/App.xcodeproj/project.pbxproj\n" \
        "  and delete any half-made target folder (e.g. 'ios/App/StewardMDWatch Watch App').")
end

# ── local Swift package reference (reuse if already present) ──────────────────
pkg_ref = project.root_object.package_references.find do |r|
  r.is_a?(Xcodeproj::Project::Object::XCLocalSwiftPackageReference) && r.relative_path == PKG_REL
end
unless pkg_ref
  pkg_ref = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
  pkg_ref.relative_path = PKG_REL
  project.root_object.package_references << pkg_ref
end

def link_core(project, target, pkg_ref)
  dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dep.product_name = "StewardMDWatchCore"
  dep.package = pkg_ref
  target.package_product_dependencies << dep
  bf = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  bf.product_ref = dep
  target.frameworks_build_phase.files << bf
end

# ── recursively add a source folder to a target, mirroring subgroups ──────────
# .swift → sources · *.xcassets (leaf) → resources · Info.plist/.entitlements →
# reference only (wired via build settings, never bundled/compiled).
def add_tree(project, group, dir, target)
  Dir.children(dir).sort.each do |name|
    path = File.join(dir, name)
    if name.end_with?(".xcassets")
      ref = group.new_reference(path)
      target.resources_build_phase.add_file_reference(ref)
    elsif File.directory?(path)
      sub = group.new_group(name, name)
      add_tree(project, sub, path, target)
    elsif name.end_with?(".swift")
      ref = group.new_reference(path)
      target.source_build_phase.add_file_reference(ref)
    elsif name == "Info.plist" || name.end_with?(".entitlements")
      group.new_reference(path) # visible in navigator; referenced via build settings
    end
  end
end

def apply_settings(target, settings)
  target.build_configurations.each do |c|
    settings.each { |k, v| c.build_settings[k] = v }
  end
end

common = {
  # new_target leaves PRODUCT_NAME unset, which builds a nameless ".app"/".appex"
  # and trips "Multiple commands produce …". Set it so each product is named.
  "PRODUCT_NAME" => "$(TARGET_NAME)",
  "DEVELOPMENT_TEAM" => TEAM,
  "CODE_SIGN_STYLE" => "Automatic",
  "SWIFT_VERSION" => SWIFT_VER,
  "WATCHOS_DEPLOYMENT_TARGET" => WATCH_OS,
  "TARGETED_DEVICE_FAMILY" => "4",
  "SDKROOT" => "watchos",
  "GENERATE_INFOPLIST_FILE" => "NO",
  "CURRENT_PROJECT_VERSION" => "1",
  "MARKETING_VERSION" => "2.0",
  "SWIFT_EMIT_LOC_STRINGS" => "YES"
}

# ── Watch app target ──────────────────────────────────────────────────────────
watch = project.new_target(:application, "StewardMDWatch", :watchos, WATCH_OS, nil, :swift)
apply_settings(watch, common.merge(
  "PRODUCT_BUNDLE_IDENTIFIER" => WATCH_BID,
  "INFOPLIST_FILE" => "../StewardMDWatch/Info.plist",
  "CODE_SIGN_ENTITLEMENTS" => "../StewardMDWatch/StewardMDWatch.entitlements",
  "ASSETCATALOG_COMPILER_APPICON_NAME" => "AppIcon",
  "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME" => "AccentColor"
))
link_core(project, watch, pkg_ref)
watch_group = project.main_group.new_group("StewardMDWatch", "../StewardMDWatch")
add_tree(project, watch_group, File.join(ROOT, "ios/StewardMDWatch"), watch)

# ── Widget extension target ─────────────────────────────────────────────────
widget = project.new_target(:app_extension, "StewardMDWatchWidgets", :watchos, WATCH_OS, nil, :swift)
apply_settings(widget, common.merge(
  "PRODUCT_BUNDLE_IDENTIFIER" => WIDGET_BID,
  "INFOPLIST_FILE" => "../StewardMDWatchWidgets/Info.plist",
  "CODE_SIGN_ENTITLEMENTS" => "../StewardMDWatchWidgets/StewardMDWatchWidgets.entitlements"
))
link_core(project, widget, pkg_ref)
widget_group = project.main_group.new_group("StewardMDWatchWidgets", "../StewardMDWatchWidgets")
add_tree(project, widget_group, File.join(ROOT, "ios/StewardMDWatchWidgets"), widget)

# ── Embed the widget inside the watch app ─────────────────────────────────────
watch.add_dependency(widget)
embed = watch.new_copy_files_build_phase("Embed Foundation Extensions")
embed.symbol_dst_subfolder_spec = :plug_ins
bf = embed.add_file_reference(widget.product_reference, true)
bf.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

# ── Embed the watch app inside the iOS App target ─────────────────────────────
# Bundles StewardMDWatch.app under App.app/Watch/. Without this the watch app is
# never shipped inside the iPhone app, so it won't auto-install on the paired
# Apple Watch and no Home Screen icon appears there.
app = project.targets.find { |t| t.name == "App" }
abort("✗ Could not find the iOS 'App' target to embed watch content") unless app
app.add_dependency(watch)
embed_watch = app.new_copy_files_build_phase("Embed Watch Content")
embed_watch.symbol_dst_subfolder_spec = :products_directory   # 16
embed_watch.dst_path = "$(CONTENTS_FOLDER_PATH)/Watch"
wbf = embed_watch.add_file_reference(watch.product_reference, true)
wbf.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

project.save

puts "✓ Added targets: #{project.targets.map(&:name).join(', ')}"
puts "✓ StewardMDWatchCore linked to StewardMed watch + widget targets"
puts "✓ Saved #{PROJECT}"
puts ""
puts "Next:"
puts "  1) Open Xcode → Signing & Capabilities → confirm App Groups '#{GROUP_ID}' on"
puts "     App, StewardMDWatch, StewardMDWatchWidgets (automatic signing, team #{TEAM})."
puts "  2) Select the StewardMDWatch scheme + a paired iPhone/Watch simulator → Build & Run."
puts "  3) To verify auto-install: run the App scheme to a paired iPhone; the watch"
puts "     app installs on the paired Apple Watch (Watch app → General → automatic)."
