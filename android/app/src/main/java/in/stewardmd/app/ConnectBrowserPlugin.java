package in.stewardmd.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * ConnectBrowser (Android) — native in-app browser for StewardMD Connect Hospital.
 *
 * The doctor signs into their hospital EMR inside a full-screen WebView; afterwards the Connect
 * Agent drives the SAME WebView (same cookies, same session) to discover read-only workflows.
 * StewardMD never sees the password: the login page is the hospital's own. See
 * local-plugins/capacitor-connect-browser/README.md for the full contract.
 *
 * Security: never logs cookies/headers/form values, never exposes cookies to JS beyond what the
 * page itself sees, and refuses non-https URLs in open()/navigate(). In agent mode, main-frame
 * navigation outside the allowlisted origins is cancelled natively — this is policy the JS layer
 * cannot widen.
 */
@CapacitorPlugin(name = "ConnectBrowser")
public class ConnectBrowserPlugin extends Plugin {

    // One instance at a time (per README).
    private Dialog dialog;
    private WebView webView;
    private TextView subtitleLabel;
    private TextView bannerLabel;
    private Button doneButton;
    private View bannerView;
    private View touchBlockerView;

    private String mode = "login";
    private Set<String> allowedOrigins = Collections.emptySet();
    private String hostTitle = "";
    private String pendingLateInitScript; // non-null only when DOCUMENT_START_SCRIPT is unsupported

    // Capped request log from shouldInterceptRequest, drained by drainRequests().
    private final List<JSObject> requestLog = new ArrayList<>();
    private static final int REQUEST_LOG_CAP = 500;

    // evaluate() awaits a promise: WebView.evaluateJavascript() does not await, so the expression
    // is wrapped in an async IIFE that posts its settled result back over this bridge, keyed by id.
    // 30s timeout -> reject, matching the contract.
    private static final String BRIDGE_NAME = "__smdConnectBridge";
    private static final long EVALUATE_TIMEOUT_MS = 30000;
    private final AtomicInteger evalIdCounter = new AtomicInteger(0);
    private final java.util.Map<Integer, PluginCall> pendingEvals = new ConcurrentHashMap<>();
    private final java.util.Map<Integer, Runnable> pendingEvalTimeouts = new ConcurrentHashMap<>();
    private final Handler evalHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void open(final PluginCall call) {
        final String urlStr = call.getString("url");
        final JSArray originsArr = call.getArray("origins");
        final String storeId = call.getString("storeId");
        final String initScript = call.getString("initScript");
        final String userAgent = call.getString("userAgent");
        final String title = call.getString("title");

        if (urlStr == null || !isHttps(urlStr)) {
            call.reject("https url required");
            return;
        }
        if (originsArr == null) {
            call.reject("origins required");
            return;
        }
        if (storeId == null || storeId.isEmpty()) {
            call.reject("storeId required");
            return;
        }
        if (initScript == null) {
            call.reject("initScript required");
            return;
        }
        final List<String> origins = new ArrayList<>();
        try {
            for (int i = 0; i < originsArr.length(); i++) origins.add(originsArr.getString(i));
        } catch (JSONException e) {
            call.reject("bad origins");
            return;
        }

        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                teardown(false);
                allowedOrigins = new HashSet<>(origins);
                mode = "login";
                hostTitle = title != null ? title : hostOf(urlStr);
                synchronized (requestLog) {
                    requestLog.clear();
                }

                webView = new WebView(activity);
                WebSettings settings = webView.getSettings();
                settings.setJavaScriptEnabled(true);
                settings.setDomStorageEnabled(true);
                if (userAgent != null && !userAgent.isEmpty()) {
                    settings.setUserAgentString(userAgent);
                } else {
                    // Strip the "; wv" WebView marker so hospital SSO pages that gate on browser UA don't reject it.
                    settings.setUserAgentString(settings.getUserAgentString().replace("; wv", ""));
                }
                CookieManager.getInstance().setAcceptCookie(true);
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

                String initMode;
                if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    WebViewCompat.addDocumentStartJavaScript(webView, initScript, Collections.singleton("*"));
                    pendingLateInitScript = null;
                    initMode = "documentStart";
                } else {
                    pendingLateInitScript = initScript;
                    initMode = "late";
                }

                webView.setWebViewClient(buildWebViewClient());
                registerEvalBridge(webView);

                buildDialog(activity);
                webView.loadUrl(urlStr);
                dialog.show();

                JSObject opened = new JSObject();
                opened.put("initScriptMode", initMode);
                opened.put("storeMode", "default"); // Android has no per-storeId isolated data store
                notifyListeners("opened", opened);

                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void navigate(final PluginCall call) {
        if (webView == null) {
            call.reject("not-open");
            return;
        }
        final String urlStr = call.getString("url");
        if (urlStr == null || !isHttps(urlStr)) {
            call.reject("https url required");
            return;
        }
        if (!allowedOrigins.contains(originOf(Uri.parse(urlStr)))) {
            call.reject("origin-not-allowed");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.loadUrl(urlStr);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void evaluate(final PluginCall call) {
        if (webView == null) {
            call.reject("not-open");
            return;
        }
        final String expr = call.getString("expression");
        if (expr == null) {
            call.reject("expression required");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        // evaluateJavascript() does not await a returned promise (the phone engine's live probes
        // are `fetch(...).then(...)` expressions), so the expression runs inside an async IIFE
        // that awaits it and posts the settled result back over the __smdConnectBridge listener,
        // matched to this call by id. A 30s timeout rejects if the bridge never replies (e.g. a
        // syntax error in `expr`, which fails to parse the wrapper before the catch can run).
        final int id = evalIdCounter.incrementAndGet();
        pendingEvals.put(id, call);
        final Runnable timeoutTask = new Runnable() {
            @Override
            public void run() {
                PluginCall pending = pendingEvals.remove(id);
                pendingEvalTimeouts.remove(id);
                if (pending != null) pending.reject("evaluate timed out");
            }
        };
        pendingEvalTimeouts.put(id, timeoutTask);
        evalHandler.postDelayed(timeoutTask, EVALUATE_TIMEOUT_MS);

        final String script = "(function(){(async function(){try{"
            + "var __r=await (" + expr + ");"
            + "window." + BRIDGE_NAME + ".postMessage(JSON.stringify({id:" + id + ",ok:true,r:(__r===undefined?null:__r)}));"
            + "}catch(__e){window." + BRIDGE_NAME + ".postMessage(JSON.stringify({id:" + id + ",ok:false,e:String((__e&&__e.message)||__e)}));}"
            + "})();})();";
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    // WebMessageListener (preferred) or addJavascriptInterface (fallback) — both expose
    // `window.<BRIDGE_NAME>.postMessage(string)` to the page, which evaluate()'s wrapper calls.
    private void registerEvalBridge(WebView view) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            try {
                WebViewCompat.addWebMessageListener(view, BRIDGE_NAME, Collections.singleton("*"),
                    new WebViewCompat.WebMessageListener() {
                        @Override
                        public void onPostMessage(WebView v, WebMessageCompat message, Uri sourceOrigin,
                                                   boolean isMainFrame, JavaScriptReplyProxy replyProxy) {
                            onEvalBridgeMessage(message.getData());
                        }
                    });
                return;
            } catch (Exception ignored) {
                // fall through to the addJavascriptInterface fallback
            }
        }
        view.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void postMessage(String json) {
                onEvalBridgeMessage(json);
            }
        }, BRIDGE_NAME);
    }

    // Called from a JS/binder thread (both bridge modes) — never the UI thread.
    private void onEvalBridgeMessage(String json) {
        if (json == null) return;
        final int id;
        final boolean ok;
        final String result;
        final String error;
        try {
            JSONObject obj = new JSONObject(json);
            id = obj.getInt("id");
            ok = obj.optBoolean("ok", false);
            result = (ok && !obj.isNull("r")) ? String.valueOf(obj.get("r")) : null;
            error = ok ? null : obj.optString("e", "evaluate failed");
        } catch (JSONException e) {
            return;
        }
        evalHandler.post(new Runnable() {
            @Override
            public void run() {
                Runnable timeout = pendingEvalTimeouts.remove(id);
                if (timeout != null) evalHandler.removeCallbacks(timeout);
                PluginCall pending = pendingEvals.remove(id);
                if (pending == null) return; // already timed out, or a stale/duplicate reply
                if (ok) {
                    JSObject ret = new JSObject();
                    ret.put("result", result);
                    pending.resolve(ret);
                } else {
                    pending.reject(error);
                }
            }
        });
    }

    @PluginMethod
    public void currentUrl(final PluginCall call) {
        if (webView == null) {
            call.reject("not-open");
            return;
        }
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                JSObject ret = new JSObject();
                ret.put("url", webView.getUrl() != null ? webView.getUrl() : "");
                ret.put("title", webView.getTitle() != null ? webView.getTitle() : "");
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void setMode(final PluginCall call) {
        if (webView == null) {
            call.reject("not-open");
            return;
        }
        final String newMode = call.getString("mode");
        if (!"login".equals(newMode) && !"agent".equals(newMode) && !"guide".equals(newMode)) {
            call.reject("mode must be login, agent or guide");
            return;
        }
        final String banner = call.getString("banner");
        final JSArray originsArr = call.getArray("origins");
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                mode = newMode;
                if (originsArr != null) {
                    try {
                        Set<String> next = new HashSet<>();
                        for (int i = 0; i < originsArr.length(); i++) next.add(originsArr.getString(i));
                        allowedOrigins = next;
                    } catch (JSONException ignored) {}
                }
                applyModeUi(banner);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void drainRequests(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (requestLog) {
            for (JSObject o : requestLog) arr.put(o);
            requestLog.clear();
        }
        JSObject ret = new JSObject();
        ret.put("requests", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void close(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                teardown(true);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        teardown(false);
        super.handleOnDestroy();
    }

    // ---- UI --------------------------------------------------------------------------------

    private void buildDialog(final Activity activity) {
        dialog = new Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);

        int pad = dp(activity, 12);

        LinearLayout header = new LinearLayout(activity);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(pad, dp(activity, 8), pad, dp(activity, 8));

        Button cancelButton = new Button(activity);
        cancelButton.setText("Cancel");
        flattenButton(cancelButton);
        cancelButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                teardown(true);
            }
        });

        LinearLayout titleBox = new LinearLayout(activity);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleBox.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView titleLabel = new TextView(activity);
        titleLabel.setText(hostTitle);
        titleLabel.setTextSize(15);
        titleLabel.setTypeface(null, Typeface.BOLD);
        titleLabel.setGravity(Gravity.CENTER);
        titleLabel.setSingleLine(true);
        titleLabel.setEllipsize(TextUtils.TruncateAt.MIDDLE);

        subtitleLabel = new TextView(activity);
        subtitleLabel.setTextSize(11);
        subtitleLabel.setTextColor(Color.DKGRAY);
        subtitleLabel.setGravity(Gravity.CENTER);

        titleBox.addView(titleLabel);
        titleBox.addView(subtitleLabel);

        doneButton = new Button(activity);
        doneButton.setText("Done, I'm signed in");
        flattenButton(doneButton);
        doneButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                JSObject data = new JSObject();
                data.put("url", webView != null && webView.getUrl() != null ? webView.getUrl() : "");
                notifyListeners("loggedIn", data);
            }
        });

        header.addView(cancelButton);
        header.addView(titleBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        header.addView(doneButton);

        LinearLayout banner = new LinearLayout(activity);
        banner.setOrientation(LinearLayout.HORIZONTAL);
        banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setBackgroundColor(Color.parseColor("#FF9500"));
        banner.setPadding(pad, dp(activity, 6), pad, dp(activity, 6));
        banner.setVisibility(View.GONE);
        bannerView = banner;

        bannerLabel = new TextView(activity);
        bannerLabel.setTextColor(Color.WHITE);
        bannerLabel.setTextSize(13);

        Button stopButton = new Button(activity);
        stopButton.setText("Stop");
        stopButton.setTextColor(Color.WHITE);
        stopButton.setBackgroundColor(Color.TRANSPARENT);
        stopButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                JSObject data = new JSObject();
                data.put("url", webView != null && webView.getUrl() != null ? webView.getUrl() : "");
                notifyListeners("stopped", data);
            }
        });

        banner.addView(bannerLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        banner.addView(stopButton);

        FrameLayout content = new FrameLayout(activity);
        content.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        touchBlockerView = new View(activity);
        touchBlockerView.setVisibility(View.GONE);
        touchBlockerView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, android.view.MotionEvent event) {
                return true; // swallow all touches while the agent is driving
            }
        });
        content.addView(touchBlockerView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        root.addView(header);
        root.addView(banner);
        root.addView(content, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        dialog.setContentView(root);
        dialog.setOnCancelListener(new android.content.DialogInterface.OnCancelListener() {
            @Override
            public void onCancel(android.content.DialogInterface d) {
                teardown(true);
            }
        });

        applyModeUi(null);
    }

    // login: doctor drives, Done button, no banner. agent: banner + Stop, touch overlay ON, origins enforced.
    // guide: the agent asks the doctor to show it something: banner with the question, Done button,
    // NO touch overlay (the doctor must be able to tap), origins enforced.
    private void applyModeUi(String bannerText) {
        boolean agent = "agent".equals(mode);
        boolean guide = "guide".equals(mode);
        if (subtitleLabel != null) {
            subtitleLabel.setText(agent || guide ? "" : "Sign in yourself. StewardMD never sees your password.");
        }
        if (doneButton != null) {
            doneButton.setVisibility(agent ? View.GONE : View.VISIBLE);
            doneButton.setText(guide ? "Done" : "Done, I'm signed in");
        }
        if (bannerView != null) bannerView.setVisibility(agent || guide ? View.VISIBLE : View.GONE);
        if (bannerLabel != null) {
            bannerLabel.setText(bannerText != null
                ? bannerText
                : "StewardMD is reading " + hostTitle + " on your behalf. Tap Stop to end.");
        }
        if (touchBlockerView != null) touchBlockerView.setVisibility(agent ? View.VISIBLE : View.GONE);
    }

    private static void flattenButton(Button b) {
        b.setBackgroundColor(Color.TRANSPARENT);
        b.setAllCaps(false);
    }

    private static int dp(Context c, int v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    // ---- WebViewClient -----------------------------------------------------------------------

    private WebViewClient buildWebViewClient() {
        return new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                try {
                    JSObject entry = new JSObject();
                    entry.put("method", request.getMethod());
                    entry.put("url", request.getUrl().toString());
                    entry.put("ts", System.currentTimeMillis());
                    entry.put("mainFrame", request.isForMainFrame());
                    synchronized (requestLog) {
                        requestLog.add(entry);
                        while (requestLog.size() > REQUEST_LOG_CAP) requestLog.remove(0);
                    }
                } catch (Exception ignored) {}
                return null; // let the engine load it normally
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return blockIfDisallowed(request.getUrl(), request.isForMainFrame());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (pendingLateInitScript != null) {
                    view.evaluateJavascript(pendingLateInitScript, null);
                }
                JSObject data = new JSObject();
                data.put("url", url);
                data.put("mainFrame", true);
                notifyListeners("navigated", data);
            }
        };
    }

    // Returns true to BLOCK the navigation (shouldOverrideUrlLoading semantics: true = we handled it, don't load).
    private boolean blockIfDisallowed(Uri uri, boolean mainFrame) {
        boolean https = "https".equalsIgnoreCase(uri.getScheme());
        if (mainFrame && ("agent".equals(mode) || "guide".equals(mode))) {
            if (!https || !allowedOrigins.contains(originOf(uri))) {
                JSObject data = new JSObject();
                data.put("url", uri.toString());
                data.put("reason", "origin");
                notifyListeners("blocked", data);
                return true;
            }
        } else if (mainFrame && !https) {
            return true; // http refused even in login mode
        }
        return false;
    }

    private void teardown(boolean notify) {
        boolean had = dialog != null;
        if (dialog != null) {
            try {
                dialog.dismiss();
            } catch (Exception ignored) {}
            dialog = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        subtitleLabel = null;
        bannerLabel = null;
        doneButton = null;
        bannerView = null;
        touchBlockerView = null;
        pendingLateInitScript = null;
        for (Integer id : new ArrayList<>(pendingEvals.keySet())) {
            Runnable timeout = pendingEvalTimeouts.remove(id);
            if (timeout != null) evalHandler.removeCallbacks(timeout);
            PluginCall pending = pendingEvals.remove(id);
            if (pending != null) pending.reject("browser closed");
        }
        if (notify && had) {
            JSObject data = new JSObject();
            data.put("reason", "closed");
            notifyListeners("closed", data);
        }
    }

    // ---- Helpers -----------------------------------------------------------------------------

    private static boolean isHttps(String urlStr) {
        try {
            return "https".equalsIgnoreCase(Uri.parse(urlStr).getScheme());
        } catch (Exception e) {
            return false;
        }
    }

    private static String hostOf(String urlStr) {
        try {
            String h = Uri.parse(urlStr).getHost();
            return h != null ? h : "";
        } catch (Exception e) {
            return "";
        }
    }

    private static String originOf(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return "";
        int port = uri.getPort();
        return port > 0 ? scheme + "://" + host + ":" + port : scheme + "://" + host;
    }

}
