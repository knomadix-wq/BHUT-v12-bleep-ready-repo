package dev.brahmkshatriya.echo.extension.spotify.models

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class SectionsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun unknownSectionTypenameDecodesAsFallbackWithoutLosingRawValue() {
        val payload = """
            {
              "items": [{
                "__typename": "HomeSection",
                "uri": "spotify:section:promotion",
                "data": {
                  "__typename": "HomePromotionSectionDataV99",
                  "title": { "transformedLabel": "A new Spotify section" }
                }
              }]
            }
        """.trimIndent()

        val section = json.decodeFromString<Sections>(payload).items!!.single()

        assertEquals(Sections.Typename.Unknown, section.data!!.typename)
        assertEquals("HomePromotionSectionDataV99", section.data.rawTypename)
    }

    @Test
    fun supportedSectionTypenameKeepsExistingMapping() {
        val payload = """
            {"items":[{"data":{"__typename":"HomeGenericSectionData"}}]}
        """.trimIndent()

        val data = json.decodeFromString<Sections>(payload).items!!.single().data!!

        assertEquals(Sections.Typename.HomeGenericSectionData, data.typename)
        assertEquals("HomeGenericSectionData", data.rawTypename)
    }

    @Test
    fun malformedSectionIsSkippedWithoutLosingValidSections() {
        val payload = """
            {
              "items": [
                {"data": "spotify-changed-this-object"},
                {"uri":"spotify:section:valid","data":{"__typename":"HomeGenericSectionData"}}
              ]
            }
        """.trimIndent()

        val sections = json.decodeFromString<Sections>(payload).items

        assertEquals(1, sections.size)
        assertEquals("spotify:section:valid", sections.single().uri)
    }

    @Test
    fun malformedCardsAreSkippedInsteadOfFailingTheirSection() {
        val payload = """
            {
              "items": [{
                "uri":"spotify:section:test",
                "data":{"__typename":"HomeGenericSectionData"},
                "sectionItems":{"items":[{"content":"unexpected","uri":"bad"}]}
              }]
            }
        """.trimIndent()

        val section = json.decodeFromString<Sections>(payload).items.single()

        assertEquals(0, section.sectionItems!!.items.size)
    }
}
