import Foundation
import Capacitor
import WebKit
import CryptoKit

/**
 * ConnectBrowser (iOS) — native in-app browser for StewardMD Connect Hospital.
 *
 * The doctor signs into their hospital EMR inside a full-screen WKWebView; afterwards the Connect
 * Agent drives the SAME web view (same cookies, same session) to discover read-only workflows.
 * StewardMD never sees the password: the login page is the hospital's own. See
 * local-plugins/capacitor-connect-browser/README.md for the full contract.
 *
 * Security: never logs cookies/headers/form values, never exposes cookies to JS beyond what the
 * page itself sees, and refuses non-https URLs in open()/navigate(). In agent mode, main-frame
 * navigation outside the allowlisted origins is cancelled natively — this is policy the JS layer
 * cannot widen.
 */
@objc(ConnectBrowserPlugin)
public class ConnectBrowserPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ConnectBrowserPlugin"
    public let jsName = "ConnectBrowser"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "navigate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "evaluate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainRequests", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    // One instance at a time (per README).
    private var browserVC: ConnectBrowserViewController?

    // MARK: - open / close

    @objc func open(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https" else {
            call.reject("https url required")
            return
        }
        guard let origins = call.getArray("origins", String.self) else {
            call.reject("origins required")
            return
        }
        guard let storeId = call.getString("storeId"), !storeId.isEmpty else {
            call.reject("storeId required")
            return
        }
        guard let initScript = call.getString("initScript") else {
            call.reject("initScript required")
            return
        }
        let title = call.getString("title") ?? url.host ?? ""
        let userAgent = call.getString("userAgent")

        DispatchQueue.main.async {
            self.teardownExistingBrowser(reason: "closed", notify: false)

            let config = WKWebViewConfiguration()
            let isolated: Bool
            if #available(iOS 17.0, *) {
                config.websiteDataStore = WKWebsiteDataStore(forIdentifier: Self.uuid(from: storeId))
                isolated = true
            } else {
                config.websiteDataStore = .default()
                isolated = false
            }
            config.allowsInlineMediaPlayback = true
            let userScript = WKUserScript(
                source: initScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false,
                in: .page
            )
            config.userContentController.addUserScript(userScript)

            let webView = WKWebView(frame: .zero, configuration: config)
            if let ua = userAgent, !ua.isEmpty {
                webView.customUserAgent = ua
            }
            webView.navigationDelegate = self

            let vc = ConnectBrowserViewController(webView: webView, origins: origins, title: title)
            vc.delegate = self
            self.browserVC = vc
            webView.load(URLRequest(url: url))

            guard let presenter = self.bridge?.viewController else {
                call.reject("no presenting view controller")
                return
            }
            presenter.present(vc, animated: true) {
                self.notifyListeners("opened", data: [
                    "initScriptMode": "documentStart",
                    "storeMode": isolated ? "isolated" : "default"
                ])
                call.resolve(["ok": true])
            }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardownExistingBrowser(reason: "closed")
            call.resolve(["ok": true])
        }
    }

    // MARK: - navigate / currentUrl / setMode / drainRequests / evaluate

    @objc func navigate(_ call: CAPPluginCall) {
        guard let vc = browserVC else {
            call.reject("not-open")
            return
        }
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https" else {
            call.reject("https url required")
            return
        }
        guard vc.allowedOrigins.contains(Self.origin(of: url)) else {
            call.reject("origin-not-allowed")
            return
        }
        DispatchQueue.main.async {
            vc.webView.load(URLRequest(url: url))
            call.resolve(["ok": true])
        }
    }

    @objc func currentUrl(_ call: CAPPluginCall) {
        guard let vc = browserVC else {
            call.reject("not-open")
            return
        }
        DispatchQueue.main.async {
            call.resolve([
                "url": vc.webView.url?.absoluteString ?? "",
                "title": vc.webView.title ?? ""
            ])
        }
    }

    @objc func setMode(_ call: CAPPluginCall) {
        guard let vc = browserVC else {
            call.reject("not-open")
            return
        }
        guard let mode = call.getString("mode"), mode == "login" || mode == "agent" else {
            call.reject("mode must be login or agent")
            return
        }
        let banner = call.getString("banner")
        let origins = call.getArray("origins", String.self)
        DispatchQueue.main.async {
            vc.applyMode(mode, banner: banner, origins: origins)
            call.resolve(["ok": true])
        }
    }

    @objc func drainRequests(_ call: CAPPluginCall) {
        // Android-only capture (shouldInterceptRequest); iOS has no equivalent hook.
        call.resolve(["requests": []])
    }

    // The expression may evaluate to a Promise (the phone engine's live probes are
    // `fetch(...).then(...)` expressions), so callAsyncJavaScript — which runs `expression` as the
    // body of an async function — is used instead of evaluateJavaScript: it awaits a returned
    // promise itself before the completion handler fires.
    @objc func evaluate(_ call: CAPPluginCall) {
        guard let vc = browserVC else {
            call.reject("not-open")
            return
        }
        guard let expression = call.getString("expression") else {
            call.reject("expression required")
            return
        }
        DispatchQueue.main.async {
            vc.webView.callAsyncJavaScript(
                "return (\(expression));",
                arguments: [:],
                in: nil,
                in: .page
            ) { result in
                switch result {
                case .success(let value):
                    call.resolve(["result": Self.stringify(value)])
                case .failure(let error):
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    // MARK: - Teardown

    private func teardownExistingBrowser(reason: String, notify: Bool = true) {
        guard let vc = browserVC else { return }
        vc.webView.navigationDelegate = nil
        browserVC = nil
        vc.dismiss(animated: true) {
            if notify {
                self.notifyListeners("closed", data: ["reason": reason])
            }
        }
    }

    // MARK: - Helpers

    private static func origin(of url: URL) -> String {
        guard let scheme = url.scheme, let host = url.host else { return "" }
        if let port = url.port {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }

    // Deterministic UUID derived from storeId so the same storeId always maps to the same
    // WKWebsiteDataStore identifier (SHA-256 truncated to 16 bytes).
    private static func uuid(from storeId: String) -> UUID {
        let digest = SHA256.hash(data: Data(storeId.utf8))
        let bytes = [UInt8](digest.prefix(16))
        return NSUUID(uuidBytes: bytes) as UUID
    }

    private static func stringify(_ value: Any) -> String? {
        if value is NSNull { return nil }
        if let s = value as? String { return s }
        if let n = value as? NSNumber { return n.stringValue }
        return String(describing: value)
    }
}

// MARK: - WKNavigationDelegate

extension ConnectBrowserPlugin: WKNavigationDelegate {
    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let vc = browserVC, webView === vc.webView else {
            decisionHandler(.allow)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let isHttps = url.scheme?.lowercased() == "https"

        if isMainFrame && vc.mode == "agent" {
            if !isHttps || !vc.allowedOrigins.contains(Self.origin(of: url)) {
                decisionHandler(.cancel)
                notifyListeners("blocked", data: ["url": url.absoluteString, "reason": "origin"])
                return
            }
        } else if isMainFrame && !isHttps {
            // login mode: any https origin may load (hospital SSO redirects); http is refused.
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard let vc = browserVC, webView === vc.webView else { return }
        notifyListeners("navigated", data: [
            "url": webView.url?.absoluteString ?? "",
            "mainFrame": true
        ])
    }
}

// MARK: - ConnectBrowserViewControllerDelegate

extension ConnectBrowserPlugin: ConnectBrowserViewControllerDelegate {
    func connectBrowserDidRequestClose(_ vc: ConnectBrowserViewController) {
        teardownExistingBrowser(reason: "cancel")
    }

    func connectBrowserDidTapDone(_ vc: ConnectBrowserViewController) {
        notifyListeners("loggedIn", data: ["url": vc.webView.url?.absoluteString ?? ""])
    }

    func connectBrowserDidTapStop(_ vc: ConnectBrowserViewController) {
        notifyListeners("stopped", data: ["url": vc.webView.url?.absoluteString ?? ""])
    }
}
