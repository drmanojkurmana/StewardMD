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
    val cycleProgress: Float = 0f,   // 0..1 within the current 2-min rhythm-check cycle (drives the ring)
    val prompt: String = "",
    val shocks: Int = 0,
)

/**
 * Foreground service that owns the compression sensing + code timer so it survives the wrist dropping /
 * screen-off for a whole code (WatchCore used a HealthKit workout session; Wear uses a health foreground
 * service). Feeds [CompressionAnalyzer] (rate only). On start, best-effort alerts the phone Command
 * Center via /api/watch/codeblue. Screen observes [state].
 */
class CodeBlueService : Service(), SensorEventListener {

    companion object {
        private val _state = MutableStateFlow(CodeBlueUi())
        val state: StateFlow<CodeBlueUi> = _state
        private const val CHANNEL = "codeblue"
        private const val NOTIF_ID = 42

        fun start(ctx: Context) =
            ContextCompat.startForegroundService(ctx, Intent(ctx, CodeBlueService::class.java))

        fun stop(ctx: Context) = ctx.stopService(Intent(ctx, CodeBlueService::class.java))
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var sensors: SensorManager
    private val analyzer = CompressionAnalyzer()
    private val model = CodeBlueModel()

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
                model.tick(1)
                publish()
            }
        }
        publish()
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { sensors.unregisterListener(this) }
        scope.cancel()
        _state.value = CodeBlueUi(active = false)
    }

    override fun onSensorChanged(event: SensorEvent) {
        analyzer.add(event.values[2].toDouble())   // z-axis proxy; tuned on device
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    private fun publish() {
        _state.value = CodeBlueUi(
            active = true,
            rateCpm = analyzer.rateCpm,
            zone = RateCoach.zone(analyzer.rateCpm, active = !analyzer.paused),
            paused = analyzer.paused,
            elapsedSeconds = model.elapsedSeconds,
            cycle = model.cycle,
            cycleProgress = (model.elapsedSeconds % 120) / 120f,
            prompt = model.drugPrompt,
            shocks = model.shockCount,
        )
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
