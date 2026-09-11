# @stewardmd/capacitor-connect-browser

Native in-app browser for StewardMD Connect Hospital. The doctor signs into their hospital EMR inside
this web view; afterwards the Connect Agent drives the SAME web view (same cookies, same session) to
discover read-only workflows. StewardMD never sees the password: the login page is the hospital's own.

Plugin name: `ConnectBrowser`. iOS = WKWebView, Android = android.webkit.WebView. One instance at a time.

## Methods (all return a Promise)

| Method | Args | Returns | Notes |
|---|---|---|---|
| `open` | `{ url, origins: string[], storeId, title, userAgent?, initScript }` | `{ ok: true }` | Presents a full-screen modal. `initScript` is injected at DOCUMENT START, into EVERY frame, in the PAGE world, on EVERY navigation (iOS `WKUserScript(.atDocumentStart, forMainFrameOnly:false, in:.page)`; Android `WebViewCompat.addDocumentStartJavaScript` when `WebViewFeature.DOCUMENT_START_SCRIPT` is supported, else inject in `onPageStarted` and note `initScriptMode:"late"` in the `opened` event). JS, cookies, DOM storage enabled. Cookie store keyed by `storeId` (iOS 17+: `WKWebsiteDataStore(forIdentifier:)`; older iOS and Android: default store). `userAgent` sets `customUserAgent` / `settings.userAgentString` when given. Starts in mode `login`. |
| `navigate` | `{ url }` | `{ ok }` | Rejects `origin-not-allowed` unless the URL's origin is in `origins`. |
| `evaluate` | `{ expression }` | `{ result: string \| null }` | Main frame, page world. The expression must evaluate to a string, number, boolean, null, undefined, or a Promise of one (e.g. `fetch(...).then(...)`); callers JSON.stringify objects themselves. **Promises are awaited natively before resolving** — iOS via `WKWebView.callAsyncJavaScript`, Android via an async wrapper that posts its settled result back over a WebMessageListener/JavaScript-interface bridge (30s timeout -> reject). A thrown error (or a rejected promise) rejects with the message. |
| `currentUrl` | none | `{ url, title }` | |
| `setMode` | `{ mode: "login" \| "agent" \| "guide", banner?, origins? }` | `{ ok }` | `login`: web view is interactive, header shows the hospital host, a subtitle "Sign in yourself. StewardMD never sees your password." and a **Done, I'm signed in** button (emits `loggedIn`). `agent`: a full-width banner (default text "StewardMD is reading {host} on your behalf. Tap Stop to end.") with a **Stop** button (emits `stopped`); a transparent overlay swallows the doctor's touches so they cannot interfere; main-frame navigations to origins outside `origins` are BLOCKED natively and emitted as `blocked`. `guide`: the agent asks the doctor to show it something: the banner carries the question (`banner`), a **Done** button (emits `loggedIn`), NO touch overlay, origins enforced as in `agent`. `origins` replaces the allowlist when given. |
| `drainRequests` | none | `{ requests: [{ method, url, ts, mainFrame }] }` | Android only, from `shouldInterceptRequest` (every request the engine makes, no bodies). iOS returns `{ requests: [] }`. Cleared on read; capped at 500. |
| `close` | none | `{ ok }` | Dismisses; emits `closed { reason: "closed" }`. |

## Events (`addListener`)

| Event | Payload | When |
|---|---|---|
| `opened` | `{ initScriptMode: "documentStart" \| "late", storeMode: "isolated" \| "default" }` | after `open` presents |
| `navigated` | `{ url, mainFrame: boolean }` | every committed main-frame navigation (and Android: sub-frame when known) |
| `blocked` | `{ url, reason: "origin" }` | agent mode only |
| `loggedIn` | `{ url }` | doctor tapped Done |
| `stopped` | `{ url }` | doctor tapped Stop in agent mode |
| `closed` | `{ reason: "cancel" \| "closed" }` | modal dismissed |

## Deterministic native policy

- In `login` mode any https origin may load (hospital SSO redirects, e.g. ghis.gitam.edu -> gimsrlogin.gitam.edu). Every main-frame origin is reported via `navigated`; the app decides what to allowlist.
- In `agent` and `guide` mode the allowlist is enforced natively on main-frame navigations. This is policy outside the AI: no JavaScript, and no planner, can widen it.
- http (non-TLS) URLs are refused by `open` and `navigate`.
- Nothing is persisted by the plugin except the web view's own cookie/storage jar under `storeId`.
- The plugin never reads, logs or exposes cookies, form values or headers.

## Not native (implemented in JS via `evaluate`)

Accessibility-style snapshot with `[ref=..]` markers, `click(ref)`, `wait(ms)`, the request observer. See `connect-agent/phone/`.
