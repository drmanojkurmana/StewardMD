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
    private var loginOrigin = ""   // origin the browser was opened at; landing elsewhere = signed in
    private var loginPoll: Timer?  // sign-in is not always a navigation; see startLoginPoll()

    /* LAW III, ZERO WEBSITE HIJACKING. `hidden: true` is what ghis-ward.js asks for on every background
     * read, Android has honoured it since the first build, and iOS silently DROPPED it: the flag was
     * never read, so a patient read threw the hospital portal over the whole phone with an orange
     * "Reading ... for this patient" banner while the doctor was trying to work (seen on an iPhone 15
     * Pro, 2026-09-15). It also starved the app's own WebView behind it, which is why those reads
     * crawled. Hidden here means the same 2pt strip agent reads already used: the page keeps its
     * cookies, its timers and its network, and the doctor keeps their screen. */
    private var hiddenRead = false
    private var placementConstraints: [NSLayoutConstraint] = []

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
        let hidden = call.getBool("hidden", false)

        DispatchQueue.main.async {
            self.teardownExistingBrowser(reason: "closed", notify: false)
            self.hiddenRead = hidden
            self.sawPasswordField = false
            self.autoLoginNotified = false
            self.loginOrigin = Self.origin(of: url)
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
            #if DEBUG
            // Debug builds only: let ios_webkit_debug_proxy see the hospital page, so a stall in the
            // in-app browser can be read instead of guessed at (never in release: the doctor's EMR
            // session must not be inspectable from a cable).
            if #available(iOS 16.4, *) { webView.isInspectable = true }
            #endif

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

            if vc.mode == "login" { self.startLoginPoll() }

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
        // A mode change may ask to hide the browser, or to bring it back; only login mode is ever shown.
        let hidden = call.getBool("hidden", false) && mode != "login"
        DispatchQueue.main.async {
            self.hiddenRead = hidden
            vc.applyMode(mode, banner: banner, origins: origins, compact: compact)
            self.updateContainerFrame(for: vc)
            // Entering login mode arms the watcher; leaving it (the agent takes over) disarms it.
            if mode == "login" && !self.autoLoginNotified { self.startLoginPoll() } else if mode != "login" { self.stopLoginPoll() }
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
        // A 30s timeout, exactly like the Android plugin. WKWebView's callAsyncJavaScript is known to
        // never call its completion when the page navigates while the call is pending (the GIMSR
        // sign-in redirects through SSO to the data host while the engine is polling the page): the
        // first live iPhone run hung forever on "Starting a new discovery" (2026-09-14). A rejection
        // lets the engine's own catch/retry carry on; a hang has no way out.
        let settled = NSLock()
        var done = false
        func finish(_ block: () -> Void) {
            settled.lock(); defer { settled.unlock() }
            if done { return }
            done = true
            block()
        }
        DispatchQueue.main.async {
            vc.webView.callAsyncJavaScript(
                "return (\(expression));",
                arguments: [:],
                in: nil,
                in: .page
            ) { result in
                finish {
                    switch result {
                    case .success(let value):
                        call.resolve(["result": Self.stringify(value)])
                    case .failure(let error):
                        call.reject(error.localizedDescription)
                    }
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
                finish { call.reject("evaluate timed out") }
            }
        }
    }

    // MARK: - Teardown

    private func teardownExistingBrowser(reason: String, notify: Bool = true) {
        stopLoginPoll()
        hiddenRead = false
        NSLayoutConstraint.deactivate(placementConstraints)
        placementConstraints = []
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
        _ = superview.bounds
        if hiddenRead {
            /* HIDDEN THE WAY ANDROID DOES IT: full size, transparent, untouchable.
             *
             * The first try shrank the view to a 2pt strip, and a screenshot of the phone showed the
             * hospital portal still filling the screen with its orange banner (2026-09-15): a frame
             * set here does not survive the parent's next layout pass, so "out of sight" was a lie
             * every time the layout ran. Alpha and hit-testing are not laid out, so they hold. Full
             * size also keeps WebKit treating the page as visible, so the read runs at full speed
             * instead of being throttled to a crawl the way a 2pt or zero-sized view would be.
             * Not quite 0: a view at alpha 0 is treated as invisible and the page stops. */
            pin(vc, in: superview, bottomStrip: 0)
            vc.view.alpha = 0.01
            vc.view.isUserInteractionEnabled = false
        } else if vc.mode == "agent" && vc.compact {
            vc.view.alpha = 1
            vc.view.isUserInteractionEnabled = true
            /* A FRAME SET HERE DOES NOT SURVIVE THE PARENT'S NEXT LAYOUT PASS. That is why every
             * attempt to leave part of the app uncovered silently failed, and it is what stalled a
             * live GHIS crawl at 86% on the owner's phone (2026-09-15): the hospital page covered the
             * app's own WebView to the last pixel, iOS stopped scheduling it, and the engine that
             * drives the crawl lives in it. Constraints are not undone by layout, so they hold. */
            pin(vc, in: superview, topFraction: 0.52)
        } else if vc.mode == "agent" {
            vc.view.alpha = 1
            vc.view.isUserInteractionEnabled = true
            // AGENT READS RUN OUT OF SIGHT: a thin strip keeps the hospital page alive (cookies,
            // tokens, fetch) with the app view visible and therefore still running.
            pin(vc, in: superview, bottomStrip: 2)
        } else {
            vc.view.alpha = 1
            vc.view.isUserInteractionEnabled = true
            // Never cover the app view completely: once it was fully occluded the app WKWebView (the
            // engine) stopped running, so the doctor's sign-in was never noticed in login mode
            // (iPhone 15 Pro, 2026-09-15, seen on screen). A strip left uncovered keeps it alive.
            pin(vc, in: superview, bottomStrip: 2)
        }
    }

    /* PIN, DO NOT POSITION. Constraints survive the parent's layout; a frame does not. `topFraction`
     * gives the browser the top share of the screen; `bottomStrip` leaves the browser everything but
     * that many points at the bottom, or, when it is the whole height minus the strip, everything but
     * a sliver. Either way some of the app stays on screen, which is what keeps its WebView - and the
     * engine inside it - scheduled by iOS. */
    private func pin(_ vc: ConnectBrowserViewController, in superview: UIView, topFraction: CGFloat? = nil, bottomStrip: CGFloat? = nil) {
        vc.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.deactivate(placementConstraints)
        var next: [NSLayoutConstraint] = [
            vc.view.leadingAnchor.constraint(equalTo: superview.leadingAnchor),
            vc.view.trailingAnchor.constraint(equalTo: superview.trailingAnchor),
            vc.view.topAnchor.constraint(equalTo: superview.topAnchor),
        ]
        if let fraction = topFraction {
            next.append(vc.view.heightAnchor.constraint(equalTo: superview.heightAnchor, multiplier: fraction))
        } else if let strip = bottomStrip {
            next.append(vc.view.bottomAnchor.constraint(equalTo: superview.bottomAnchor, constant: -strip))
        }
        NSLayoutConstraint.activate(next)
        placementConstraints = next
        superview.layoutIfNeeded()
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
    /* A SIGN-IN IS NOT ALWAYS A NAVIGATION. maybeAutoLoggedIn used to run only on didFinish, which is
     * one page load too few: GHIS signs the doctor in on the SAME origin and swaps the body in place,
     * so no later didFinish ever arrives, sawPasswordField never gets its second look, and the sheet
     * sat on "Signing in..." over a signed-in patient list until the doctor tapped Done (iPhone 15 Pro,
     * 2026-09-15 - the very friction auto-login was meant to remove). The app's own WebView cannot
     * cover this from JS: it is behind a full-screen browser and barely scheduled. So the browser
     * watches itself, every second and a half, until it has an answer. Stops at the first "loggedIn",
     * when the mode leaves login, and with the browser. */
    private func startLoginPoll() {
        loginPoll?.invalidate()
        loginPoll = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            guard let vc = self.browserVC, vc.mode == "login", !self.autoLoginNotified else {
                timer.invalidate()
                if self.loginPoll === timer { self.loginPoll = nil }
                return
            }
            self.maybeAutoLoggedIn(vc)
        }
    }

    private func stopLoginPoll() {
        loginPoll?.invalidate()
        loginPoll = nil
    }

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
            /* COOKIE AUTO-LOGIN, like Android's maybeAutoLoggedIn: a stored session skips the password
             * form entirely, so "saw a password field" never happens. Landing on an allowed https origin
             * other than the one the browser was opened at (GIMSR sign-in host -> GHIS data host), with no
             * password field on it, is a sign-in too. Seen on an iPhone 15 Pro: the reuse path sat on
             * "Signing in..." over a signed-in ward list until the doctor tapped Done (2026-09-15). */
            let landed = Self.origin(of: vc.webView.url ?? URL(string: "about:blank")!)
            let movedOff = !self.loginOrigin.isEmpty && landed != self.loginOrigin && vc.allowedOrigins.contains(landed)
            guard (self.sawPasswordField || movedOff), !self.autoLoginNotified else { return }
            self.autoLoginNotified = true
            self.stopLoginPoll()
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
