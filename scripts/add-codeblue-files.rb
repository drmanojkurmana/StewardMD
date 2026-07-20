#!/usr/bin/env ruby
# frozen_string_literal: true
# One-off: register new StewardMDWatch source files in the target.
#   Run:  ruby scripts/add-codeblue-files.rb   (quit Xcode first)
require "xcodeproj"

ROOT    = File.expand_path("..", __dir__)
PROJECT = File.join(ROOT, "ios/App/App.xcodeproj")
project = Xcodeproj::Project.open(PROJECT)
target  = project.targets.find { |t| t.name == "StewardMDWatch" }
abort("✗ StewardMDWatch target not found") unless target

FILES = ["CoreMotionCompressionDetector.swift", "HealthKitWorkoutKeepAlive.swift", "CaptureLog.swift"]
anchor = project.files.find { |f| f.display_name == "WatchConnectivityManager.swift" }
abort("✗ anchor not found") unless anchor
group = anchor.parent

FILES.each do |name|
  if project.files.any? { |f| f.display_name == name }
    puts "✓ #{name} already referenced"; next
  end
  ref = group.new_file(name)
  target.source_build_phase.add_file_reference(ref, true)
  puts "✓ Added #{name}"
end
project.save
