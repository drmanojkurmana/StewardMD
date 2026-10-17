package `in`.stewardmd.wear.codeblue

/**
 * Single owner of the live code state, shared by [CodeBlueService] (sensor + timer) and the
 * Compose UI (actions). Pure Kotlin, no Android dependencies, so the UI can act without binding.
 * The service republishes [CodeBlueService.state] every second, which is also when snapshots save.
 */
object CodeBlueController {
    @Volatile
    var model: CodeBlueModel = CodeBlueModel()
        private set

    @Volatile
    var analyzer: CompressionAnalyzer = CompressionAnalyzer()
        private set

    fun startNew(mode: CodeMode) {
        model = CodeBlueModel(mode)
        analyzer = CompressionAnalyzer()
    }

    fun restore(snap: SessionSnapshot, nowWallClock: Long): Boolean {
        val fresh = CodeBlueModel()
        if (!fresh.restoreFrom(snap, nowWallClock)) return false
        model = fresh
        analyzer = CompressionAnalyzer()
        return true
    }

    fun discard() {
        model = CodeBlueModel()
        analyzer = CompressionAnalyzer()
    }
}
