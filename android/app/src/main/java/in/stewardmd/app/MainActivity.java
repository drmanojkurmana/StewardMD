package in.stewardmd.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.speechrecognition.SpeechRecognition;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafePushNotificationsPlugin.class);
        registerPlugin(SafeFirebaseAuthenticationPlugin.class);
        registerPlugin(SpeechRecognition.class);
        registerPlugin(AppOrientationPlugin.class);
        registerPlugin(FundxDepthPlugin.class);
        registerPlugin(WearBridgePlugin.class);
        super.onCreate(savedInstanceState);
        setupSafeAreaInsets();
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
