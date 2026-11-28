package in.stewardmd.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * PrepNucleus Focus: the screen over a blocked app (FocusGuardService brings it up). Same look as the iOS shield
 * (ios/App/FocusShield): Midnight #1a1a2e, the app icon, "Back to studying", the session's end time, amber OK.
 * OK and Back both go to the home screen, never back into the blocked app. Built in code, no layout files.
 */
public class FocusBlockActivity extends Activity {
    private static final int MIDNIGHT = Color.parseColor("#1a1a2e");
    private static final int PAPER = Color.parseColor("#f5f3ee");
    private static final int AMBER = Color.parseColor("#efc07b");

    private int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window w = getWindow();
        w.setStatusBarColor(MIDNIGHT);
        w.setNavigationBarColor(MIDNIGHT);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(MIDNIGHT);
        root.setPadding(dp(32), dp(120), dp(32), dp(48));

        ImageView icon = new ImageView(this);
        icon.setImageResource(getApplicationInfo().icon);
        root.addView(icon, new LinearLayout.LayoutParams(dp(72), dp(72)));

        TextView title = new TextView(this);
        title.setText("Back to studying");
        title.setTextColor(PAPER);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tp.topMargin = dp(28);
        root.addView(title, tp);

        TextView sub = new TextView(this);
        sub.setText(FocusGuardService.untilText(this));
        sub.setTextColor(Color.argb(184, 245, 243, 238));
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        sub.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(10);
        root.addView(sub, sp);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        Button ok = new Button(this);
        ok.setText("OK");
        ok.setAllCaps(false);
        ok.setTextColor(MIDNIGHT);
        ok.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        ok.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(AMBER);
        pill.setCornerRadius(dp(28));
        ok.setBackground(pill);
        ok.setOnClickListener(v -> goHome());
        root.addView(ok, new LinearLayout.LayoutParams(dp(220), dp(56)));

        setContentView(root);
        // targetSdk 36 uses predictive back, which skips onBackPressed: Back must still go home.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goHome);
        }
    }

    private void goHome() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(home); } catch (Exception ignored) { }
        finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { goHome(); }
}
