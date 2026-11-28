package in.stewardmd.app;

import android.app.AlertDialog;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * PrepNucleus Focus app blocking on Android, exposed to JS as `Capacitor.Plugins.SmdFocus` (same contract as the iOS
 * Screen Time plugin, ios/App/App/SmdFocusPlugin.swift; plan vault/plans/PrepNucleus-Focus.md). Every method resolves,
 * never rejects: prep-focus.js treats a missing plugin or a failed call as "no blocking".
 *
 *  - status()    -> { available, authorized, apps, categories: 0, domains: 0 }
 *  - authorize() -> { authorized }   opens Settings for Usage access, then Display over other apps, one after the other
 *  - pick()      -> { apps, ... }    a native list of the phone's apps with tick boxes; Done saves
 *  - start({ endsAt, strict })      -> { shielding }   FocusGuardService watches the app in front until endsAt
 *  - stop()      -> {}
 *
 * Android has no Screen Time API. Usage access tells the guard which app is in front; Display over other apps lets it
 * bring the "Back to studying" screen (FocusBlockActivity) up over a blocked app from the background. The selection and
 * the session live in SharedPreferences "smd_focus" so the guard keeps working when StewardMD is closed.
 */
@CapacitorPlugin(name = "SmdFocus")
public class SmdFocusPlugin extends Plugin {
    static final String PREFS = "smd_focus";
    static final String K_APPS = "apps", K_ENDS = "endsAt", K_STRICT = "strict", K_ACTIVE = "active";

    private PluginCall pendingAuth;
    private int authStep;   // 1: sent to Usage access, 2: sent to Display over other apps

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static boolean hasUsageAccess(Context c) {
        try {
            AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName())
                : ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    static boolean hasOverlay(Context c) { return Settings.canDrawOverlays(c); }

    static boolean authorized(Context c) { return hasUsageAccess(c) && hasOverlay(c); }

    static Set<String> apps(Context c) { return new HashSet<>(prefs(c).getStringSet(K_APPS, Collections.<String>emptySet())); }

    private JSObject counts() {
        JSObject r = new JSObject();
        r.put("apps", apps(getContext()).size());
        r.put("categories", 0);
        r.put("domains", 0);
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = counts();
        r.put("available", true);
        r.put("authorized", authorized(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        Context c = getContext();
        if (authorized(c)) { call.resolve(new JSObject().put("authorized", true)); return; }
        pendingAuth = call;
        nextAuthStep();
    }

    // One Settings page at a time; handleOnResume moves on when the student comes back.
    private void nextAuthStep() {
        Context c = getContext();
        try {
            if (!hasUsageAccess(c) && authStep < 1) {
                authStep = 1;
                Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) i.setData(Uri.parse("package:" + c.getPackageName()));
                startSettings(i, new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
                return;
            }
            if (hasUsageAccess(c) && !hasOverlay(c) && authStep < 2) {
                authStep = 2;
                startSettings(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + c.getPackageName())), null);
                return;
            }
        } catch (Exception ignored) {
        }
        finishAuth();
    }

    private void startSettings(Intent first, Intent fallback) {
        first.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(first);
        } catch (Exception e) {
            if (fallback == null) throw e;
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
    }

    private void finishAuth() {
        PluginCall call = pendingAuth;
        pendingAuth = null;
        authStep = 0;
        if (call != null) call.resolve(new JSObject().put("authorized", authorized(getContext())));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pendingAuth == null) return;
        Context c = getContext();
        // Back from Usage access with it granted: on to Display over other apps. Otherwise answer with what we have.
        if (authStep == 1 && hasUsageAccess(c) && !hasOverlay(c)) { nextAuthStep(); return; }
        finishAuth();
    }

    @PluginMethod
    public void pick(final PluginCall call) {
        final Context c = getContext();
        PackageManager pm = c.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> found = pm.queryIntentActivities(launcher, 0);
        final List<String[]> list = new ArrayList<>();   // [label, package]
        Set<String> seen = new HashSet<>();
        for (ResolveInfo ri : found) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(c.getPackageName()) || !seen.add(pkg)) continue;
            list.add(new String[] { String.valueOf(ri.loadLabel(pm)), pkg });
        }
        Collections.sort(list, (a, b) -> a[0].compareToIgnoreCase(b[0]));
        final Set<String> chosen = apps(c);
        final String[] labels = new String[list.size()];
        final boolean[] ticked = new boolean[list.size()];
        for (int i = 0; i < list.size(); i++) { labels[i] = list.get(i)[0]; ticked[i] = chosen.contains(list.get(i)[1]); }
        getActivity().runOnUiThread(() -> {
            try {
                new AlertDialog.Builder(getActivity())
                    .setTitle("Block during focus")
                    .setMultiChoiceItems(labels, ticked, (d, which, isChecked) -> ticked[which] = isChecked)
                    .setNegativeButton("Cancel", (d, w) -> call.resolve(counts()))
                    .setPositiveButton("Done", (d, w) -> {
                        Set<String> out = new HashSet<>();
                        for (int i = 0; i < ticked.length; i++) if (ticked[i]) out.add(list.get(i)[1]);
                        prefs(c).edit().putStringSet(K_APPS, out).apply();
                        call.resolve(counts());
                    })
                    .setOnCancelListener(d -> call.resolve(counts()))
                    .show();
            } catch (Exception e) {
                call.resolve(counts());
            }
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context c = getContext();
        if (!authorized(c) || apps(c).isEmpty()) { call.resolve(new JSObject().put("shielding", false)); return; }
        Double endsAt = call.getDouble("endsAt");
        boolean strict = Boolean.TRUE.equals(call.getBoolean("strict", false));
        SharedPreferences.Editor e = prefs(c).edit().putBoolean(K_ACTIVE, true).putBoolean(K_STRICT, strict);
        if (endsAt != null) e.putLong(K_ENDS, endsAt.longValue()); else e.remove(K_ENDS);
        e.apply();
        try {
            FocusGuardService.start(c);
            call.resolve(new JSObject().put("shielding", true));
        } catch (Exception ex) {
            call.resolve(new JSObject().put("shielding", false));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        FocusGuardService.end(getContext());
        call.resolve();
    }
}
