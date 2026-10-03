package in.stewardmd.needle;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;

/**
 * Runs the engine in android:process=":edge" (AndroidManifest.xml). One HandlerThread, so calls
 * reach the process-global, non-thread-safe engine strictly one at a time. Every request carries a
 * "rid" that comes back on the reply; the plugin matches replies by it.
 */
public class NeedleService extends Service {
    static final int MSG_LOAD = 1, MSG_CONFIGURE = 2, MSG_COMPLETE = 3, MSG_RESET = 4, MSG_PING = 5;
    private HandlerThread thread;
    private Messenger messenger;

    @Override public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("needle-engine");
        thread.start();
        messenger = new Messenger(new Handler(thread.getLooper(), this::handle));
    }

    @Override public IBinder onBind(Intent intent) { return messenger.getBinder(); }

    @Override public void onDestroy() {
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    private boolean handle(Message m) {
        Bundle in = m.getData(), out = new Bundle();
        out.putInt("rid", in.getInt("rid"));
        out.putInt("pid", android.os.Process.myPid());
        try {
            switch (m.what) {
                case MSG_LOAD: {
                    int rc = NeedleNative.load(in.getString("path", ""));
                    if (rc < 0) throw new IllegalStateException(NeedleNative.lastError());
                    out.putInt("rc", rc);
                    break;
                }
                case MSG_CONFIGURE: {
                    int rc = NeedleNative.configure(in.getString("system", ""), in.getString("tools", "[]"));
                    if (rc < 0) throw new IllegalStateException(NeedleNative.lastError());
                    out.putInt("rc", rc);
                    break;
                }
                case MSG_COMPLETE: {
                    long t0 = System.currentTimeMillis();
                    String json = NeedleNative.complete(in.getString("text", ""), in.getInt("maxTokens", 48));
                    if (json == null) throw new IllegalStateException(NeedleNative.lastError());
                    out.putString("json", json);
                    out.putLong("ms", System.currentTimeMillis() - t0);
                    break;
                }
                case MSG_RESET: NeedleNative.reset(); break;
                case MSG_PING: break;
                default: throw new IllegalArgumentException("unknown message " + m.what);
            }
            out.putBoolean("ok", true);
        } catch (Throwable t) {
            out.putBoolean("ok", false);
            out.putString("error", String.valueOf(t.getMessage()));
        }
        Message reply = Message.obtain(null, m.what);
        reply.setData(out);
        try { if (m.replyTo != null) m.replyTo.send(reply); } catch (RemoteException ignore) {}
        return true;
    }
}
