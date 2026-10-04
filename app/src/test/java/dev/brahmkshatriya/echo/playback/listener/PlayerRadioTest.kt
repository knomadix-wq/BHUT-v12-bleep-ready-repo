package dev.brahmkshatriya.echo.playback.listener

import androidx.media3.common.Player.REPEAT_MODE_OFF
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerRadioTest {
    @Test
    fun `last track of curated album starts autoplay without waiting through album`() {
        assertTrue(shouldAutoStartRadio(hasCurrentItem = true, repeatMode = REPEAT_MODE_OFF, hasNextItem = false))
    }

    @Test
    fun `curated album does not start autoplay before its last track`() {
        assertFalse(shouldAutoStartRadio(hasCurrentItem = true, repeatMode = REPEAT_MODE_OFF, hasNextItem = true))
    }
}
