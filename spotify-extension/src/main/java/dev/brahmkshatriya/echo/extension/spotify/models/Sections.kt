package dev.brahmkshatriya.echo.extension.spotify.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
data class Sections(
    @Serializable(with = TolerantSectionItemListSerializer::class)
    val items: List<SectionItem> = emptyList(),
    val pagingInfo: PagingInfo? = null,
    val totalCount: Long? = null
) {

    @Serializable
    data class Container(
        val sections: Sections,
        val uri: String? = null
    )

    @Serializable
    data class SectionItem(
        @SerialName("__typename")
        val typename: String? = null,

        val data: Data? = null,
        val sectionItems: Items? = null,
        val targetLocation: String? = null,
        val uri: String? = null
    )

    @Serializable
    data class Data(
        @SerialName("__typename")
        val rawTypename: String? = null,

        val subtitle: Title? = null,
        val title: Title? = null
    ) {
        val typename: Typename?
            get() = rawTypename?.let(Typename::fromWireName)
    }

    @Serializable
    enum class Typename {
        HomeShortsSectionData,
        HomeGenericSectionData,
        HomeFeedBaselineSectionData,
        HomeRecentlyPlayedSectionData,
        HomeSpotlightSectionData,
        HomeOnboardingSectionDataV2,
        HomeWatchFeedSectionData,
        BrowseGenericSectionData,
        BrowseGridSectionData,
        BrowseUnsupportedSectionData,
        BrowseRelatedSectionData,
        HomeNativeAdsSectionData,
        HomeYourDJSectionData,
        Unknown;

        companion object {
            fun fromWireName(value: String): Typename =
                entries.firstOrNull { it != Unknown && it.name == value } ?: Unknown
        }
    }

    @Serializable
    data class Items(
        @Serializable(with = TolerantItemsItemListSerializer::class)
        val items: List<ItemsItem> = emptyList(),
        val pagingInfo: PagingInfo? = null,
        val totalCount: Long? = null
    )

    @Serializable
    data class ItemsItem(
        val content: Item.Wrapper,
        val uri: String
    )
}

private object TolerantSectionItemListSerializer : KSerializer<List<Sections.SectionItem>> {
    private val delegate = ListSerializer(Sections.SectionItem.serializer())
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): List<Sections.SectionItem> {
        val jsonDecoder = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val array = jsonDecoder.decodeJsonElement() as? JsonArray ?: return emptyList()
        return array.mapIndexedNotNull { index, element ->
            runCatching {
                jsonDecoder.json.decodeFromJsonElement(Sections.SectionItem.serializer(), element)
            }.onFailure {
                System.err.println(
                    "SpotifyHome: skipping malformed section index=$index " +
                        "error=${it.message} payload=${element.toString().take(500)}"
                )
            }.getOrNull()
        }
    }

    override fun serialize(encoder: Encoder, value: List<Sections.SectionItem>) {
        val jsonEncoder = encoder as? JsonEncoder
        if (jsonEncoder == null) delegate.serialize(encoder, value)
        else jsonEncoder.encodeSerializableValue(delegate, value)
    }
}

private object TolerantItemsItemListSerializer : KSerializer<List<Sections.ItemsItem>> {
    private val delegate = ListSerializer(Sections.ItemsItem.serializer())
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): List<Sections.ItemsItem> {
        val jsonDecoder = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val array = jsonDecoder.decodeJsonElement() as? JsonArray ?: return emptyList()
        return array.mapIndexedNotNull { index, element ->
            runCatching {
                jsonDecoder.json.decodeFromJsonElement(Sections.ItemsItem.serializer(), element)
            }.onFailure {
                System.err.println(
                    "SpotifyHome: skipping malformed card index=$index " +
                        "error=${it.message} payload=${element.toString().take(500)}"
                )
            }.getOrNull()
        }
    }

    override fun serialize(encoder: Encoder, value: List<Sections.ItemsItem>) {
        val jsonEncoder = encoder as? JsonEncoder
        if (jsonEncoder == null) delegate.serialize(encoder, value)
        else jsonEncoder.encodeSerializableValue(delegate, value)
    }
}
