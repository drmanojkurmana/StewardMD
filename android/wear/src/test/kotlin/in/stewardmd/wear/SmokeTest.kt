package `in`.stewardmd.wear

import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SmokeTest {
    @Test
    fun launches() {
        val c = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        assertNotNull(c)
    }
}
