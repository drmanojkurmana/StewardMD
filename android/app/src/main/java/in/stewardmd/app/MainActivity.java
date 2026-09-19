package in.stewardmd.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.community.speechrecognition.SpeechRecognition;
import in.stewardmd.whisper.WhisperPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafePushNotificationsPlugin.class);
        registerPlugin(SafeFirebaseAuthenticationPlugin.class);
        registerPlugin(SpeechRecognition.class);
        registerPlugin(AppOrientationPlugin.class);
        registerPlugin(ConnectBrowserPlugin.class);
        registerPlugin(FundxDepthPlugin.class);
        // Built (native whisper.cpp JNI, gradle-wired), never registered - which is the whole
        // reason voice.js's whisperAvailable() gate has been silently false on every Android
        // device: Capacitor.Plugins.Whisper never existed. Owner decision 2026-08-14 (see
        // local-plugins/capacitor-whisper/package.json) is on-device Whisper as the production
        // ASR target on Android too, matching iOS.
        registerPlugin(WhisperPlugin.class);
        super.onCreate(savedInstanceState);
        setupSafeAreaInsets();
        setupRenderProcessRecovery();
    }

    // Android reclaims the WebView RENDER process under memory pressure or after a long background.
    // If onRenderProcessGone is not overridden (or returns false), the framework CRASHES THE APP -
    // which shows up as the app "crashing"/going blank when reopened. We return true (we handled it)
    // and recreate the activity so the WebView + home reload cleanly instead of dying. Delegates all
    // normal navigation to Capacitor's BridgeWebViewClient. No effect on iOS/web.
    private void setupRenderProcessRecovery() {
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        final Bridge bridge = getBridge();
        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                boolean didCrash = detail != null && detail.didCrash();
                Log.w("StewardMD", "WebView render process gone (didCrash=" + didCrash + "); recovering by recreating the activity");
                try {
                    if (!isFinishing() && !isDestroyed()) {
                        runOnUiThread(() -> { try { recreate(); } catch (Exception e) { Log.e("StewardMD", "recreate failed", e); } });
                    }
                } catch (Exception e) {
                    Log.e("StewardMD", "render recovery failed", e);
                }
                return true;   // handled - prevents the framework from crashing the app
            }
        });
    }

    // Android 15+ (targetSdk 35+) forces edge-to-edge: the app draws BEHIND the status /
    // navigation bars. Chromium's env(safe-area-inset-*) only reflects the display cutout, NOT the
    // system bars, so headers collide with the status bar. Read the real system-bar + cutout insets
    // and publish them to the WebView as CSS variables (--sai-*, in CSS px) that the styles consume
    // as `var(--sai-top, env(safe-area-inset-top, 0px))`. Keeps the UI edge-to-edge (full-bleed
    // camera) while padding the chrome correctly. Re-applies on rotation / inset changes. No effect
    // on iOS/web, where the var is unset and env() is used.
    private void setupSafeAreaInsets() {
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        final View root = getWindow().getDecorView();
        final float density = getResources().getDisplayMetrics().density;
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            final int top = Math.round(bars.top / density);
            final int right = Math.round(bars.right / density);
            final int bottom = Math.round(bars.bottom / density);
            final int left = Math.round(bars.left / density);
            final String js = "(function(){try{var s=document.documentElement.style;"
                + "s.setProperty('--sai-top','" + top + "px');"
                + "s.setProperty('--sai-right','" + right + "px');"
                + "s.setProperty('--sai-bottom','" + bottom + "px');"
                + "s.setProperty('--sai-left','" + left + "px');}catch(e){}})();";
            webView.post(() -> webView.evaluateJavascript(js, null));
            return insets;   // do NOT consume — keep edge-to-edge; CSS applies the padding
        });
        ViewCompat.requestApplyInsets(root);
    }
}
