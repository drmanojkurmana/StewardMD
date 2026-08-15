package `in`.stewardmd.wear.ui

import `in`.stewardmd.wear.model.Patient
import `in`.stewardmd.wear.model.WatchStatus

/**
 * DEBUG-ONLY demo mode. Lets the watch UI be exercised on an emulator, where Google Sign-In is
 * impossible (the Clockwork GmsCore image ships no auth.api.identity signin service). When enabled it
 * bypasses [AuthGate] and feeds sample (NON-PHI, obviously fake) data so every screen renders.
 *
 * Guarded twice so it can NEVER reach production:
 *   1. [MainActivity] only sets [enabled] = true when the build is debuggable (FLAG_DEBUGGABLE), AND
 *   2. the runtime flag `settings put global smd_wear_demo 1` is set on the device.
 * Release builds are not debuggable, so [enabled] is always false there regardless of the setting.
 */
object Demo {
    @Volatile
    var enabled: Boolean = false

    val patients: List<Patient> = listOf(
        Patient(patientId = "demo-1", name = "A. Kumar (demo)", bedName = "4", deptDescription = "MICU"),
        Patient(patientId = "demo-2", name = "S. Rao (demo)", bedName = "7", deptDescription = "MICU"),
        Patient(patientId = "demo-3", name = "R. Iyer (demo)", bedName = "2", deptDescription = "SICU"),
    )

    val watchStatus: WatchStatus = WatchStatus(consented = true, watching = patients)
}
