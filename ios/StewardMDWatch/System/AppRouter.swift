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

    /// Called when the app becomes active — routes any pending intent request.
    func consumePending() {
        guard let route = store.takePendingRoute() else { return }
        switch route {
        case "criticalLabs": path.append(RootDestination.criticalLabs)
        case "drugs": path.append(RootDestination.drugs)
        case "patients": path.append(RootDestination.patients)
        case "codeBlue": path.append(EmergencyRoute.codeBlue)
        case "sepsis": path.append(EmergencyRoute.sepsis)
        case "abg": path.append(EmergencyRoute.abg)
        default: break
        }
    }
}
