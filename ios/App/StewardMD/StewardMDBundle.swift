//
//  StewardMDBundle.swift
//  StewardMD
//
//  Created by Kurmana Diwakar Kumar on 24/07/26.
//

import WidgetKit
import SwiftUI

@main
struct StewardMDBundle: WidgetBundle {
    var body: some Widget {
        StewardMD()
        StewardMDControl()
        StewardMDLiveActivity()
    }
}
