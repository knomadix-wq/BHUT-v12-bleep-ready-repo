package dev.brahmkshatriya.echo.extension.spotify

import kotlinx.serialization.json.Json

class Json {
    val parser = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        isLenient = true
        explicitNulls = false
    }

    inline fun <reified T> encode(data: T) = parser.encodeToString(data)
    inline fun <reified T> decode(data: String) =
        runCatching { parser.decodeFromString<T>(data) }
            .getOrElse { decodingFailure(data, it) }

    @PublishedApi
    internal fun decodingFailure(data: String, cause: Throwable): Nothing {
        val offset = Regex("offset (\\d+)").find(cause.message.orEmpty())
            ?.groupValues?.getOrNull(1)?.toIntOrNull()
        val context = offset?.let {
            data.substring((it - 160).coerceAtLeast(0), (it + 160).coerceAtMost(data.length))
        } ?: data.take(320)
        System.err.println(
            "SpotifyJson: decode failed type=${cause::class.simpleName} offset=$offset " +
                "length=${data.length} context=$context"
        )
        throw DecodeException(cause)
    }

    class DecodeException(cause: Throwable) : Exception(
        "Spotify returned a malformed or changed response. Refresh to try again.", cause
    )
}
