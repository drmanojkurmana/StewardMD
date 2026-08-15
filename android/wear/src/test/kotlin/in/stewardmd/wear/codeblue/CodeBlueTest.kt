package `in`.stewardmd.wear.codeblue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RateCoachTest {
    @Test fun zonesMatchAhaBand() {
        assertEquals(RateZone.TooSlow, RateCoach.zone(90, active = true))
        assertEquals(RateZone.OnTarget, RateCoach.zone(100, active = true))   // inclusive lower
        assertEquals(RateZone.OnTarget, RateCoach.zone(110, active = true))
        assertEquals(RateZone.OnTarget, RateCoach.zone(120, active = true))   // inclusive upper
        assertEquals(RateZone.TooFast, RateCoach.zone(130, active = true))
        assertEquals(RateZone.Idle, RateCoach.zone(0, active = true))
        assertEquals(RateZone.Idle, RateCoach.zone(110, active = false))
    }
}

class CompressionAnalyzerTest {
    private fun feedSine(a: CompressionAnalyzer, cpm: Int, seconds: Double, fs: Double = 50.0, amp: Double = 0.3) {
        val freq = cpm / 60.0
        val n = (seconds * fs).toInt()
        for (i in 0 until n) {
            val t = i / fs
            a.add(amp * kotlin.math.sin(2 * Math.PI * freq * t))
        }
    }

    @Test fun estimatesRateWithinBandForA110cpmSignal() {
        val a = CompressionAnalyzer(sampleRateHz = 50.0)
        feedSine(a, cpm = 110, seconds = 6.0)
        assertTrue("rate=${a.rateCpm}", a.rateCpm in 100..120)
        assertTrue("count=${a.count}", a.count >= 8)
        assertFalse(a.paused)
    }

    @Test fun reportsPauseAfterCompressionsStop() {
        val a = CompressionAnalyzer(sampleRateHz = 50.0)
        feedSine(a, cpm = 110, seconds = 4.0)
        // 3s of stillness (zeros) → paused
        repeat(150) { a.add(0.0) }
        assertTrue(a.paused)
    }
}

class CodeBlueModelTest {
    @Test fun crossesRhythmBoundaryEveryTwoMinutes() {
        val m = CodeBlueModel(cycleSeconds = 120)
        assertEquals(1, m.cycle)
        assertFalse(m.tick(119))
        assertTrue(m.tick(1))            // hits 120s → cycle 2
        assertEquals(2, m.cycle)
        assertTrue(m.tick(120))          // 240s → cycle 3
        assertEquals(3, m.cycle)
    }

    @Test fun drugPromptAlternatesByCycle() {
        val m = CodeBlueModel(cycleSeconds = 120)
        assertEquals("Adrenaline 1 mg", m.drugPrompt)          // cycle 1 (odd)
        m.tick(120)
        assertTrue(m.drugPrompt.startsWith("Amiodarone"))       // cycle 2 (even)
    }

    @Test fun tallyAndSummary() {
        val m = CodeBlueModel(cycleSeconds = 120)
        m.tick(60); m.recordShock(200); m.recordAdrenaline(); m.recordRhythm("VF")
        m.tick(60); m.recordRosc()
        val s = m.end()
        assertEquals(1, s.shockCount)
        assertEquals(1, s.adrenalineCount)
        assertTrue(s.rosc)
        assertEquals(120, s.durationSeconds)
        assertTrue(s.toDetail().contains("shocks 1"))
        assertTrue(s.toDetail().contains("ROSC"))
        assertTrue(s.events.first().kind == EventKind.Start)
        assertTrue(s.events.last().kind == EventKind.End)
    }
}
