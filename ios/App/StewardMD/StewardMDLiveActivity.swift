//
//  StewardMDLiveActivity.swift
//  StewardMD
//
//  Created by Kurmana Diwakar Kumar on 24/07/26.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct StewardMDAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic stateful properties about your activity go here!
        var emoji: String
    }

    // Fixed non-changing properties about your activity go here!
    var name: String
}

struct StewardMDLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StewardMDAttributes.self) { context in
            // Lock screen/banner UI goes here
            VStack {
                Text("Hello \(context.state.emoji)")
            }
            .activityBackgroundTint(Color.cyan)
            .activitySystemActionForegroundColor(Color.black)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI goes here.  Compose the expanded UI through
                // various regions, like leading/trailing/center/bottom
                DynamicIslandExpandedRegion(.leading) {
                    Text("Leading")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Trailing")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Bottom \(context.state.emoji)")
                    // more content
                }
            } compactLeading: {
                Text("L")
            } compactTrailing: {
                Text("T \(context.state.emoji)")
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "http://www.apple.com"))
            .keylineTint(Color.red)
        }
    }
}

extension StewardMDAttributes {
    fileprivate static var preview: StewardMDAttributes {
        StewardMDAttributes(name: "World")
    }
}

extension StewardMDAttributes.ContentState {
    fileprivate static var smiley: StewardMDAttributes.ContentState {
        StewardMDAttributes.ContentState(emoji: "😀")
     }
     
     fileprivate static var starEyes: StewardMDAttributes.ContentState {
         StewardMDAttributes.ContentState(emoji: "🤩")
     }
}

#Preview("Notification", as: .content, using: StewardMDAttributes.preview) {
   StewardMDLiveActivity()
} contentStates: {
    StewardMDAttributes.ContentState.smiley
    StewardMDAttributes.ContentState.starEyes
}
