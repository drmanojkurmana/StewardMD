import Foundation
import UIKit
import ManagedSettings
import ManagedSettingsUI

/**
 * PrepNucleus Focus: the screen shown over a blocked app or website during a session. One look for apps, categories
 * and web domains: Midnight background, "Back to studying", the session's end time when known, amber OK.
 */
final class FocusShieldConfiguration: ShieldConfigurationDataSource {
    private static let midnight = UIColor(red: 0x1a / 255.0, green: 0x1a / 255.0, blue: 0x2e / 255.0, alpha: 1)
    private static let paper = UIColor(red: 0xf5 / 255.0, green: 0xf3 / 255.0, blue: 0xee / 255.0, alpha: 1)
    private static let amber = UIColor(red: 0xef / 255.0, green: 0xc0 / 255.0, blue: 0x7b / 255.0, alpha: 1)

    private func shield() -> ShieldConfiguration {
        var subtitle = "PrepNucleus Focus is on"
        if let end = SmdFocusShared.endsAt, end > Date() {
            let f = DateFormatter()
            f.dateFormat = "h:mm"
            subtitle += " until " + f.string(from: end)
        }
        return ShieldConfiguration(
            backgroundBlurStyle: nil,
            backgroundColor: Self.midnight,
            icon: UIImage(named: "PrepMark"),
            title: ShieldConfiguration.Label(text: "Back to studying", color: Self.paper),
            subtitle: ShieldConfiguration.Label(text: subtitle, color: Self.paper.withAlphaComponent(0.72)),
            primaryButtonLabel: ShieldConfiguration.Label(text: "OK", color: Self.midnight),
            primaryButtonBackgroundColor: Self.amber,
            secondaryButtonLabel: nil
        )
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration { shield() }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { shield() }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { shield() }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { shield() }
}
