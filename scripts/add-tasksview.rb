#!/usr/bin/env ruby
# frozen_string_literal: true
# One-off: add ios/StewardMDWatch/TasksView.swift to the StewardMDWatch target.
# The project uses explicit file references (no synchronized groups), so a new
# source file must be registered here or Xcode won't compile it.
#   Run:  ruby scripts/add-tasksview.rb   (quit Xcode first)

require "xcodeproj"

ROOT    = File.expand_path("..", __dir__)
PROJECT = File.join(ROOT, "ios/App/App.xcodeproj")
abort("✗ project not found: #{PROJECT}") unless File.exist?(PROJECT)

project = Xcodeproj::Project.open(PROJECT)
target  = project.targets.find { |t| t.name == "StewardMDWatch" }
abort("✗ StewardMDWatch target not found") unless target

if project.files.any? { |f| f.display_name == "TasksView.swift" }
  puts "✓ TasksView.swift already referenced — nothing to do."
  exit 0
end

# Place it next to a known sibling view, in the same group + target.
sibling = project.files.find { |f| f.display_name == "CriticalLabsView.swift" }
abort("✗ couldn't locate CriticalLabsView.swift to anchor the group") unless sibling
group = sibling.parent

ref = group.new_file("TasksView.swift") # path relative to the group's dir
target.source_build_phase.add_file_reference(ref, true)
project.save

puts "✓ Added TasksView.swift to the StewardMDWatch target."
