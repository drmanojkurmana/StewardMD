# ADR: Where the Connect Agent's browser runs (phone vs remote), 2026-09-11

**Status:** proposed, awaiting owner decision. No code written for this ADR.
**Context module:** `vault/modules/Connect Agent.md`. Live proof this week: Camofox on a Mac, real GHIS login by the doctor, agent reached AWAITING_APPROVAL.

## 0. The fact that decides most of this

Read `connect-agent/discovery.mjs` and `connect-agent/camofox-client.mjs` before believing any vendor claim below.

The discovery engine does NOT use Camofox's network layer. It is:

1. `SMD_CONNECT_OBSERVER`, a plain JavaScript function serialised with `String()` and evaluated in the page's own realm (`mw:` prefix). It monkey-patches `window.fetch`, `XMLHttpRequest.open/send`, `navigator.sendBeacon`, `HTMLFormElement.submit` and the capture-phase `submit` event. It records method, path, origin, query key names, status, content-type and a key-only JSON shape of the response. It never records values, cookies or headers beyond content-type.
2. `createCollector(client, ...)`, which needs exactly six transport primitives: `createTab/navigate`, `evaluate`, `wait`, `snapshot` (accessibility tree with `[ref=..]` markers), `click(ref)`, `closeTab`.
3. `exploreReadWorkflows`, a bounded clicker over snapshot refs.

Consequence: any real browser that lets us (a) run our JS in the page's main world, ideally at document start, (b) read `location.href` and a DOM/accessibility snapshot, and (c) click an element, runs the SAME engine unchanged. Both phone WebViews do. Camofox's own comment in `discovery.mjs` admits its REST API has no init-script primitive, so requests fired during a page's own load are "a guaranteed miss". WKWebView and Android WebView both have an init-script primitive. On that axis the phone is strictly better than today's runner.

Second fact: the existing GHIS integration (`GHIS-DEPLOY.md`, `functions/api/ghis/`) stores the doctor's GHIS password AES-encrypted in KV and re-logs-in server-side. That is the liability the Connect Agent was built to remove. A phone-side browser removes it completely: the Worker never holds a hospital password or session cookie.

## 1. Candidate approaches (letters A to R collapsed into real architectures)

| # | Architecture | Covers letters |
|---|---|---|
| P1 | In-app real WebView: WKWebView (iOS) / Android WebView, our JS injected at document start, Capacitor plugin bridge, Worker as control plane | A B C D E F J L P |
| P2 | P1 plus Android-only native network hooks: `shouldInterceptRequest`, WebView DevTools socket from own process (CDP), local proxy via `ProxyController` | D K L M O |
| P3 | Embedded Firefox engine on Android (GeckoView) with a bundled WebExtension (`webRequest`) | H I N |
| P4 | System browser: SFSafariViewController / Chrome Custom Tabs / ASWebAuthenticationSession | G |
| P5 | Browser extension in the doctor's own Safari (iOS) or Firefox (Android), data back via App Group / upload | N |
| P6 | VPN (`VpnService` / `NEPacketTunnelProvider`) with on-device TLS MITM | K O |
| P7 | Browser engine in WebAssembly, or Node on the phone (`nodejs-mobile`) driving a browser | J Q |
| R1 | Remote Camofox runner (today), viewport streamed to the phone for login | current |
| R2 | Hospital-local runner (Mac mini / PC on the hospital LAN) | Option 3 |

Camofox/Camoufox itself on a phone: impossible on iPhone (App Store rule 2.5.6, WebKit only outside the EU, and even the EU exception is for dedicated browser apps). On Android there is no Camoufox build; GeckoView (P3) is the same engine family and the honest equivalent.

## 2. The 24 questions, answered per architecture

Y = yes, P = partial, N = no. Notes are in simple language.

| Q | P1 in-app WebView | P2 + Android native hooks | P3 GeckoView + extension | P4 system browser | P5 own-browser extension | P6 VPN MITM | R1 remote Camofox | R2 hospital-local runner |
|---|---|---|---|---|---|---|---|---|
| 1 Android | Y | Y | Y | Y | Y (Firefox only) | Y | Y | Y |
| 2 iPhone | Y | N (iOS has none of these) | N (WebKit only) | Y | Y (Safari ext) | P (MITM CA trust is brutal) | Y | Y |
| 3 Real EMR rendered | Y, real Safari / Chromium engine | Y | Y, real Firefox engine | Y | Y | Y | Y | Y |
| 4 Doctor logs in normally | Y, in the app | Y | Y | Y | Y | Y | P, through a streamed viewport | P, same |
| 5 Authenticated session stays on device | Y, that WebView IS the session | Y | Y | Y but we cannot read it | Y but only the extension sees it | Y | N, lives on our server | N, on hospital box |
| 6 Inspect DOM | Y, evaluateJavaScript / evaluateJavascript | Y | Y, content script | N | Y, content script | N (bytes only) | Y | Y |
| 7 Inspect fetch/XHR | Y, our existing observer, installed at document start | Y plus every request at native layer | Y, webRequest incl. bodies | N | P, Safari webRequest is observe-only, no bodies | Y, all bytes | Y, but misses load-time requests (no init script) | same as R1 |
| 8 Discover hidden endpoints like GHIS | Y, same chain Page -> JS -> XHR -> endpoint | Y | Y | N | P | Y | Y | Y |
| 9 Follow links/buttons/forms automatically | Y, click(ref) via injected JS | Y | Y | N | P, extension can, but fights the user's browser | N | Y | Y |
| 10 Survive navigation | Y, init script re-runs on every document; state held natively | Y | Y | n/a | Y | Y | P, observer reinstalled after the fact | same |
| 11 Cookies / session state | Y, WKWebsiteDataStore / CookieManager, isolated store per hospital on iOS 17+ and Android ProfileStore | Y | Y | N (unreadable) | P | Y | Y (on server) | Y |
| 12 HTTPS | Y | Y | Y | Y | Y | Y only with MITM CA | Y | Y |
| 13 Redirect to another domain (gimsrlogin -> ghis) | Y, inject on all frames/origins; allowlist decides | Y | Y | Y | P (per-site permission prompts) | Y | Y | Y |
| 14 MFA / OTP | Y, doctor does it on the same phone the OTP arrives on | Y | Y | Y | Y | Y | P, typed into a stream | P |
| 15 CAPTCHA without bypass | Y, doctor solves it in the real engine. Risk: Cloudflare managed challenge inside a WebView sometimes loops; set a Mobile Safari-like UA and fall back to R1 | Y | Y | Y | Y | Y | Y (Camoufox passes) | Y |
| 16 Old hospital EMRs | Y for any HTML site. Desktop-only layouts: force desktop UA. ActiveX/Silverlight/Java applets: no browser anywhere | Y | Y | Y | Y | Y | Y | Y |
| 17 Without storing password | Y | Y | Y | Y | Y | Y | Y | Y |
| 18 Without any external server | P: browser and session yes; planner LLM, registry and approval live in the Worker | P | P | n/a | P | P | N | N |
| 19 OS permissions | None beyond Internet | None (WebView debugging flag is app-internal) | None | None | Manual: enable extension + per-site access in Settings | VPN consent dialog, full-device traffic | None on phone | None |
| 20 App Store risk | Low. Injected user scripts in own WKWebView are standard (SSO, InAppBrowser). Must stay WebKit | n/a | Rejected outside EU | Low | Medium: separate extension target, review scrutiny | High: MITM of medical traffic | Low | Low |
| 21 Play Store risk | Low | Low (debug socket is same-uid only; enable only during a session) | Low, +60-90 MB per ABI | Low | Low | High: VPN declaration, "intercepts traffic" | Low | Low |
| 22 Security / privacy | Best: hospital cookies never leave the doctor's device. PHI in responses must be shape-only before upload (observer already does this). Injected JS must never be attacker-controlled | Same; CDP socket must be closed after session | Same; extension bundled, not downloadable | Nothing to inspect | Data leaves via App Group, extension update path is a second attack surface | Worst: a CA trusted for all traffic | Hospital session + PHI sit on our server; server becomes a target | Hospital owns the box, we own the code |
| 23 Performance | One WebView, ~100 MB RAM, a few minutes foreground. iOS suspends the app in background, so discovery runs with the screen on | Same, Android foreground service can keep going | Heavier binary, otherwise same | n/a | Runs in the browser, app must be reopened | CPU for TLS | Server cost, viewport stream bandwidth | Free compute |
| 24 Biggest blocker | Cloudflare challenge inside WebView on some sites; no background execution on iOS | iOS gets none of it | iOS gets none of it, size | Cannot inspect anything: dead | UX: Settings toggles, cannot drive the browser reliably | CA trust + policy: dead | Viewport streaming for login is a product in itself; cookies on our server; intranet EMRs unreachable | Needs a device and IT sign-off inside every hospital |

Rows for P7 (WASM / Node on phone): a full browser engine in WebAssembly does not exist in a usable form, and `nodejs-mobile` only moves our runner process onto the phone without giving it a browser. Neither answers a single question that P1 does not. Dropped.

## 3. Direct answer: "Can we build a mini browser inside StewardMD where the doctor logs into GHIS and the agent inspects the page AND the network calls from the same phone?"

**Yes.** On both platforms. Exactly how:

1. **A Capacitor plugin, `ConnectBrowser`** (Swift ~250 lines, Kotlin ~250 lines). `open(url, hospitalId)` presents a full-screen native web view under our own header (hospital name, "you are signing in yourself", Cancel). It is a second web view, not the app shell's. On iOS: `WKWebView` with `WKWebsiteDataStore(forIdentifier: hospitalId)` (iOS 17+; default store below that). On Android: `WebView` with a per-hospital `Profile` where available.
2. **The observer becomes an init script.** iOS: `WKUserScript(source: OBSERVER_SOURCE + config, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: .page)`. Android: `WebViewCompat.addDocumentStartJavaScript(source, allowedOriginRules)`. Same `SMD_CONNECT_OBSERVER` function, byte for byte. It now catches the requests a page fires while loading, which Camofox cannot.
3. **The six primitives** map to: `navigate` = `load(URLRequest)` / `loadUrl`; `evaluate` = `evaluateJavaScript(in: nil, in: .page)` / `evaluateJavascript`; `wait` = a timer; `snapshot` = a ~80-line JS walker that emits `role "name" [ref=n]` lines and keeps the element list in the page (a JS port of what Camofox's `/snapshot` returns); `click(ref)` = `evaluate("__smd_refs[n].click()")`; `close` = dismiss.
4. **The collector runs where it runs today**, unchanged: `createCollector({ client })` takes any object with those six methods. The client is a thin JS object in the app that calls the plugin. The phone therefore becomes a runner without editing `discovery.mjs`.
5. **The doctor watches.** The web view stays visible while the agent explores. A banner says "StewardMD is reading GHIS on your behalf. Tap Stop at any time." Handoff is not a copy of cookies, it is a state flip; there is nothing to hand over because the session never moved.
6. **The Worker stays the control plane**: `POST /sessions` (already), a planner route that receives a redacted snapshot + shape-only events and returns the next `ref` to click (replacing today's `candidateRefs` heuristic with an LLM), and `POST /sessions/:id/discovery` receiving the final spec. Compile and validate run in the Worker (`compile.mjs`, `validate.mjs` are pure functions), never trusted from the phone, so a tampered app cannot forge validation.
7. **Runtime after approval also runs on the phone**: the approved manifest is interpreted inside a hidden web view on the hospital origin (cookies attach automatically, same-origin fetch), or natively with cookies read from `WKHTTPCookieStore` / `CookieManager`. The Worker keeps the manifest and the ledger, never the session. This retires the KV-stored GHIS password.

**What we CAN inspect on both platforms:** DOM, accessibility tree, `location`, every `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` (patchable the same way), form submissions (field names captured at `submit` time), response status, content-type, JSON response shape, resource URLs of scripts/images via `PerformanceObserver`. That is the entire chain that produced the GHIS adapter.

**What we CANNOT inspect on iPhone:** requests made by Service Workers or Web Workers (rare in legacy EMRs), the raw bytes of a full-page form POST after it leaves the page (we get the field names before it leaves), `Set-Cookie` and other forbidden headers (we do not want them), and anything a page does after the app is backgrounded.

**What Android can do that iPhone cannot:**
- `WebViewClient.shouldInterceptRequest`: sees every request at the native layer (navigations, workers, subresources, headers) and can serve the response itself. No POST bodies.
- `WebView.setWebContentsDebuggingEnabled(true)` exposes a Chrome DevTools socket (`webview_devtools_remote_<pid>`) that our own process can connect to. That is real CDP on the phone: `Network.getResponseBody`, `DOM`, `Runtime`. Access is restricted to shell/root/same uid. Verify in a spike before relying on it.
- `ProxyController.setProxyOverride` points only our WebView at a localhost proxy, no VPN, no consent dialog.
- GeckoView with a bundled WebExtension: Firefox engine with `webRequest` including request bodies and `filterResponseData`. The closest thing to Camoufox that can ship in an app.
- A foreground service keeps discovery running with the screen off.
- `addDocumentStartJavaScript` is origin-scoped by the OS, not by our code.

iPhone has one thing Android lacks: iOS 17 `WKWebsiteDataStore.proxyConfigurations` plus the `didReceive challenge` delegate could route the web view through an on-device MITM proxy. Expensive, fragile, and unnecessary once the init-script observer exists. Not recommended.

## 4. Comparison with the current Camofox architecture

| | Camofox on Mac / server (R1) | In-app WebView (P1) |
|---|---|---|
| Login UX | Needs a live viewport streamed into the app so the doctor can type into a remote Firefox. Not built. Would be the largest single piece of work in the whole feature | Native web view. Done in one screen |
| Load-time requests | Missed (no init script, per our own comment) | Caught |
| Anti-bot | Camoufox fingerprint patches, proven on GHIS | Genuine mobile engine, real touch, real user. Risk only on sites whose managed challenge misbehaves in WebViews |
| Hospital session location | Our server | Doctor's phone |
| Intranet-only EMRs | Unreachable | Reachable on hospital Wi-Fi |
| Compute | Ours, per session, always on | Doctor's phone, minutes |
| Server we own | Must add one (VPS), contradicts "no server" | None |
| Background runtime sync | Possible | Needs the phone awake (iOS) |
| Exploration depth | Unlimited wall time | Bounded by doctor patience and screen-on; aim for under 3 minutes per hospital, reused by every later doctor |

## 5. Ranking

1. **BEST: P1, in-app real WebView on both platforms, Worker as control plane, existing Camofox runner kept only as a fallback.** It reuses the discovery engine unchanged, removes the server we do not have, removes hospital cookies and passwords from our infrastructure, reaches intranet EMRs, and gives the doctor a login screen that is just a web page.
2. **SECOND: P2, P1 plus Android native hooks, added only when a specific hospital defeats the JS observer** (worker-driven requests, non-JSON responses needing bodies, bot challenge). Android-only upgrade, no iOS equivalent.
3. **THIRD: R1, remote Camofox with a streamed viewport.** Keep the runner we have for development on a Mac and as the fallback for desktop-only EMRs or WebView challenge loops. Do not build the viewport-streaming login product unless P1 fails on a real hospital.

R2 (hospital-local runner) is not ranked: it solves intranet reach, which P1 already solves via the doctor's phone on hospital Wi-Fi, and costs an IT conversation per hospital. P4, P5, P6, P7 are eliminated for the reasons in the table.

## 6. Options 1 to 4

- **Option 1, 100% phone:** not viable as stated. The browser can be 100% phone, but "understand what the endpoint does" needs an LLM, and "other doctors reuse the adapter" needs a shared registry, approval and ledger. Those are the Worker's job and we already have them.
- **Option 2, phone + Workers + small remote browser service:** what we have on the Mac, plus a VPS, plus the missing viewport-streaming login. Puts hospital sessions on our server. Only as a fallback.
- **Option 3, phone + Workers + hospital-local runner:** right idea for reach, wrong cost: hardware and IT sign-off in every hospital before a single doctor can try it.
- **Option 4, hybrid, local on the phone when possible, remote when necessary:** this is the recommendation, with "necessary" defined narrowly: desktop-only EMR, or a challenge page that loops inside the WebView. The fallback already exists, so the hybrid costs nothing extra today.

**Decision proposed: Option 4, phone-first.** It keeps the product simple for doctors (one app, one screen, they type their own password on their own phone, they watch the agent work) and it is the only option that needs no new infrastructure.

## 7. What to build next, in order

1. **Spike, iPhone first (it is the constrained platform):** `ConnectBrowser` Capacitor plugin with `open`, `evaluate`, `wait`, `snapshot`, `click`, `close`, and the observer as a document-start user script in the page world. Acceptance: on a real iPhone, doctor signs into GHIS in the plugin's web view, taps "Explore", and the drained events include XHRs from the Doctor module, which the Mac run never reached. One day of work.
2. **Phone-as-runner:** a `client` object over the plugin passed to `createCollector`; a Worker route accepting the spec and running compile + validate server-side. Reuses `POST /sessions`, consent, session state machine, and the approval flow untouched.
3. **Android plugin**, same interface, `addDocumentStartJavaScript`. Keep `shouldInterceptRequest` and the DevTools socket out until a hospital needs them.
4. **LLM planner in the Worker** replacing `candidateRefs`: input is the redacted snapshot and shape-only events; output is the next ref and a stop decision. Platform-independent, needed regardless of where the browser runs.
5. **Runtime on phone:** interpret the approved manifest in a hidden web view on the hospital origin; then retire the KV-stored GHIS password path.
6. **Fallback wiring:** when the WebView reports a challenge loop or a desktop-only layout, offer "Continue on a StewardMD browser" which is the existing Camofox runner. Build the viewport stream only if a real hospital forces it.

## 8. Things this ADR does not claim

- That Cloudflare's managed challenge renders correctly inside WKWebView on gimsrlogin.gitam.edu. The Mac run used Camoufox; the phone spike (step 1) is where this gets proven or disproven.
- That the Android DevTools socket is reachable from the app's own process on current WebView builds. Documented Chromium behaviour, not verified by us.
- That GHIS's Doctor module uses XHR/fetch rather than full-page ASP.NET postbacks. If it is postbacks, the gap is in the compiler (HTML responses, not JSON shapes), and that gap is identical for Camofox and the phone.
- Institutional authorisation from GITAM to run an agent against GHIS. Required before any doctor-facing rollout, independent of architecture.
