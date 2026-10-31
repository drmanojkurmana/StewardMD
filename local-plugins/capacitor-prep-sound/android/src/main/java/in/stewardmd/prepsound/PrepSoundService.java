package in.stewardmd.prepsound;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Foreground media-playback service for PrepNucleus Sound first-party audio.
 *
 * Platform APIs only (MediaPlayer + android.media.session.MediaSession): the
 * repo has no Media3 dependency, and none is added. The service plays one of
 * the generated WAV loops in android assets (tools/prep-sound-render-wavs.mjs),
 * owns audio focus, pauses on ACTION_AUDIO_BECOMING_NOISY, ducks on transient
 * focus loss that allows ducking, pauses on other focus loss, and stops when
 * PrepNucleus asks (PrepReels video, TTS, mock tests all route through stop).
 *
 * No autoplay: the service does nothing until PrepSoundPlugin sends ACTION_PLAY
 * from an explicit user tap in the web layer. When the caller's
 * backgroundPlayback preference is false the web layer stops playback on hide;
 * the service additionally records the flag so a noisy/focus pause never
 * auto-resumes into the background.
 */
public class PrepSoundService extends Service {

    static final String ACTION_PLAY = "in.stewardmd.prepsound.PLAY";
    static final String ACTION_PAUSE = "in.stewardmd.prepsound.PAUSE";
    static final String ACTION_STOP = "in.stewardmd.prepsound.STOP";
    static final String ACTION_SET_VOLUME = "in.stewardmd.prepsound.SET_VOLUME";
    static final String ACTION_STATE = "in.stewardmd.prepsound.STATE";

    static final String EXTRA_TRACK_ID = "trackId";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_VOLUME = "volume";
    static final String EXTRA_BACKGROUND = "backgroundPlayback";
    static final String EXTRA_PLAYING = "playing";
    static final String EXTRA_REASON = "reason";

    private static final String CHANNEL_ID = "prep_sound_playback";
    private static final int NOTIFICATION_ID = 42031;
    private static final float DUCK_VOLUME = 0.2f;

    static final Map<String, String> TRACK_FILES;
    static final Map<String, String> TRACK_TITLES;
    static {
        Map<String, String> files = new HashMap<>();
        files.put("rain_soft", "prep-sound/rain_soft.wav");
        files.put("night_quiet", "prep-sound/night_quiet.wav");
        files.put("deep_drone", "prep-sound/deep_drone.wav");
        files.put("ocean_slow", "prep-sound/ocean_slow.wav");
        TRACK_FILES = Collections.unmodifiableMap(files);
        Map<String, String> titles = new HashMap<>();
        titles.put("rain_soft", "Soft rain");
        titles.put("night_quiet", "Quiet night");
        titles.put("deep_drone", "Deep focus");
        titles.put("ocean_slow", "Slow shore");
        TRACK_TITLES = Collections.unmodifiableMap(titles);
    }

    private MediaPlayer player;
    private MediaSession session;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private boolean focusHeld = false;
    private boolean pausedByFocus = false;
    private boolean ducked = false;

    private String trackId;
    private String title = "PrepNucleus Sound";
    private float volume = 0.8f;
    private boolean backgroundPlayback = false;
    private boolean noisyRegistered = false;

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                pausePlayback("noisy");
            }
        }
    };

    private final AudioManager.OnAudioFocusChangeListener focusListener = focusChange -> {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                pausePlayback("focus-loss");
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (isPlaying()) { pausedByFocus = true; pausePlayback("focus-transient"); }
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (isPlaying()) { ducked = true; applyVolume(); }
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (ducked) { ducked = false; applyVolume(); }
                else if (pausedByFocus) {
                    pausedByFocus = false;
                    // Only resume a transient-focus pause, and never when the
                    // session was explicitly hushed by the web layer (that path
                    // uses ACTION_STOP / ACTION_PAUSE, which clear pausedByFocus).
                    resumePlayback();
                }
                break;
            default:
                break;
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createChannel();
        session = new MediaSession(this, "PrepSound");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resumePlayback(); }
            @Override public void onPause() { pausePlayback("media-session"); }
            @Override public void onStop() { stopPlayback("media-session"); }
        });
        session.setFlags(0);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_PLAY.equals(action)) {
            String nextTrack = intent.getStringExtra(EXTRA_TRACK_ID);
            if (nextTrack == null || !TRACK_FILES.containsKey(nextTrack)) {
                broadcastState(false, "unknown-track");
                stopSelf();
                return START_NOT_STICKY;
            }
            trackId = nextTrack;
            String t = intent.getStringExtra(EXTRA_TITLE);
            if (t != null && !t.isEmpty()) title = t;
            if (intent.hasExtra(EXTRA_VOLUME)) {
                volume = clampVolume(intent.getFloatExtra(EXTRA_VOLUME, volume));
            }
            backgroundPlayback = intent.getBooleanExtra(EXTRA_BACKGROUND, false);
            startPlayback();
        } else if (ACTION_PAUSE.equals(action)) {
            pausedByFocus = false;
            pausePlayback("plugin");
        } else if (ACTION_STOP.equals(action)) {
            stopPlayback("plugin");
        } else if (ACTION_SET_VOLUME.equals(action)) {
            if (intent.hasExtra(EXTRA_VOLUME)) {
                volume = clampVolume(intent.getFloatExtra(EXTRA_VOLUME, volume));
                ducked = false;
                applyVolume();
            }
        }
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        releasePlayer();
        unregisterNoisy();
        abandonFocus();
        if (session != null) { session.setActive(false); session.release(); session = null; }
        super.onDestroy();
    }

    // -- playback -----------------------------------------------------------

    private void startPlayback() {
        if (!requestFocus()) { broadcastState(false, "focus-denied"); stopSelf(); return; }
        try {
            ensurePlayerForTrack();
            if (player == null) { broadcastState(false, "player-unavailable"); stopSelf(); return; }
            applyVolume();
            if (!player.isPlaying()) player.start();
            registerNoisy();
            session.setActive(true);
            updateSession();
            startForeground(NOTIFICATION_ID, buildNotification(true));
            broadcastState(true, "playing");
        } catch (Exception e) {
            broadcastState(false, "start-failed");
            stopSelf();
        }
    }

    private void resumePlayback() {
        if (trackId == null) return;
        if (!focusHeld && !requestFocus()) { broadcastState(false, "focus-denied"); return; }
        try {
            ensurePlayerForTrack();
            if (player != null && !player.isPlaying()) player.start();
            registerNoisy();
            session.setActive(true);
            updateSession();
            startForeground(NOTIFICATION_ID, buildNotification(true));
            broadcastState(true, "playing");
        } catch (Exception e) {
            broadcastState(false, "start-failed");
        }
    }

    private void pausePlayback(String reason) {
        try { if (player != null && player.isPlaying()) player.pause(); } catch (Exception ignored) {}
        updateSession();
        // Keep the foreground notification (paused) so lock-screen controls can
        // resume; the service stays foreground only while a session exists.
        try { startForeground(NOTIFICATION_ID, buildNotification(false)); } catch (Exception ignored) {}
        broadcastState(false, reason);
    }

    private void stopPlayback(String reason) {
        pausedByFocus = false;
        ducked = false;
        releasePlayer();
        unregisterNoisy();
        abandonFocus();
        if (session != null) session.setActive(false);
        broadcastState(false, reason);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void ensurePlayerForTrack() throws Exception {
        releasePlayer();
        AssetFileDescriptor afd = getAssets().openFd(TRACK_FILES.get(trackId));
        MediaPlayer next = new MediaPlayer();
        next.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
        next.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
        afd.close();
        next.setLooping(true);
        next.setOnErrorListener((mp, what, extra) -> { broadcastState(false, "player-error"); stopPlayback("player-error"); return true; });
        next.prepare();
        player = next;
    }

    private void releasePlayer() {
        if (player == null) return;
        try { if (player.isPlaying()) player.stop(); } catch (Exception ignored) {}
        try { player.release(); } catch (Exception ignored) {}
        player = null;
    }

    private boolean isPlaying() {
        try { return player != null && player.isPlaying(); } catch (Exception e) { return false; }
    }

    private void applyVolume() {
        if (player == null) return;
        float v = ducked ? volume * DUCK_VOLUME : volume;
        try { player.setVolume(v, v); } catch (Exception ignored) {}
    }

    private static float clampVolume(float v) {
        if (Float.isNaN(v)) return 0.8f;
        return Math.max(0f, Math.min(1f, v));
    }

    // -- audio focus / noisy --------------------------------------------------

    private boolean requestFocus() {
        if (audioManager == null) return true;
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(focusListener)
                .setWillPauseWhenDucked(false)
                .build();
        int result = audioManager.requestAudioFocus(focusRequest);
        focusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return focusHeld;
    }

    private void abandonFocus() {
        if (audioManager != null && focusRequest != null) {
            try { audioManager.abandonAudioFocusRequest(focusRequest); } catch (Exception ignored) {}
        }
        focusRequest = null;
        focusHeld = false;
    }

    private void registerNoisy() {
        if (noisyRegistered) return;
        try {
            registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
            noisyRegistered = true;
        } catch (Exception ignored) {}
    }

    private void unregisterNoisy() {
        if (!noisyRegistered) return;
        try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) {}
        noisyRegistered = false;
    }

    // -- session / notification ----------------------------------------------

    private void updateSession() {
        if (session == null) return;
        boolean playing = isPlaying();
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_STOP;
        PlaybackState state = new PlaybackState.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, 0, 1f)
                .build();
        session.setPlaybackState(state);
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "PrepNucleus Sound · original")
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "Focus ambience")
                .build());
    }

    private void createChannel() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "PrepNucleus Sound", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Focus ambience playback controls");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(boolean playing) {
        PendingIntent playPause = serviceIntent(playing ? ACTION_PAUSE : ACTION_PLAY, 1);
        PendingIntent stop = serviceIntent(ACTION_STOP, 2);
        PendingIntent openApp = openAppIntent();
        Notification.MediaStyle style = new Notification.MediaStyle()
                .setMediaSession(session != null ? session.getSessionToken() : null)
                .setShowActionsInCompactView(0, 1);
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText("PrepNucleus Sound · original ambience")
                .setStyle(style)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setOngoing(playing);
        if (openApp != null) builder.setContentIntent(openApp);
        builder.addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "Pause" : "Play", playPause).build());
        builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "Stop", stop).build());
        return builder.build();
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PrepSoundService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, requestCode, intent, flags);
    }

    private PendingIntent openAppIntent() {
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) return null;
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            return PendingIntent.getActivity(this, 0, launch, flags);
        } catch (Exception e) {
            return null;
        }
    }

    private void broadcastState(boolean playing, String reason) {
        try {
            Intent intent = new Intent(ACTION_STATE).setPackage(getPackageName());
            intent.putExtra(EXTRA_PLAYING, playing);
            intent.putExtra(EXTRA_TRACK_ID, trackId);
            intent.putExtra(EXTRA_REASON, reason);
            sendBroadcast(intent);
        } catch (Exception ignored) {}
    }
}
