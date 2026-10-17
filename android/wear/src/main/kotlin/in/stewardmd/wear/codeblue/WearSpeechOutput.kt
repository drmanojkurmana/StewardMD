package `in`.stewardmd.wear.codeblue

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * TextToSpeech backed [SpeechOutput] for the cue engine. British English voice preferred,
 * design section 5. Falls back to a haptic tick when the engine is not ready yet. Ticks that
 * carry no text never reach speech: the caller routes those to [tick] directly.
 *
 * Minimal UI hook: the code blue screen creates one of these, passes it to [CueAnnouncer],
 * and routes haptic fallback to [tick].
 */
class WearSpeechOutput(
    context: Context,
    private val vibrator: Vibrator? = context.systemVibrator(),
    private val onSpokenFallback: () -> Unit = { vibrator?.let { tick(it) } },
) : SpeechOutput, TextToSpeech.OnInitListener {

    private val tts = TextToSpeech(context.applicationContext, this)

    @Volatile
    private var ready = false

    override val canSpeak: Boolean get() = ready

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts.language = Locale.UK
            ready = true
        }
    }

    override fun speak(text: String) {
        if (ready) {
            tts.speak(text, TextToSpeech.QUEUE_ADD, null, "codeblue-cue")
        } else {
            onSpokenFallback()
        }
    }

    fun shutdown() {
        tts.shutdown()
    }

    companion object {
        /** Short haptic tick for metronome and breath cues, and for speech fallback. */
        fun tick(vibrator: Vibrator) {
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(25)
            }
        }

        private fun Context.systemVibrator(): Vibrator? =
            if (Build.VERSION.SDK_INT >= 31) {
                getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
    }
}
