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

    // Automatic sign-in detection state (see maybeAutoLoggedIn). Reset with every browser open.
    private var sawPasswordField = false
    private var autoLoginNotified = false

    // Capped request log fed by main-frame navigations (decidePolicyFor) and the document-start
    // fetch/XHR-wrapping user script (didReceive message), drained by drainRequests().
    private var requestLog: [[String: String]] = []
    private static let requestLogCap = 500
    private static let requestLogMessageHandler = "smdRequestLog"

    // WKWebView has no hook that observes every subresource load (no WKURLSchemeHandler is
    // registered for https, and there is no iOS equivalent of Android's shouldInterceptRequest), so
    // main-frame navigations are logged natively in decidePolicyFor and this document-start script
    // additionally wraps fetch/XMLHttpRequest to report method+url for JS-initiated subresource
    // requests. Requests the page issues by other means (e.g. <img>/<script> tag src, WebSocket)
    // are not captured — same limitation the Android plugin documents for its own hook.
    private static let requestLogScript = """
    (function(){
      function send(method, url) {
        try {
          window.webkit.messageHandlers.\(requestLogMessageHandler).postMessage({
            method: String(method || 'GET'),
            url: String(url || '')
          });
        } catch (e) {}
      }
      var origFetch = window.fetch;
      if (origFetch) {
        window.fetch = function(input, init) {
          try {
            var method = (init && init.method) || (input && input.method) || 'GET';
            var url = (typeof input === 'string') ? input : (input && input.url) || '';
            send(method, url);
          } catch (e) {}
          return origFetch.apply(this, arguments);
        };
      }
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        send(method, url);
        return origOpen.apply(this, arguments);
      };
    })();
    """

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
            self.sawPasswordField = false
            self.autoLoginNotified = false
            self.requestLog.removeAll()

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
            config.userContentController.add(self, name: Self.requestLogMessageHandler)
            config.userContentController.addUserScript(WKUserScript(
                source: Self.requestLogScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false,
                in: .page
            ))

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

            // The browser is embedded as a child view controller (rather than presented modally) so
            // compact agent mode can size it to the top 52% of the screen with the app underneath
            // still visible and touchable — a modal presentation always covers the full screen.
            presenter.addChild(vc)
            vc.beginAppearanceTransition(true, animated: false)
            presenter.view.addSubview(vc.view)
            self.updateContainerFrame(for: vc)
            vc.endAppearanceTransition()
            vc.didMove(toParent: presenter)

            self.notifyListeners("opened", data: [
                "initScriptMode": "documentStart",
                "storeMode": isolated ? "isolated" : "default"
            ])
            call.resolve(["ok": true])
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
        guard let mode = call.getString("mode"), mode == "login" || mode == "agent" || mode == "guide" else {
            call.reject("mode must be login, agent or guide")
            return
        }
        let banner = call.getString("banner")
        let origins = call.getArray("origins", String.self)
        let compact = call.getBool("compact", false)
        DispatchQueue.main.async {
            vc.applyMode(mode, banner: banner, origins: origins, compact: compact)
            self.updateContainerFrame(for: vc)
            call.resolve(["ok": true])
        }
    }

    @objc func drainRequests(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let requests = self.requestLog
            self.requestLog.removeAll()
            call.resolve(["requests": requests])
        }
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
        vc.webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.requestLogMessageHandler)
        browserVC = nil
        vc.willMove(toParent: nil)
        vc.beginAppearanceTransition(false, animated: false)
        vc.view.removeFromSuperview()
        vc.endAppearanceTransition()
        vc.removeFromParent()
        if notify {
            self.notifyListeners("closed", data: ["reason": reason])
        }
    }

    // MARK: - Helpers

    // Sizes the browser's view within its superview: the top 52% in compact agent mode (the app
    // underneath stays visible and touchable outside that frame), full screen otherwise. Called
    // after open() and every setMode() so it stays idempotent as banner text/mode refresh.
    private func updateContainerFrame(for vc: ConnectBrowserViewController) {
        guard let superview = vc.view.superview else { return }
        let bounds = superview.bounds
        if vc.mode == "agent" && vc.compact {
            vc.view.frame = CGRect(x: 0, y: 0, width: bounds.width, height: (bounds.height * 0.52).rounded())
            vc.view.autoresizingMask = [.flexibleWidth, .flexibleBottomMargin]
        } else {
            vc.view.frame = bounds
            vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        }
    }

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

    // SIGN-IN DETECTED WITHOUT A TAP (mirrors Android's maybeAutoLoggedIn).
    //
    // The signal is the password field itself: a login page has one, the screen after sign-in does
    // not. Once this browser has seen a password field and a later page has none, sign-in happened.
    // Fires at most once per session, only in login mode, and the Done button still works for the
    // EMR that keeps a password field on every page. No credential is read — only whether such a
    // field EXISTS.
    private func maybeAutoLoggedIn(_ vc: ConnectBrowserViewController) {
        guard !autoLoginNotified, vc.mode == "login" else { return }
        vc.webView.evaluateJavaScript(
            "(function(){try{return document.querySelector('input[type=\"password\"]')?'1':'0'}catch(e){return 'e'}})()"
        ) { [weak self] value, _ in
            guard let self = self else { return }
            guard let flag = value as? String else { return }
            if flag == "1" {
                self.sawPasswordField = true
                return
            }
            if flag == "e" { return } // could not tell: say nothing
            guard self.sawPasswordField, !self.autoLoginNotified else { return }
            self.autoLoginNotified = true
            self.notifyListeners("loggedIn", data: [
                "url": vc.webView.url?.absoluteString ?? "",
                "auto": true
            ])
        }
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

        if isMainFrame && (vc.mode == "agent" || vc.mode == "guide") {
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
        if isMainFrame {
            logRequest(method: navigationAction.request.httpMethod ?? "GET", url: url.absoluteString)
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

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let vc = browserVC, webView === vc.webView else { return }
        maybeAutoLoggedIn(vc)
    }

    fileprivate func logRequest(method: String, url: String) {
        requestLog.append(["method": method, "url": url])
        if requestLog.count > Self.requestLogCap {
            requestLog.removeFirst(requestLog.count - Self.requestLogCap)
        }
    }
}

// MARK: - WKScriptMessageHandler (fetch/XHR request logging for drainRequests)

extension ConnectBrowserPlugin: WKScriptMessageHandler {
    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == Self.requestLogMessageHandler,
              let vc = browserVC, message.webView === vc.webView,
              let body = message.body as? [String: Any],
              let method = body["method"] as? String,
              let url = body["url"] as? String else { return }
        logRequest(method: method, url: url)
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

    func connectBrowserDidTapSkip(_ vc: ConnectBrowserViewController) {
        notifyListeners("guideSkip", data: ["url": vc.webView.url?.absoluteString ?? ""])
    }
}
