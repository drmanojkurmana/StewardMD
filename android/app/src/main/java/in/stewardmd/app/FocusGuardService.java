package in.stewardmd.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Set;

/**
 * PrepNucleus Focus guard (SmdFocusPlugin). While a session runs it checks which app is in front a little more than
 * once a second (UsageStatsManager events) and brings FocusBlockActivity up over a blocked app. It ends itself, and
 * clears the session, when endsAt passes. START_STICKY: if Android stops it, it comes back and reads the session from
 * SharedPreferences, so closing StewardMD does not end the blocking.
 *
 * A foreground service, so Android shows its notification ("PrepNucleus Focus is on until h:mm") for as long as it
 * runs. Type specialUse (declared in AndroidManifest.xml with its reason for Play review).
 */
public class FocusGuardService extends Service {
    private static final String CHANNEL = "prep_focus";
    private static final int NOTE_ID = 7342;
    private static final long TICK_MS = 700;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private String lastFront = "";
    private long lastShown = 0;

    static void start(Context c) {
        Intent i = new Intent(c, FocusGuardService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i); else c.startService(i);
    }

    static void end(Context c) {
        SmdFocusPlugin.prefs(c).edit().remove(SmdFocusPlugin.K_ACTIVE).remove(SmdFocusPlugin.K_ENDS).remove(SmdFocusPlugin.K_STRICT).apply();
        c.stopService(new Intent(c, FocusGuardService.class));
    }

    static String untilText(Context c) {
        long ends = SmdFocusPlugin.prefs(c).getLong(SmdFocusPlugin.K_ENDS, 0);
        if (ends <= System.currentTimeMillis()) return "PrepNucleus Focus is on";
        return "PrepNucleus Focus is on until " + new SimpleDateFormat("h:mm", Locale.getDefault()).format(new Date(ends));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = SmdFocusPlugin.prefs(this);
        if (!p.getBoolean(SmdFocusPlugin.K_ACTIVE, false)) { stopSelf(); return START_NOT_STICKY; }
        Notification n = note();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTE_ID, n);
        }
        handler.removeCallbacks(tick);
        handler.post(tick);
        return START_STICKY;
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Context c = FocusGuardService.this;
            SharedPreferences p = SmdFocusPlugin.prefs(c);
            long ends = p.getLong(SmdFocusPlugin.K_ENDS, 0);
            if (!p.getBoolean(SmdFocusPlugin.K_ACTIVE, false) || (ends > 0 && System.currentTimeMillis() >= ends)) {
                end(c);
                stopSelf();
                return;
            }
            String front = frontApp();
            if (front != null) lastFront = front;
            Set<String> blocked = SmdFocusPlugin.apps(c);
            // Bring the block screen up when a blocked app is in front; at most every 1.5 s so a slow launch does not stack it.
            if (blocked.contains(lastFront) && System.currentTimeMillis() - lastShown > 1500) {
                lastShown = System.currentTimeMillis();
                Intent i = new Intent(c, FocusBlockActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                try { startActivity(i); } catch (Exception ignored) { }
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    // The package most recently brought to the front in the last few seconds, or null if nothing changed.
    private String frontApp() {
        try {
            UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            UsageEvents ev = usm.queryEvents(now - 5000, now);
            UsageEvents.Event e = new UsageEvents.Event();
            String last = null;
            while (ev.hasNextEvent()) {
                ev.getNextEvent(e);
                int t = e.getEventType();
                boolean resumed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? t == UsageEvents.Event.ACTIVITY_RESUMED
                    : t == UsageEvents.Event.MOVE_TO_FOREGROUND;
                if (resumed) last = e.getPackageName();
            }
            return last;
        } catch (Exception e) {
            return null;
        }
    }

    private Notification note() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Focus sessions", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while a PrepNucleus Focus session blocks apps");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle("Back to studying")
            .setContentText(untilText(this))
            .setSmallIcon(getApplicationInfo().icon)
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
