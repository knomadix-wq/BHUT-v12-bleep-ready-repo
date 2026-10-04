package dev.brahmkshatriya.echo.extensions.builtin.download

import android.content.Context
import dev.brahmkshatriya.echo.BuildConfig
import dev.brahmkshatriya.echo.common.MusicExtension
import dev.brahmkshatriya.echo.common.clients.AlbumClient
import dev.brahmkshatriya.echo.common.clients.DownloadClient
import dev.brahmkshatriya.echo.common.clients.ExtensionClient
import dev.brahmkshatriya.echo.common.clients.PlaylistClient
import dev.brahmkshatriya.echo.common.helpers.ContinuationCallback.Companion.await
import dev.brahmkshatriya.echo.common.models.Album
import dev.brahmkshatriya.echo.common.models.DownloadContext
import dev.brahmkshatriya.echo.common.models.EchoMediaItem
import dev.brahmkshatriya.echo.common.models.ExtensionType
import dev.brahmkshatriya.echo.common.models.Feed.Companion.loadAll
import dev.brahmkshatriya.echo.common.models.ImportType
import dev.brahmkshatriya.echo.common.models.Metadata
import dev.brahmkshatriya.echo.common.models.Playlist
import dev.brahmkshatriya.echo.common.models.Progress
import dev.brahmkshatriya.echo.common.models.Streamable
import dev.brahmkshatriya.echo.common.models.Track
import dev.brahmkshatriya.echo.common.providers.MusicExtensionsProvider
import dev.brahmkshatriya.echo.common.settings.Setting
import dev.brahmkshatriya.echo.common.settings.Settings
import dev.brahmkshatriya.echo.extensions.ExtensionUtils.getAs
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** A deliberately small built-in downloader for NAGA's progressive audio sources. */
class NagaDownloadExtension(private val context: Context) :
    ExtensionClient, DownloadClient, MusicExtensionsProvider {

    companion object {
        val metadata = Metadata(
            className = NagaDownloadExtension::class.java.name,
            path = "",
            importType = ImportType.BuiltIn,
            type = ExtensionType.MISC,
            id = "naga-download",
            name = "NAGA Offline Downloads",
            version = BuildConfig.VERSION_NAME,
            description = "Built-in downloads for offline listening.",
            author = "NAGA",
            isEnabled = true,
        )
    }

    private val http = OkHttpClient()
    private var musicExtensions: List<MusicExtension> = emptyList()
    override val requiredMusicExtensions: List<String> = emptyList()

    override fun setMusicExtensions(extensions: List<MusicExtension>) {
        musicExtensions = extensions
    }

    override suspend fun getSettingItems(): List<Setting> = emptyList()
    override fun setSettings(settings: Settings) = Unit
    override val concurrentDownloads: Int = 2

    override suspend fun getDownloadTracks(
        extensionId: String,
        item: EchoMediaItem,
        context: EchoMediaItem?,
    ): List<DownloadContext> {
        val tracks = when (item) {
            is Track -> listOf(item)
            is Album -> extension(extensionId).getAs<AlbumClient, List<Track>> {
                loadTracks(item)?.loadAll().orEmpty()
            }.getOrThrow()
            is Playlist -> extension(extensionId).getAs<PlaylistClient, List<Track>> {
                loadTracks(item).loadAll()
            }.getOrThrow()
            else -> emptyList()
        }
        val parent = context ?: item.takeUnless { it is Track }
        return tracks.mapIndexed { index, track ->
            DownloadContext(extensionId, track, index, parent)
        }
    }

    override suspend fun selectServer(context: DownloadContext): Streamable =
        context.track.servers.maxByOrNull { it.quality }
            ?: error("${context.track.title}: no downloadable audio source")

    override suspend fun selectSources(
        context: DownloadContext,
        server: Streamable.Media.Server,
    ): List<Streamable.Source> = server.sources
        .filterNot { it.isVideo || it.isLive }
        .maxByOrNull { it.quality }
        ?.let(::listOf)
        .orEmpty()

    override suspend fun download(
        progressFlow: MutableStateFlow<Progress>,
        context: DownloadContext,
        source: Streamable.Source,
    ): File = withContext(Dispatchers.IO) {
        val directory = File(this@NagaDownloadExtension.context.filesDir, "offline_audio")
            .apply { mkdirs() }
        val output = File.createTempFile("naga_${context.track.id.hashCode()}_", ".audio", directory)
        when (source) {
            is Streamable.Source.Http -> {
                require(source.decryption == null) { "DRM-protected audio cannot be downloaded" }
                val builder = Request.Builder().url(source.request.url)
                source.request.headers.forEach { (name, value) -> builder.header(name, value) }
                val response = http.newCall(builder.build()).await()
                response.use { res ->
                    check(res.isSuccessful) { "Download failed: HTTP ${res.code}" }
                    val body = res.body
                    val total = body.contentLength().coerceAtLeast(0)
                    body.byteStream().use { input ->
                        FileOutputStream(output).use { sink -> copy(input, sink, total, progressFlow) }
                    }
                }
            }
            is Streamable.Source.Raw -> {
                val provider = requireNotNull(source.streamProvider) { "Audio stream is unavailable" }
                val (input, total) = provider.provide(0, -1)
                input.use { FileOutputStream(output).use { sink -> copy(it, sink, total, progressFlow) } }
            }
        }
        output
    }

    override suspend fun merge(
        progressFlow: MutableStateFlow<Progress>,
        context: DownloadContext,
        files: List<File>,
    ): File {
        require(files.isNotEmpty()) { "No downloaded audio files" }
        if (files.size == 1) return files.single()
        val merged = File(files.first().parentFile, "merged_${context.track.id.hashCode()}.audio")
        FileOutputStream(merged).use { sink ->
            files.forEach { file -> file.inputStream().use { it.copyTo(sink) } }
        }
        files.forEach { if (it != merged) it.delete() }
        return merged
    }

    override suspend fun tag(
        progressFlow: MutableStateFlow<Progress>,
        context: DownloadContext,
        file: File,
    ): File {
        // Preserve the original bytes: Android/Media3 reads metadata supplied by NAGA's database.
        progressFlow.value = Progress(file.length(), file.length())
        return file
    }

    private fun extension(id: String): MusicExtension =
        musicExtensions.firstOrNull { it.id == id && it.isEnabled }
            ?: error("Music extension $id is unavailable")

    private fun copy(
        input: java.io.InputStream,
        output: java.io.OutputStream,
        total: Long,
        progressFlow: MutableStateFlow<Progress>,
    ) {
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var copied = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            copied += count
            progressFlow.value = Progress(total, copied)
        }
    }
}
