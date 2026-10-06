package in.stewardmd.prepwidgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * PrepNucleus home-screen widget. Reads the snapshot PrepWidgetsPlugin.setData stores in
 * SharedPreferences "prep_widget" / "data" (same JSON as iOS). Shows readiness, days to the exam and
 * "Today N of M" (+ the next item when there is room). When the snapshot's day is not today it shows
 * "Plan not started today" instead of yesterday's numbers; missing or garbage data shows the
 * placeholder. Tap opens the app with stewardmd://prep (an ACTION_VIEW intent to the launcher
 * activity, which Capacitor's App plugin reports as appUrlOpen / getLaunchUrl).
 */
public class PrepWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "prep_widget";
    static final String KEY = "data";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context, manager, ids);
    }

    /** Redraw every placed prep widget (called after setData). */
    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PrepWidgetProvider.class));
        if (ids != null && ids.length > 0) render(context, manager, ids);
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        RemoteViews views = build(context, raw);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    static RemoteViews build(Context context, String raw) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.prep_widget);
        v.setOnClickPendingIntent(R.id.prep_root, openPrep(context));

        JSONObject o = parse(raw);
        if (o == null) {
            v.setTextViewText(R.id.prep_exam, context.getString(R.string.prep_widget_label));
            v.setViewVisibility(R.id.prep_score_row, View.INVISIBLE);
            v.setTextViewText(R.id.prep_today, context.getString(R.string.prep_widget_empty));
            v.setViewVisibility(R.id.prep_days, View.GONE);
            v.setViewVisibility(R.id.prep_next, View.GONE);
            return v;
        }

        String exam = o.optString("exam", "").trim();
        v.setTextViewText(R.id.prep_exam, exam.isEmpty() ? "Exam" : exam);

        v.setViewVisibility(R.id.prep_score_row, View.VISIBLE);
        Integer score = intOrNull(o, "score");
        if (score != null) score = Math.max(0, Math.min(100, score));
        v.setTextViewText(R.id.prep_score, score == null ? "--" : String.valueOf(score));
        v.setContentDescription(R.id.prep_score_row,
                score == null ? "Readiness not scored yet" : "Readiness " + score + " of 100");

        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        String day = o.optString("day", "");
        boolean current = today.equals(day);

        int total = Math.max(0, intOr(o, "total", 0));
        int done = Math.max(0, Math.min(total, intOr(o, "done", 0)));
        if (!current) {
            v.setTextViewText(R.id.prep_today, "Plan not started today");
            v.setContentDescription(R.id.prep_today, "Plan not started today");
        } else if (total == 0) {
            v.setTextViewText(R.id.prep_today, "No tasks planned today");
            v.setContentDescription(R.id.prep_today, "No tasks planned today");
        } else {
            v.setTextViewText(R.id.prep_today, "Today " + done + " of " + total);
            v.setContentDescription(R.id.prep_today, "Today, " + done + " of " + total + " tasks done");
        }

        Integer daysLeft = intOrNull(o, "daysLeft");
        if (daysLeft != null && !current) daysLeft = daysLeft - daysBetween(day, today);
        if (daysLeft == null) {
            v.setViewVisibility(R.id.prep_days, View.GONE);
        } else {
            int d = Math.max(0, daysLeft);
            String text = d == 0 ? "Exam day" : (d == 1 ? "1 day to go" : d + " days to go");
            v.setViewVisibility(R.id.prep_days, View.VISIBLE);
            v.setTextViewText(R.id.prep_days, text);
            v.setContentDescription(R.id.prep_days, d == 0 ? "Exam day" : text.replace("to go", "to the exam"));
        }

        String next = o.isNull("next") ? "" : o.optString("next", "").trim();
        if (current && done < total && !next.isEmpty()) {
            v.setViewVisibility(R.id.prep_next, View.VISIBLE);
            v.setTextViewText(R.id.prep_next, "Next: " + next);
        } else {
            v.setViewVisibility(R.id.prep_next, View.GONE);
        }
        return v;
    }

    private static PendingIntent openPrep(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        Intent i = launch != null ? launch : new Intent();
        i.setAction(Intent.ACTION_VIEW);
        i.setData(Uri.parse("stewardmd://prep"));
        i.setPackage(context.getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static JSONObject parse(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(raw);
            if (o.has("v") && o.optInt("v", 1) != 1) return null;
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    private static Integer intOrNull(JSONObject o, String key) {
        Object x = o.opt(key);
        if (!(x instanceof Number)) return null;
        double d = ((Number) x).doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d) || Math.abs(d) >= 1_000_000) return null;
        return (int) Math.round(d);
    }

    private static int intOr(JSONObject o, String key, int fallback) {
        Integer n = intOrNull(o, key);
        return n == null ? fallback : n;
    }

    private static int daysBetween(String from, String to) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            long ms = f.parse(to).getTime() - f.parse(from).getTime();
            return (int) Math.max(0, Math.round(ms / (double) TimeUnit.DAYS.toMillis(1)));
        } catch (Exception e) {
            return 0;
        }
    }
}
