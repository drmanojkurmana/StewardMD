package `in`.stewardmd.wear.data

import `in`.stewardmd.wear.model.PatientRef
import `in`.stewardmd.wear.model.PatientState
import `in`.stewardmd.wear.model.WatchTask
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Firestore-DIRECT ICU reads (D1): the watch subscribes to the same collections the phone does, so no
 * phone relay is needed for live state. Paths + field names mirror icu-collab.js. The doc->model
 * mappers are pure (unit-tested for parity); the snapshot/Flow wiring is thin glue, device-verified.
 */
class IcuRepository(private val db: FirebaseFirestore) {

    private fun tasksRef(gid: String, pid: String) =
        db.collection("icuGroups").document(gid).collection("patients").document(pid).collection("tasks")

    private fun patientRef(gid: String, pid: String) =
        db.collection("icuGroups").document(gid).collection("patients").document(pid)

    /** Live tasks for a patient, newest first (mirrors subscribeTasks: orderBy ts desc). */
    fun tasks(gid: String, pid: String): Flow<List<WatchTask>> = callbackFlow {
        val reg = tasksRef(gid, pid).orderBy("ts", Query.Direction.DESCENDING)
            .addSnapshotListener { snap, err ->
                if (err != null) { trySend(emptyList()); return@addSnapshotListener }
                trySend(snap?.documents?.map { mapTask(it.id, it.data ?: emptyMap()) } ?: emptyList())
            }
        awaitClose { reg.remove() }
    }

    /** The gids of the ICU units I'm a member of (collectionGroup members where uid == me). */
    fun myGroupIds(uid: String): Flow<List<String>> = callbackFlow {
        val reg = db.collectionGroup("members").whereEqualTo("uid", uid).addSnapshotListener { snap, err ->
            if (err != null || snap == null) { trySend(emptyList()); return@addSnapshotListener }
            trySend(snap.documents.mapNotNull { it.reference.parent.parent?.id }.distinct())
        }
        awaitClose { reg.remove() }
    }

    /** Live patient list for a unit (for the picker feeding Tasks/Handover). */
    fun patientRefs(gid: String): Flow<List<PatientRef>> = callbackFlow {
        val reg = db.collection("icuGroups").document(gid).collection("patients").addSnapshotListener { snap, err ->
            if (err != null || snap == null) { trySend(emptyList()); return@addSnapshotListener }
            trySend(snap.documents.map { mapPatientRef(it.id, it.data ?: emptyMap()) })
        }
        awaitClose { reg.remove() }
    }

    /** Live patient board doc, or null if it's gone (discharged). */
    fun patient(gid: String, pid: String): Flow<PatientState?> = callbackFlow {
        val reg = patientRef(gid, pid).addSnapshotListener { snap, err ->
            if (err != null) { trySend(null); return@addSnapshotListener }
            trySend(if (snap != null && snap.exists()) mapPatient(snap.data ?: emptyMap()) else null)
        }
        awaitClose { reg.remove() }
    }

    companion object {
        private fun tsMillis(v: Any?): Long? = when (v) {
            is Timestamp -> v.toDate().time
            is Long -> v
            is Number -> v.toLong()
            else -> null
        }

        fun mapTask(id: String, data: Map<String, Any?>): WatchTask = WatchTask(
            id = id,
            text = (data["text"] as? String).orEmpty(),
            status = (data["status"] as? String) ?: "pending",
            assignedBy = data["assignedBy"] as? String,
            ts = tsMillis(data["ts"]),
        )

        fun mapPatient(data: Map<String, Any?>): PatientState = PatientState(
            name = data["name"] as? String,
            dx = data["dx"] as? String,
            bed = data["bed"] as? String,
            severity = data["severity"] as? String,
        )

        fun mapPatientRef(id: String, data: Map<String, Any?>): PatientRef = PatientRef(
            pid = id,
            name = (data["name"] as? String) ?: "Patient",
            bed = data["bed"] as? String,
            severity = data["severity"] as? String,
        )
    }
}
