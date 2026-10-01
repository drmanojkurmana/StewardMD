package in.stewardmd.needle;

import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Capacitor.Plugins.Needle on Android. The JS contract (edge-router.js needleAdapter):
 *   available() · load({path?}) · configure({system, tools}) · complete({text, maxTokens}) -> {json, ms}
 *   reset() · kill() · release()
 * The engine lives in the ":edge" process (NeedleService); this class only talks to it over a
 * Messenger. kill() ends that process, which is the ONLY way to stop a call needle.h cannot cancel;
 * the next call binds a fresh process and must load() again (edge-runtime.js does that).
 */
@CapacitorPlugin(name = "Needle")
public class NeedlePlugin extends Plugin {
    private static final String ERR_DIED = "ENGINE_DIED", ERR_MODEL = "MODEL_MISSING", ERR_ENGINE = "ENGINE_ERROR";
    private static final int MAX_TOKENS_CAP = 128;   // the router asks for 48; never let a call run long

    private Messenger service;
    private boolean binding;
    private final List<Runnable> queued = new ArrayList<>();
    private final Map<Integer, PluginCall> pending = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger(1);
    private final Messenger replies = new Messenger(new Handler(Looper.getMainLooper(), this::onReply));

    private final ServiceConnection conn = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = new Messenger(binder);
            binding = false;
            try { binder.linkToDeath(NeedlePlugin.this::onDied, 0); } catch (RemoteException e) { onDied(); return; }
            List<Runnable> run = new ArrayList<>(queued); queued.clear();
            for (Runnable r : run) r.run();
        }
        @Override public void onServiceDisconnected(ComponentName name) { onDied(); }
    };

    private void onDied() {
        new Handler(Looper.getMainLooper()).post(() -> {
            service = null; binding = false;
            for (Map.Entry<Integer, PluginCall> e : pending.entrySet()) e.getValue().reject("the edge engine process ended", ERR_DIED);
            pending.clear();
        });
    }

    private void ensureBound(Runnable r) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (service != null) { r.run(); return; }
            queued.add(r);
            if (!binding) {
                binding = true;
                Context ctx = getContext();
                if (!ctx.bindService(new Intent(ctx, NeedleService.class), conn, Context.BIND_AUTO_CREATE)) {
                    binding = false;
                    List<Runnable> drop = new ArrayList<>(queued); queued.clear();
                    for (Runnable q : drop) q.run();   // service is still null: send() rejects each
                }
            }
        });
    }

    private void send(int what, Bundle data, PluginCall call) {
        ensureBound(() -> {
            if (service == null) { call.reject("could not start the edge engine", ERR_DIED); return; }
            int rid = seq.getAndIncrement();
            data.putInt("rid", rid);
            pending.put(rid, call);
            Message m = Message.obtain(null, what);
            m.setData(data);
            m.replyTo = replies;
            try { service.send(m); }
            catch (RemoteException e) { pending.remove(rid); call.reject("the edge engine is unreachable", ERR_DIED); }
        });
    }

    private boolean onReply(Message m) {
        Bundle b = m.getData();
        PluginCall call = pending.remove(b.getInt("rid"));
        if (call == null) return true;           // its caller already gave up (kill / timeout)
        if (!b.getBoolean("ok")) { call.reject(b.getString("error", "engine error"), ERR_ENGINE); return true; }
        JSObject o = new JSObject();
        if (b.containsKey("json")) o.put("json", b.getString("json"));
        if (b.containsKey("rc")) o.put("rc", b.getInt("rc"));
        if (b.containsKey("ms")) o.put("ms", b.getLong("ms"));
        o.put("pid", b.getInt("pid"));
        call.resolve(o);
        return true;
    }

    private String defaultWeights() {
        return new File(new File(getContext().getFilesDir(), "needle"), "needle3.cact").getAbsolutePath();
    }

    @PluginMethod
    public void available(PluginCall call) {
        File w = new File(defaultWeights());
        call.resolve(new JSObject().put("available", true).put("isolated", true).put("killable", true)
            .put("defaultWeights", w.getAbsolutePath()).put("defaultWeightsPresent", w.isFile()));
    }

    @PluginMethod
    public void load(PluginCall call) {
        String path = call.getString("path", defaultWeights());
        if (path.startsWith("file://")) path = path.substring(7);
        if (!new File(path).isFile()) { call.reject("weights not found: " + path, ERR_MODEL); return; }
        Bundle d = new Bundle(); d.putString("path", path);
        send(NeedleService.MSG_LOAD, d, call);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        Bundle d = new Bundle();
        d.putString("system", call.getString("system", ""));
        d.putString("tools", call.getString("tools", "[]"));
        send(NeedleService.MSG_CONFIGURE, d, call);
    }

    @PluginMethod
    public void complete(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty()) { call.reject("Missing text", ERR_ENGINE); return; }
        Bundle d = new Bundle();
        d.putString("text", text);
        d.putInt("maxTokens", Math.max(1, Math.min(MAX_TOKENS_CAP, call.getInt("maxTokens", 48))));
        send(NeedleService.MSG_COMPLETE, d, call);
    }

    @PluginMethod
    public void reset(PluginCall call) { send(NeedleService.MSG_RESET, new Bundle(), call); }

    /** End the :edge process. Pending calls reject with ENGINE_DIED; the next call is a cold start. */
    @PluginMethod
    public void kill(PluginCall call) {
        int pid = edgePid();
        unbind();
        if (pid > 0) android.os.Process.killProcess(pid);
        call.resolve(new JSObject().put("killed", pid > 0).put("pid", pid));
    }

    @PluginMethod
    public void release(PluginCall call) {
        unbind();
        try { getContext().stopService(new Intent(getContext(), NeedleService.class)); } catch (Throwable ignore) {}
        call.resolve();
    }

    @Override protected void handleOnDestroy() { unbind(); super.handleOnDestroy(); }

    private void unbind() {
        if (service != null || binding) { try { getContext().unbindService(conn); } catch (Throwable ignore) {} }
        service = null; binding = false; queued.clear();
        for (Map.Entry<Integer, PluginCall> e : pending.entrySet()) e.getValue().reject("the edge engine was stopped", ERR_DIED);
        pending.clear();
    }

    private int edgePid() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return 0;
        String name = getContext().getPackageName() + ":edge";
        List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
        if (procs != null) for (ActivityManager.RunningAppProcessInfo p : procs) if (name.equals(p.processName)) return p.pid;
        return 0;
    }
}
