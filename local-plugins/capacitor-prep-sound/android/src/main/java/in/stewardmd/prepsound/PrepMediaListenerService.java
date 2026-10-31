package in.stewardmd.prepsound;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Grants PrepNucleus access to Android media sessions. It reads NO
 * notification content: onNotificationPosted/onNotificationRemoved ignore
 * their StatusBarNotification argument entirely (no extras, title, text or
 * bigContentView are ever read, stored or logged).
 *
 * The service exists only so MediaSessionManager.getActiveSessions(
 * new ComponentName(context, PrepMediaListenerService.class)) is allowed
 * after the user enables "PrepNucleus" under Settings > Notification
 * access. All now-playing data comes from MediaSession metadata and
 * PlaybackState, never from notifications.
 *
 * Declared in the plugin AndroidManifest with
 * android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
 * so only the system can bind it. Permission explanation shown to the user
 * (prep-sound-system.js): "Lets PrepNucleus show and control the song
 * playing in your music app. PrepNucleus does not read your notifications."
 */
public class PrepMediaListenerService extends NotificationListenerService {

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        // Intentionally empty: notification content is never read.
    }

    @Override public void onNotificationRemoved(StatusBarNotification sbn) {
        // Intentionally empty: notification content is never read.
    }
}
