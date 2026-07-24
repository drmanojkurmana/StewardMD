import UIKit
import Capacitor
import AppIntents

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // Screen orientation. The app is portrait-locked everywhere; the antibiogram grid asks
    // to unlock via the AppOrientation plugin, which posts "SMDSetOrientation". UIKit queries
    // this mask through supportedInterfaceOrientationsFor to decide what rotations to allow.
    static var orientationMask: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        return AppDelegate.orientationMask
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NotificationCenter.default.addObserver(
            forName: Notification.Name("SMDSetOrientation"),
            object: nil,
            queue: .main
        ) { note in
            guard let raw = note.userInfo?["mask"] as? UInt else { return }
            AppDelegate.orientationMask = UIInterfaceOrientationMask(rawValue: raw)
            AppDelegate.applyOrientation()
        }
        return true
    }

    // Force UIKit to re-evaluate and rotate to match the new mask.
    static func applyOrientation() {
        if #available(iOS 16.0, *) {
            UIApplication.shared.connectedScenes.forEach { scene in
                if let windowScene = scene as? UIWindowScene {
                    windowScene.requestGeometryUpdate(.iOS(interfaceOrientations: AppDelegate.orientationMask)) { _ in }
                }
            }
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
                .forEach { $0.setNeedsUpdateOfSupportedInterfaceOrientations() }
        } else {
            // Legacy fallback: nudge the device orientation, then let UIKit re-query the mask.
            let value = AppDelegate.orientationMask == .portrait
                ? UIInterfaceOrientation.portrait.rawValue
                : UIInterfaceOrientation.landscapeRight.rawValue
            UIDevice.current.setValue(value, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        smdConsumePendingControlRoute()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // Remote push (APNs) registration — REQUIRED by @capacitor/push-notifications.
    // iOS delivers the APNs device token (or a failure) to the app delegate; forward
    // both to Capacitor's proxy so the PushNotifications plugin fires its JS
    // "registration" / "registrationError" events. Without this the token never
    // reaches native-push.js, so the device silently never registers for push.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}

// UIScene lifecycle (required by the Xcode 26/27 iOS SDK — TN3187). The Capacitor 8
// template still ships the classic window-based AppDelegate, which the new SDK refuses
// to launch. This scene delegate rebuilds the window from Main.storyboard (whose initial
// view controller is Capacitor's CAPBridgeViewController) and forwards URL / universal-link
// events to Capacitor's ApplicationDelegateProxy — the same methods AppDelegate uses above,
// so nothing else in the app changes. Referenced from Info.plist UIApplicationSceneManifest.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window.rootViewController = storyboard.instantiateInitialViewController()
        window.makeKeyAndVisible()
        self.window = window

        // App launched via a custom-scheme URL or a universal link.
        if let urlContext = connectionOptions.urlContexts.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: urlContext.url, options: [:])
        }
        if let userActivity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        smdConsumePendingControlRoute()
    }
}

// Control Center / Action-button Controls (iOS 18) launch the app after their AppIntent stashes a
// deep-link route in the shared App Group. On activation we replay it as a stewardmd:// open through
// Capacitor's proxy — the exact path a widgetURL tap uses — so the web layer routes it normally.
private let smdControlRouteFile = "pendingControlRoute"

private func smdConsumePendingControlRoute(attempt: Int = 0) {
    let suite = "group.in.stewardmd.app"
    // A control fires perform() in the widget-extension process, which stashes the route in the App Group
    // (as both an atomic FILE — immediately visible cross-process — and a UserDefaults key) and then defers
    // the app to the foreground. Cross-process UserDefaults writes lag a few hundred ms, so we read the file
    // first and still retry briefly to cover the deferred-activation race.
    let fm = FileManager.default
    let fileURL = fm.containerURL(forSecurityApplicationGroupIdentifier: suite)?.appendingPathComponent(smdControlRouteFile)
    var route = fileURL.flatMap { try? String(contentsOf: $0, encoding: .utf8) }?.trimmingCharacters(in: .whitespacesAndNewlines)
    if route?.isEmpty != false { route = UserDefaults(suiteName: suite)?.string(forKey: "smd.pendingControlRoute") }
    NSLog("SMD-CONSUME activate attempt=\(attempt) file=\(fileURL?.path ?? "?") route=\(route ?? "nil")")

    guard let r = route, !r.isEmpty else {
        if attempt < 8 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { smdConsumePendingControlRoute(attempt: attempt + 1) }
        }
        return
    }
    if let f = fileURL { try? fm.removeItem(at: f) }
    UserDefaults(suiteName: suite)?.removeObject(forKey: "smd.pendingControlRoute")
    guard let url = URL(string: "stewardmd://" + r) else { return }
    NSLog("SMD-CONSUME replaying \(url.absoluteString)")
    _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
}

// Stash the deep-link route the same way the widget extension does (atomic App Group file + UserDefaults),
// so smdConsumePendingControlRoute() replays it on activation.
private func smdStashControlRoute(_ route: String) {
    let suite = "group.in.stewardmd.app"
    let fm = FileManager.default
    if let dir = fm.containerURL(forSecurityApplicationGroupIdentifier: suite) {
        try? route.write(to: dir.appendingPathComponent(smdControlRouteFile), atomically: true, encoding: .utf8)
    }
    UserDefaults(suiteName: suite)?.set(route, forKey: "smd.pendingControlRoute")
}

// App-target copies of the Control Center intents. iOS 18 controls run a .foreground intent in the OWNING
// APP process, so the intent type must exist here (the widget extension also declares matching types for the
// ControlWidgetButton; AppIntents matches by identifier). perform() stashes the route; the deferred/foreground
// activation then fires smdConsumePendingControlRoute() (which retries to cover the write→activate race).
@available(iOS 26.0, *)
struct CBControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Code Blue"
    static let supportedModes: IntentModes = [.background, .foreground(.deferred)]
    func perform() async throws -> some IntentResult {
        NSLog("SMD-CTRL(app) fired codeblue")
        smdStashControlRoute("codeblue")
        return .result()
    }
}

@available(iOS 26.0, *)
struct MaikControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Maik"
    static let supportedModes: IntentModes = [.background, .foreground(.deferred)]
    func perform() async throws -> some IntentResult {
        NSLog("SMD-CTRL(app) fired askai")
        smdStashControlRoute("askai")
        return .result()
    }
}

@available(iOS 26.0, *)
struct DrugControlIntent: AppIntent {
    static let title: LocalizedStringResource = "Drug lookup"
    static let supportedModes: IntentModes = [.background, .foreground(.deferred)]
    func perform() async throws -> some IntentResult {
        NSLog("SMD-CTRL(app) fired drugs")
        smdStashControlRoute("drugs")
        return .result()
    }
}
