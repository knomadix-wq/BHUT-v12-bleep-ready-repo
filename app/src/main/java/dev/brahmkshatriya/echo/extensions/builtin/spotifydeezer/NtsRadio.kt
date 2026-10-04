package dev.brahmkshatriya.echo.extensions.builtin.spotifydeezer

internal fun ntsRadioSearchQuery(title: String, genres: List<String>): String =
    (listOf(title.trim()) + genres.map { it.trim().lowercase() })
        .filter { it.isNotBlank() }
        .distinct()
        .take(4)
        .joinToString(" ")
