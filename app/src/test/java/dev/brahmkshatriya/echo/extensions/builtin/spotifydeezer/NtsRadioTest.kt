package dev.brahmkshatriya.echo.extensions.builtin.spotifydeezer

import org.junit.Assert.assertEquals
import org.junit.Test

class NtsRadioTest {
    @Test
    fun `NTS Spotify seed query includes show identity and useful genres`() {
        assertEquals(
            "Moxie jungle techno",
            ntsRadioSearchQuery("Moxie", listOf("Jungle", "Techno", "Jungle")),
        )
    }
}
