import Foundation
import ManagedSettings

/**
 * PrepNucleus Focus: what the shield's button does. OK closes the blocked app. There is no secondary button, and iOS
 * does not let a shield open another app, so this cannot jump to StewardMD.
 */
final class FocusShieldActionExtension: ShieldActionDelegate {
    private func respond(_ action: ShieldAction, _ done: @escaping (ShieldActionResponse) -> Void) {
        done(action == .primaryButtonPressed ? .close : .none)
    }

    override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, completionHandler)
    }

    override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, completionHandler)
    }

    override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        respond(action, completionHandler)
    }
}
