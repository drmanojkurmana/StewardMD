package `in`.stewardmd.wear.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Parity of the pure doc->model mappers with icu-collab.js mapTask/mapPatientDoc. */
class IcuRepositoryTest {

    @Test
    fun mapTaskExtractsFields() {
        val t = IcuRepository.mapTask(
            "task-1",
            mapOf("text" to "ABG q6h", "status" to "pending", "assignedBy" to "docB", "ts" to 1_700_000_000_000L),
        )
        assertEquals("task-1", t.id)
        assertEquals("ABG q6h", t.text)
        assertEquals("pending", t.status)
        assertEquals("docB", t.assignedBy)
        assertEquals(1_700_000_000_000L, t.ts)
    }

    @Test
    fun mapTaskDefaultsWhenMissing() {
        val t = IcuRepository.mapTask("t2", emptyMap())
        assertEquals("t2", t.id)
        assertEquals("", t.text)
        assertEquals("pending", t.status)   // default
        assertNull(t.assignedBy)
        assertNull(t.ts)
    }

    @Test
    fun mapPatientRefExtractsAndDefaults() {
        val r = IcuRepository.mapPatientRef("p9", mapOf("name" to "S.M.", "bed" to "7", "severity" to "critical"))
        assertEquals("p9", r.pid)
        assertEquals("S.M.", r.name)
        assertEquals("7", r.bed)
        assertEquals("critical", r.severity)
        assertEquals("Patient", IcuRepository.mapPatientRef("p0", emptyMap()).name)   // default name
    }

    @Test
    fun mapPatientExtractsBoardFields() {
        val p = IcuRepository.mapPatient(
            mapOf("name" to "R.K.", "dx" to "sepsis", "bed" to "5", "severity" to "critical", "state" to mapOf<String, Any?>()),
        )
        assertEquals("R.K.", p.name)
        assertEquals("sepsis", p.dx)
        assertEquals("5", p.bed)
        assertEquals("critical", p.severity)
    }
}
