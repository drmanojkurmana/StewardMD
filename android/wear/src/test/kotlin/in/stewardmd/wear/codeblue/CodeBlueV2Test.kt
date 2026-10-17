package `in`.stewardmd.wear.codeblue

import android.content.SharedPreferences
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CodeModeTest {
    @Test fun rhythmIntervalsPerMode() {
        assertEquals(120, CodeMode.Adult.rhythmCheckSeconds)
        assertEquals(120, CodeMode.Paediatric.rhythmCheckSeconds)
        assertEquals(60, CodeMode.Neonatal.rhythmCheckSeconds)
    }

    @Test fun compressionLabelsMatchSpec() {
        assertEquals("30:2 (100 to 120 per min)", CodeMode.Adult.compressionLabel)
        assertEquals("15:2 with two rescuers, 30:2 alone", CodeMode.Paediatric.compressionLabel)
        assertEquals("3:1 (90 compressions and 30 breaths per min)", CodeMode.Neonatal.compressionLabel)
    }

    @Test fun neonatalCrossesRhythmBoundaryAtSixtySeconds() {
        val m = CodeBlueModel(CodeMode.Neonatal)
        assertFalse(m.tick(59))
        assertTrue(m.tick(1))
        assertEquals(2, m.cycle)
    }

    @Test fun setModeLogsModeSetAndUpdatesInterval() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.tick(30)
        m.setMode(CodeMode.Neonatal)
        assertEquals(CodeMode.Neonatal, m.mode)
        assertTrue(m.events.any { it.kind == EventKind.ModeSet && it.text.contains("Neonatal") })
        assertFalse(m.tick(29))
        assertTrue(m.tick(30))
    }

    @Test fun advancedAirwayChangesCompressionLabelForAdultAndPaediatric() {
        val adult = CodeBlueModel(CodeMode.Adult)
        assertEquals("30:2 (100 to 120 per min)", adult.compressionLabel())
        adult.recordProcedure("Advanced airway")
        assertTrue(adult.advancedAirway)
        assertEquals(ADVANCED_AIRWAY_LABEL, adult.compressionLabel())

        val neo = CodeBlueModel(CodeMode.Neonatal)
        neo.recordProcedure("Advanced airway")
        assertEquals("3:1 (90 compressions and 30 breaths per min)", neo.compressionLabel())
    }
}

class EpiTimerTest {
    @Test fun countdownStartsAtFirstDose() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.tick(500)
        assertEquals(EpiStatus.NotStarted, m.epiStatus)
        assertEquals("Epinephrine not yet given", m.epiLabel())
        m.recordAdrenaline()
        assertEquals(EpiStatus.Countdown, m.epiStatus)
        assertTrue(m.epiLabel().startsWith("Epinephrine in "))
    }

    @Test fun dueAtThreeMinutesOverdueAtFive() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.recordAdrenaline()
        m.tick(179)
        assertEquals(EpiStatus.Countdown, m.epiStatus)
        m.tick(1)
        assertEquals(EpiStatus.Due, m.epiStatus)
        assertEquals("Epinephrine due", m.epiLabel())
        m.tick(120)
        assertEquals(EpiStatus.Overdue, m.epiStatus)
        assertEquals("Epinephrine overdue", m.epiLabel())
    }
}

class EventJsonTest {
    @Test fun oldEventJsonDecodesWithEditedFalse() {
        val old = """{"seq":1,"elapsedSeconds":5,"kind":"shock","text":"Shock #1"}"""
        val e = CodeBlueJson.decodeFromString(CodeEvent.serializer(), old)
        assertEquals(EventKind.Shock, e.kind)
        assertFalse(e.edited)
    }

    @Test fun allLegacyKindsStillDecode() {
        for ((wire, kind) in mapOf(
            "cprStart" to EventKind.Start, "rhythm" to EventKind.Rhythm,
            "shock" to EventKind.Shock, "drug" to EventKind.Drug,
            "rosc" to EventKind.Rosc, "cprEnd" to EventKind.End,
        )) {
            val e = CodeBlueJson.decodeFromString(
                CodeEvent.serializer(),
                """{"seq":1,"elapsedSeconds":0,"kind":"$wire","text":"x"}""",
            )
            assertEquals(kind, e.kind)
        }
    }

    @Test fun newKindsRoundTrip() {
        for (kind in listOf(EventKind.Procedure, EventKind.ReArrest, EventKind.Note, EventKind.ModeSet)) {
            val e = CodeEvent(1, 0, kind, "x")
            val back = CodeBlueJson.decodeFromString(CodeEvent.serializer(), CodeBlueJson.encodeToString(CodeEvent.serializer(), e))
            assertEquals(kind, back.kind)
        }
    }

    @Test fun kindSerialNamesMatchSpec() {
        assertEquals("cprStart", kindSerial(EventKind.Start))
        assertEquals("pauseStart", kindSerial(EventKind.PauseStart))
        assertEquals("switchCompressor", kindSerial(EventKind.SwitchCompressor))
        assertEquals("reArrest", kindSerial(EventKind.ReArrest))
        assertEquals("modeSet", kindSerial(EventKind.ModeSet))
    }
}

class ProcedureLogTest {
    @Test fun fixedVocabularyIsLogged() {
        val m = CodeBlueModel(CodeMode.Adult)
        for (label in PROCEDURE_LABELS) m.recordProcedure(label)
        val logged = m.events.filter { it.kind == EventKind.Procedure }.map { it.text }
        assertEquals(PROCEDURE_LABELS, logged)
    }

    @Test fun pauseResumeSwitchAndNoteAreLogged() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.recordPause(); m.recordResume(); m.recordSwitchCompressor(); m.recordNote("Airway reassessed")
        val kinds = m.events.map { it.kind }
        assertTrue(kinds.contains(EventKind.PauseStart))
        assertTrue(kinds.contains(EventKind.Resume))
        assertTrue(kinds.contains(EventKind.SwitchCompressor))
        assertTrue(kinds.contains(EventKind.Note))
    }
}

class AlgorithmGuideTest {
    private fun assertNoDoses(prompts: List<GuidePrompt>) {
        for (p in prompts) {
            assertFalse("dose in: ${p.text}", p.text.contains("mg"))
            assertTrue("missing source: ${p.id}", p.source.isNotBlank())
        }
    }

    @Test fun shockableTrackEscalates() {
        val base = GuideInput(CodeMode.Adult, "VF", 0, 0, null, false)
        val first = AlgorithmGuide.prompts(base)
        assertTrue(first.any { it.id == "shock" && it.urgency == GuideUrgency.Due })
        assertNoDoses(first)

        val afterSecond = AlgorithmGuide.prompts(base.copy(shockCount = 2))
        assertTrue(afterSecond.any { it.id == "epi-indicated" && it.urgency == GuideUrgency.Due })

        val afterThird = AlgorithmGuide.prompts(base.copy(shockCount = 3, epiCount = 2, secondsSinceEpi = 10))
        assertTrue(afterThird.any { it.id == "antiarrhythmic" })
        assertTrue(afterThird.any { it.id == "hsts" })
        assertTrue(afterThird.all { it.source == "AHA 2020 adult cardiac arrest algorithm" })
        assertNoDoses(afterThird)
    }

    @Test fun nonShockableWantsEpiAtOnce() {
        val prompts = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "Asystole", 0, 0, null, false))
        assertTrue(prompts.any { it.id == "epi-indicated" && it.urgency == GuideUrgency.Due })
        assertNoDoses(prompts)
    }

    @Test fun epiTimingPromptsFollowThreeToFiveMinuteRule() {
        val soon = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "PEA", 0, 1, 60, false))
        assertTrue(soon.any { it.id == "epi-countdown" && it.urgency == GuideUrgency.Info })
        val due = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "PEA", 0, 1, 200, false))
        assertTrue(due.any { it.id == "epi-overdue" || it.id == "epi-due" })
        val over = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "PEA", 0, 1, 320, false))
        assertTrue(over.any { it.id == "epi-overdue" && it.urgency == GuideUrgency.Overdue })
    }

    @Test fun neonatalArrestLeadsWithVentilation() {
        val prompts = AlgorithmGuide.prompts(GuideInput(CodeMode.Neonatal, "PEA", 0, 0, null, false))
        assertEquals("neo-vent", prompts.first().id)
        assertTrue(prompts.first().source.contains("NRP"))
        assertTrue(prompts.any { it.text.contains("30 seconds of effective ventilation") })
    }

    @Test fun bradycardiaTracksDifferByMode() {
        val adult = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "Bradycardia (pulse)", 0, 0, null, false))
        assertTrue(adult.any { it.text.contains("poor perfusion") })
        val paed = AlgorithmGuide.prompts(GuideInput(CodeMode.Paediatric, "Bradycardia (pulse)", 0, 0, null, false))
        assertTrue(paed.any { it.id == "brady-paed-cpr" })
        assertNoDoses(adult + paed)
    }

    @Test fun tachycardiaCoversAllBranches() {
        val prompts = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "Tachycardia (pulse)", 0, 0, null, false))
        val texts = prompts.map { it.text }
        assertTrue(texts.any { it.contains("synchronised cardioversion") })
        assertTrue(texts.any { it.contains("vagal") })
        assertTrue(texts.any { it.contains("expert consultation") })
    }

    @Test fun postRoscTrack() {
        val adult = AlgorithmGuide.prompts(GuideInput(CodeMode.Adult, "VF", 2, 2, 60, true))
        assertTrue(adult.any { it.text.contains("92 to 98") })
        val neo = AlgorithmGuide.prompts(GuideInput(CodeMode.Neonatal, "PEA", 0, 1, 60, true))
        assertTrue(neo.any { it.id == "post-parents" })
    }
}

class PostRoscChecklistTest {
    @Test fun adultListHasNineItemsNeonatalFive() {
        assertEquals(9, PostRoscChecklist.items(CodeMode.Adult).size)
        assertEquals(9, PostRoscChecklist.items(CodeMode.Paediatric).size)
        assertEquals(5, PostRoscChecklist.items(CodeMode.Neonatal).size)
    }

    @Test fun tickLogsNoteEvent() {
        val m = CodeBlueModel(CodeMode.Adult)
        val item = PostRoscChecklist.items(CodeMode.Adult).first()
        assertTrue(m.tickChecklist(item))
        assertTrue(m.checklistTicks.contains(item.id))
        val note = m.events.last()
        assertEquals(EventKind.Note, note.kind)
        assertTrue(note.text.contains(item.text))
    }

    @Test fun unknownItemRejected() {
        val m = CodeBlueModel(CodeMode.Adult)
        assertFalse(m.tickChecklist(ChecklistItem("nope", "Nope")))
    }
}

class RearrestTest {
    @Test fun clearsRoscStartsNewCycleKeepsEpiTimer() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.recordAdrenaline()
        m.tick(100)
        m.recordRosc()
        assertTrue(m.rosc)
        m.tick(50)
        val sinceEpi = m.secondsSinceEpi
        m.recordRearrest()
        assertFalse(m.rosc)
        assertEquals(1, m.cycle)
        assertEquals(sinceEpi, m.secondsSinceEpi)
        assertTrue(m.events.any { it.kind == EventKind.ReArrest })
        assertFalse(m.tick(119))
        assertTrue(m.tick(1))
    }
}

class EditableLogTest {
    @Test fun editKeepsElapsedAndMarksEdited() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.tick(42)
        m.recordRhythm("VF")
        val seq = m.events.last().seq
        assertTrue(m.editEvent(seq, "VT (pulseless)"))
        val e = m.events.first { it.seq == seq }
        assertEquals("VT (pulseless)", e.text)
        assertEquals(42, e.elapsedSeconds)
        assertTrue(e.edited)
        assertEquals("VT (pulseless)", m.lastRhythmLabel)
    }

    @Test fun deleteRemovesAndUndoRestoresWithCountsRecomputed() {
        val m = CodeBlueModel(CodeMode.Adult)
        m.recordShock()
        m.recordAdrenaline()
        assertEquals(1, m.shockCount)
        val shockSeq = m.events.first { it.kind == EventKind.Shock }.seq
        assertTrue(m.deleteEvent(shockSeq))
        assertEquals(0, m.shockCount)
        assertTrue(m.events.none { it.seq == shockSeq })
        assertTrue(m.hasDeletedToUndo())
        assertTrue(m.undoDelete())
        assertEquals(1, m.shockCount)
        assertFalse(m.hasDeletedToUndo())
        assertFalse(m.undoDelete())
    }

    @Test fun unknownSeqFails() {
        val m = CodeBlueModel(CodeMode.Adult)
        assertFalse(m.editEvent(999, "x"))
        assertFalse(m.deleteEvent(999))
    }
}

private class FakePrefs : SharedPreferences {
    val map = mutableMapOf<String, String?>()
    override fun getString(key: String, defValue: String?): String? = if (map.containsKey(key)) map[key] else defValue
    override fun edit(): SharedPreferences.Editor = FakeEditor()
    inner class FakeEditor : SharedPreferences.Editor {
        override fun putString(key: String, value: String?): SharedPreferences.Editor { map[key] = value; return this }
        override fun remove(key: String): SharedPreferences.Editor { map.remove(key); return this }
        override fun apply() {}
        override fun commit(): Boolean = true
        override fun clear(): SharedPreferences.Editor { map.clear(); return this }
        override fun putStringSet(key: String, values: MutableSet<String>?): SharedPreferences.Editor = this
        override fun putInt(key: String, value: Int): SharedPreferences.Editor = this
        override fun putLong(key: String, value: Long): SharedPreferences.Editor = this
        override fun putFloat(key: String, value: Float): SharedPreferences.Editor = this
        override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor = this
    }
    override fun getAll(): MutableMap<String, *> = mutableMapOf<String, Any>()
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
    override fun getInt(key: String, defValue: Int): Int = defValue
    override fun getLong(key: String, defValue: Long): Long = defValue
    override fun getFloat(key: String, defValue: Float): Float = defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = defValue
    override fun contains(key: String): Boolean = map.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
}

class SessionSnapshotTest {
    @Test fun saveAndRestoreAdvancesElapsedWhileRunning() {
        val prefs = FakePrefs()
        var now = 1_000_000L
        val store = CodeBlueSessionStore(prefs, CodeBlueClock { now })
        val m = CodeBlueModel(CodeMode.Paediatric, startedAtWallClock = now - 300_000L)
        m.tick(300)
        m.recordShock()
        m.recordAdrenaline()
        m.tickChecklist(PostRoscChecklist.items(CodeMode.Paediatric).first())
        store.save(m)

        now += 90_000L // 90 s later
        val snap = store.loadRestorable()
        assertNotNull(snap)
        val fresh = CodeBlueModel()
        assertTrue(fresh.restoreFrom(snap!!, now))
        assertEquals(CodeMode.Paediatric, fresh.mode)
        assertEquals(390, fresh.elapsedSeconds)
        assertEquals(1, fresh.shockCount)
        assertEquals(1, fresh.adrenalineCount)
        assertEquals(90, fresh.secondsSinceEpi)
        assertTrue(fresh.checklistTicks.isNotEmpty())
    }

    @Test fun snapshotOlderThanSixHoursIsDiscarded() {
        val prefs = FakePrefs()
        var now = 1_000_000L
        val store = CodeBlueSessionStore(prefs, CodeBlueClock { now })
        store.save(CodeBlueModel(CodeMode.Adult))
        now += SessionSnapshot.MAX_AGE_MILLIS + 1_000L
        assertNull(store.loadRestorable())
        val fresh = CodeBlueModel()
        val stale = SessionSnapshot(savedAtWallClock = 1_000_000L, elapsedAtSave = 10)
        assertFalse(fresh.restoreFrom(stale, now))
        assertEquals(0, fresh.elapsedSeconds)
    }

    @Test fun snapshotRoundTripsNewEventKinds() {
        val m = CodeBlueModel(CodeMode.Neonatal)
        m.recordProcedure("Pads on")
        m.recordNote("hello")
        val raw = CodeBlueJson.encodeToString(SessionSnapshot.serializer(), SessionSnapshot(events = m.events.toList()))
        val back = CodeBlueJson.decodeFromString(SessionSnapshot.serializer(), raw)
        assertEquals(m.events, back.events)
    }
}

class CodeSheetTest {
    @Test fun v2JsonPayloadShape() {
        val m = CodeBlueModel(CodeMode.Adult, startedAtWallClock = 1_700_000_000_000L)
        m.tick(61)
        m.recordShock()
        m.recordRhythm("VF")
        m.editEvent(m.events.last().seq, "VT (pulseless)")
        val el = CodeBlueJson.parseToJsonElement(codeSheetJson(m, SheetMetrics(compressions = 120, averageRateCPM = 110))).jsonObject
        assertEquals(2, el["v"]!!.jsonPrimitive.int)
        assertEquals("adult", el["mode"]!!.jsonPrimitive.content)
        assertTrue(el["startedAt"]!!.jsonPrimitive.content.startsWith("2023"))
        assertEquals(61, el["durationSeconds"]!!.jsonPrimitive.int)
        val events = el["events"]!!.jsonArray
        assertTrue(events.size >= 3)
        assertTrue(events.any { it.jsonObject["kind"]!!.jsonPrimitive.content == "shock" })
        val first = events[0].jsonObject
        assertTrue(first.containsKey("id") && first.containsKey("elapsed") && first.containsKey("kind") && first.containsKey("label") && first.containsKey("edited"))
        val edited = events.first { it.jsonObject["label"]!!.jsonPrimitive.content == "VT (pulseless)" }.jsonObject
        assertEquals(true, edited["edited"]!!.jsonPrimitive.boolean)
        val summary = el["summary"]!!.jsonObject
        for (k in listOf("compressions", "averageRateCPM", "compressionFractionPct", "targetRatePct", "shockCount", "adrenalineCount", "rosc")) {
            assertTrue("missing $k", summary.containsKey(k))
        }
        assertEquals(120, summary["compressions"]!!.jsonPrimitive.int)
        assertEquals(MOTION_DISCLAIMER, el["disclaimer"]!!.jsonPrimitive.content)
    }

    @Test fun plainTextSheetCarriesBothDisclaimers() {
        val m = CodeBlueModel(CodeMode.Paediatric)
        m.tick(5)
        m.recordRosc()
        val text = codeSheetText(m)
        assertTrue(text.contains("Paediatric"))
        assertTrue(text.contains(CODE_BLUE_DISCLAIMER))
        assertTrue(text.contains(MOTION_DISCLAIMER))
        assertFalse(text.contains("mg"))
    }

    @Test fun drugPromptNeverShowsAdultDoseOutsideAdultMode() {
        val m = CodeBlueModel()
        m.setMode(CodeMode.Paediatric)
        assertFalse(m.drugPrompt.contains(" mg"))
        m.setMode(CodeMode.Neonatal)
        assertFalse(m.drugPrompt.contains(" mg"))
        m.setMode(CodeMode.Adult)
        assertTrue(m.drugPrompt.contains("1 mg"))
    }
}
