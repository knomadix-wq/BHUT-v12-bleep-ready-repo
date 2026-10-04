@file:Suppress("UNREACHABLE_CODE")

package dev.brahmkshatriya.echo.utils

import android.content.Context
import android.os.Build
import dev.brahmkshatriya.echo.common.helpers.ContinuationCallback.Companion.await
import dev.brahmkshatriya.echo.utils.ContextUtils.getTempFile
import dev.brahmkshatriya.echo.utils.Serializer.toData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

object AppUpdater {

    private val githubRegex = Regex("https://api\\.github\\.com/repos/([^/]*)/([^/]*)/")
    // Matches a github.com BROWSER url and captures user/repo from the first two path segments:
    // https://github.com/<user>/<repo> and any suffix (/, /releases, /releases/latest, /releases/tag/…),
    // with optional http/www. `[^/]+` stops at the next slash so trailing paths/slashes are ignored.
    private val githubBrowserRegex = Regex("^https?://(?:www\\.)?github\\.com/([^/]+)/([^/]+)")
    suspend fun getGithubUpdateUrl(
        currentVersion: String,
        updateUrl: String,
        client: OkHttpClient,
        requiredAssetPrefix: String? = null,
    ) = run {
        val (user, repo) = githubRegex.find(updateUrl)?.destructured
            ?: throw Exception("Invalid Github URL")
        val url = "https://api.github.com/repos/$user/$repo/releases/latest"
        val request = Request.Builder().url(url).build()
        val res = runCatching {
            client.newCall(request).await().use {
                it.body.string().toData<GithubReleaseResponse>()
            }.getOrThrow()
        }.getOrElse {
            throw Exception("Failed to fetch latest release", it)
        }
        if (!res.tagName.equals(currentVersion, ignoreCase = true)) {
            res.assets.sortedByDescending {
                it.name.contains(Build.SUPPORTED_ABIS.first())
            }.firstOrNull {
                it.name.endsWith(".apk", ignoreCase = true) &&
                    (requiredAssetPrefix == null ||
                        it.name.startsWith(requiredAssetPrefix, ignoreCase = true))
            }?.browserDownloadUrl ?: if (requiredAssetPrefix != null) {
                // The repository still contains historical Gladix releases. Never offer one to NAGA.
                null
            } else {
                throw Exception("No EApk assets found")
            }
        } else {
            null
        }
    }

    @Serializable
    data class GithubReleaseResponse(
        @SerialName("tag_name")
        val tagName: String,
        @SerialName("created_at")
        val createdAt: String,
        val assets: List<Asset>
    ) {
        @Serializable
        data class Asset(
            val name: String,
            @SerialName("browser_download_url")
            val browserDownloadUrl: String
        )
    }

    suspend fun downloadUpdate(
        context: Context,
        url: String,
        client: OkHttpClient
    ) = runIOCatching {
        val request = Request.Builder().url(url).build()
        val res = client.newCall(request).await().body.byteStream()
        val file = context.getTempFile()
        res.use { input -> file.outputStream().use { output -> input.copyTo(output) } }
        file
    }

    suspend fun getUpdateFileUrl(
        currentVersion: String,
        updateUrl: String,
        client: OkHttpClient
    ) = runIOCatching {
        if (updateUrl.isEmpty()) return@runIOCatching null
        // Accept the api.github.com/repos/ form directly; normalize a github.com BROWSER url
        // (github.com/<user>/<repo>[/releases…]) to the api form getGithubUpdateUrl expects.
        val apiUrl = when {
            updateUrl.startsWith("https://api.github.com/repos/") -> updateUrl
            else -> githubBrowserRegex.find(updateUrl)?.destructured?.let { (user, repo) ->
                "https://api.github.com/repos/$user/${repo.removeSuffix(".git")}/releases"
            }
        }
        // Non-empty but not a recognizable GitHub url (GitLab, self-hosted, direct-APK host, …):
        // return null quietly instead of throwing. getExtensionUpdate/AddViewModel treat null as
        // "nothing to download" (silent on auto-checks; a benign "no update available" only when
        // user-triggered), so an unsupported-host extension no longer emits a recurring "error
        // updating extension" via throwFlow.emit on every silent auto-check.
        apiUrl?.let { getGithubUpdateUrl(currentVersion, it, client) }
    }

    private suspend fun <T> runIOCatching(
        block: suspend () -> T
    ) = withContext(Dispatchers.IO) {
        runCatching { runCatching { block() }.getOrElse { throw UpdateException(it) } }
    }

    class UpdateException(override val cause: Throwable) : Exception(cause) {
        override val message: String
            get() = "Update failed: ${cause.message}"
    }
}
