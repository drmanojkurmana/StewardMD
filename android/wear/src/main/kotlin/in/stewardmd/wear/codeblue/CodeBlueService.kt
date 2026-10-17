package `in`.stewardmd.wear.codeblue

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import `in`.stewardmd.wear.data.WatchApi
import `in`.stewardmd.wear.net.ApiClient
import `in`.stewardmd.wear.net.FirebaseTokenProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class CodeBlueUi(
    val active: Boolean = false,
    val rateCpm: Int = 0,
    val zone: RateZone = RateZone.Idle,
    val paused: Boolean = false,
    val elapsedSeconds: Int = 0,
    val cycle: Int = 1,
    val cycleProgress: Float = 0f,   // 0..1 within the current rhythm-check cycle (drives the ring)
    val prompt: String = "",
    val shocks: Int = 0,
    // v2 additions (all defaulted so existing readers keep working)
    val mode: CodeMode = CodeMode.Adult,
    val modeLabel: String = "Adult",
    val epiLabel: String = "",
    val epiStatus: EpiStatus = EpiStatus.NotStarted,
    val epiCount: Int = 0,
    val guidePrompts: List<GuidePrompt> = emptyList(),
    val rosc: Boolean = false,
    val lastRhythm: String? = null,
    val compressionLabel: String = "",
    val checklistTicks: Set<String> = emptySet(),
    val logEvents: List<CodeEvent> = emptyList(),
    val canUndo: Boolean = false,
)

/**
 * Foreground service that owns the compression sensing + code timer so it survives the wrist dropping /
 * screen-off for a whole code (WatchCore used a HealthKit workout session; Wear uses a health foreground
 * service). Feeds [CompressionAnalyzer] (rate only). On start, best-effort alerts the phone Command
 * Center via /api/watch/codeblue. Screen observes [state]. v2: the timer/log state lives in
 * [CodeBlueController] so the UI can log events without binding; snapshots persist here.
 */
class CodeBlueService : Service(), SensorEventListener {

    companion object {
        private val _state = MutableStateFlow(CodeBlueUi())
        val state: StateFlow<CodeBlueUi> = _state
        private const val CHANNEL = "codeblue"
        private const val NOTIF_ID = 42

        fun start(ctx: Context) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, CodeBlueService::class.java))

        /** Start a fresh code in the given mode. */
        fun begin(ctx: Context, mode: CodeMode) {
            CodeBlueController.startNew(mode)
            start(ctx)
        }

        /** Resume a snapshotted code, then start the service. */
        fun resumeFromSnapshot(ctx: Context, snap: SessionSnapshot, nowWallClock: Long): Boolean {
            if (!CodeBlueController.restore(snap, nowWallClock)) return false
            start(ctx)
            return true
        }

        fun stop(ctx: Context) = ctx.stopService(Intent(ctx, CodeBlueService::class.java))

        /** Republish immediately after a UI action so the screen reflects it without waiting a tick. */
        fun refreshNow() {
            _state.value = snapshot()
        }

        private fun snapshot(): CodeBlueUi {
            val model = CodeBlueController.model
            val analyzer = CodeBlueController.analyzer
            val interval = model.cycleIntervalSeconds
            return CodeBlueUi(
                active = true,
                rateCpm = analyzer.rateCpm,
                zone = RateCoach.zone(analyzer.rateCpm, active = !analyzer.paused),
                paused = analyzer.paused,
                elapsedSeconds = model.elapsedSeconds,
                cycle = model.cycle,
                cycleProgress = if (interval > 0) (model.elapsedSeconds % interval) / interval.toFloat() else 0f,
                prompt = model.drugPrompt,
                shocks = model.shockCount,
                mode = model.mode,
                modeLabel = CodeBlueModel.modeLabel(model.mode),
                epiLabel = model.epiLabel(),
                epiStatus = model.epiStatus,
                epiCount = model.adrenalineCount,
                guidePrompts = model.guidePrompts(),
                rosc = model.rosc,
                lastRhythm = model.lastRhythmLabel,
                compressionLabel = model.compressionLabel(),
                checklistTicks = model.checklistTicks.toSet(),
                logEvents = model.events.toList(),
                canUndo = model.hasDeletedToUndo(),
            )
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var sensors: SensorManager
    private var lastSaveMillis = 0L
    private var lastSavedEventCount = -1

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        sensors = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        createChannel()
        startForegroundCompat()
        // Signed single axis (oscillates once per compression). Which axis + calibration is tuned on
        // real hardware (Task 13) — magnitude would rectify to double the rate, so NOT magnitude.
        sensors.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)?.let {
            sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
        scope.launch { runCatching { WatchApi(ApiClient(tokenProvider = FirebaseTokenProvider())).codeblueStart() } }
        scope.launch {
            while (isActive) {
                delay(1000)
                CodeBlueController.model.tick(1)
                publish()
                saveSnapshotThrottled(force = false)
            }
        }
        publish()
        saveSnapshotThrottled(force = true)
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { sensors.unregisterListener(this) }
        scope.cancel()
        _state.value = CodeBlueUi(active = false)
    }

    override fun onSensorChanged(event: SensorEvent) {
        CodeBlueController.analyzer.add(event.values[2].toDouble())   // z-axis proxy; tuned on device
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun publish() {
        _state.value = snapshot()
    }

    /**
     * Saved on every event and at most every 5 s on tick. Called from the 1 s loop: an event
     * changes the event count (save at once), otherwise throttle to 5 s.
     */
    private fun saveSnapshotThrottled(force: Boolean) {
        val model = CodeBlueController.model
        val now = System.currentTimeMillis()
        val eventCount = model.events.size
        if (!force && eventCount == lastSavedEventCount && now - lastSaveMillis < 5000) return
        lastSavedEventCount = eventCount
        lastSaveMillis = now
        runCatching { CodeBlueSessionStore.forContext(applicationContext).save(model) }
    }

    private fun startForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, buildNotif(), ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        } else {
            startForeground(NOTIF_ID, buildNotif())
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL, "Code Blue", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun buildNotif(): Notification =
        NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Code Blue active")
            .setContentText("CPR rate assist running")
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setOngoing(true)
            .build()
}
