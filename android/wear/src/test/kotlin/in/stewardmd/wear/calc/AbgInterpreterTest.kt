package `in`.stewardmd.wear.calc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Parity with WatchCore ABGInterpreter. */
class AbgInterpreterTest {

    @Test fun metabolicAcidosisWithPartialRespCompAndRaisedGap() {
        val r = AbgInterpreter.interpret(pH = 7.20, pCO2 = 30.0, hco3 = 12.0, units = PCO2Unit.MMHG, na = 140.0, cl = 100.0)
        assertEquals(Disorder.METABOLIC_ACIDOSIS, r.primary)
        assertEquals(Compensation.PARTIAL, r.compensation)   // pCO2 30 < 35 lower bound
        assertEquals(28.0, r.anionGap)                       // 140 - (100 + 12)
        assertTrue(r.raisedAnionGap)                         // > 12
    }

    @Test fun respiratoryAcidosisUncompensated() {
        val r = AbgInterpreter.interpret(pH = 7.30, pCO2 = 60.0, hco3 = 24.0, units = PCO2Unit.MMHG)
        assertEquals(Disorder.RESPIRATORY_ACIDOSIS, r.primary)
        assertEquals(Compensation.NONE, r.compensation)
        assertNull(r.anionGap)
    }

    @Test fun normalGas() {
        val r = AbgInterpreter.interpret(pH = 7.40, pCO2 = 40.0, hco3 = 24.0, units = PCO2Unit.MMHG)
        assertEquals(Disorder.NORMAL, r.primary)
        assertEquals(Compensation.NONE, r.compensation)
        assertFalse(r.raisedAnionGap)
    }

    @Test fun metabolicAlkalosis() {
        val r = AbgInterpreter.interpret(pH = 7.50, pCO2 = 40.0, hco3 = 32.0, units = PCO2Unit.MMHG)
        assertEquals(Disorder.METABOLIC_ALKALOSIS, r.primary)
    }
}
