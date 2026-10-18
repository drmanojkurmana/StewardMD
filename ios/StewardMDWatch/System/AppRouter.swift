import SwiftUI
import StewardMDWatchCore

/// Emergency sub-destinations (pushed from Emergency or directly by an intent).
enum EmergencyRoute: Hashable { case codeBlue, sepsis, abg, procedure }

/// A calculator detail push, keyed by catalog id.
struct CalcRoute: Hashable { let id: String }

/// Owns the navigation path and consumes deep-link routes requested by App
/// Intents / Siri / the Action button (written to the App Group, consumed once
/// on activation).
@MainActor
final class AppRouter: ObservableObject {
    @Published var path = NavigationPath()
    private let store = AppGroupStore()
    private var routedPhoneCode: Date?

    /// A code started on the iPhone: open Code Blue once per request so it can offer to join.
    func routePhoneCode(_ request: WatchConnectivityManager.PhoneCodeRequest?) {
        guard let request = request, routedPhoneCode != request.startedAt else { return }
        routedPhoneCode = request.startedAt
        navigate("codeBlue")
    }

    /// Called when the app becomes active — routes any pending intent request.
    func consumePending() {
        if let route = store.takePendingRoute() { navigate(route) }
    }

    /// Handles a widget/complication/universal deep link (`stewardmd://<host>[/…]`).
    func open(_ url: URL) {
        guard let host = url.host else { return }
        navigate(host)
    }

    private func navigate(_ route: String) {
        switch route {
        case "criticalLabs": path.append(RootDestination.criticalLabs)
        case "drugs": path.append(RootDestination.drugs)
        case "patients", "patient": path.append(RootDestination.patients)
        case "tasks": path.append(RootDestination.tasks)
        case "wardSync": path.append(RootDestination.wardSync)
        case "calculators": path.append(RootDestination.calculators)
        case "emergency": path.append(RootDestination.emergency)
        case "codeBlue": path.append(EmergencyRoute.codeBlue)
        case "sepsis": path.append(EmergencyRoute.sepsis)
        case "abg": path.append(EmergencyRoute.abg)
        case "procedure": path.append(EmergencyRoute.procedure)
        case "home": break   // root
        default: break
        }
    }
}
