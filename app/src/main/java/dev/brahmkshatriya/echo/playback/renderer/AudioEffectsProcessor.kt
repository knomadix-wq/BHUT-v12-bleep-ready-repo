package dev.brahmkshatriya.echo.playback.renderer

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.PI
import kotlin.math.cos

@OptIn(UnstableApi::class)
class AudioEffectsProcessor : BaseAudioProcessor() {

    @Volatile var crossfadeEnabled = false
    // Kept only for settings/binary compatibility. Gain processing has been removed in V53.
    @Volatile var normalizationEnabled = false
    @Volatile var crossfadeDurationMs = 5000
    @Volatile var skipFade = false

    private val fadeInFramesRemaining = AtomicLong(0)
    private val fadeOutFramesRemaining = AtomicLong(0)
    // audio thread only — no atomic needed
    private var isPendingFadeIn = false
    private var configuredFormat = AudioProcessor.AudioFormat.NOT_SET

    fun setTrackGain(gainDb: Float?, trackId: String?) = Unit
    fun resetGain() = Unit

    fun onFadeOutStart() {
        if (crossfadeEnabled) fadeOutFramesRemaining.set(crossfadeFrames())
    }

    fun cancelFades() {
        fadeInFramesRemaining.set(0)
        fadeOutFramesRemaining.set(0)
    }

    private fun crossfadeFrames(): Long {
        val fmt = configuredFormat
        if (fmt.sampleRate <= 0 || fmt.encoding != C.ENCODING_PCM_16BIT) return 0L
        return fmt.sampleRate.toLong() * crossfadeDurationMs / 1000L
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        configuredFormat = inputAudioFormat
        return inputAudioFormat
    }

    override fun onQueueEndOfStream() {
        // Clear the previous track's fade-out at the track boundary so its dying envelope doesn't
        // bleed into — and silence the opening of — the NEW track. The old track already received
        // its full fade-out on its own buffers before this point (the envelope is applied in
        // queueInput, and no old-stream input buffers remain once end-of-stream fires), so this only
        // stops the leftover countdown from multiplying the next track's first ~1s. No-op on albums
        // (fade-out is never scheduled there) and when crossfade is off (never armed) — introduces
        // no fade where there should be none.
        fadeOutFramesRemaining.set(0)
        if (crossfadeEnabled && !skipFade) isPendingFadeIn = true
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!inputBuffer.hasRemaining()) return

        if (skipFade) {
            // Force full volume for album transitions, regardless of whether isPendingFadeIn
            // raced ahead of the skipFade flag being set (onQueueEndOfStream runs on the audio
            // thread, skipFade is set from the main thread — no ordering guarantee between them).
            isPendingFadeIn = false
            fadeInFramesRemaining.set(0)
            fadeOutFramesRemaining.set(0)
        } else if (isPendingFadeIn) {
            fadeInFramesRemaining.set(crossfadeFrames())
            isPendingFadeIn = false
        }

        val fmt = configuredFormat
        val output = replaceOutputBuffer(inputBuffer.remaining())

        if (fmt.encoding != C.ENCODING_PCM_16BIT || fmt.sampleRate <= 0) {
            output.put(inputBuffer)
            output.flip()
            return
        }

        var currentFi = fadeInFramesRemaining.get()
        var currentFo = fadeOutFramesRemaining.get()
        val total = crossfadeFrames()
        val channelCount = fmt.channelCount
        val applyFade = crossfadeEnabled && total > 0
        while (inputBuffer.remaining() >= channelCount * 2) {
            // Cosine² fade envelope — computed once per frame, applied to all channels
            val fadeGain: Float
            if (applyFade && (currentFi > 0 || currentFo > 0)) {
                val fadeInGain = if (currentFi > 0) {
                    val c = cos(currentFi.toFloat() / total * (PI / 2).toFloat())
                    c * c
                } else 1f
                val fadeOutGain = if (currentFo > 0) {
                    val c = cos((1f - currentFo.toFloat() / total) * (PI / 2).toFloat())
                    c * c
                } else 1f
                if (currentFi > 0) currentFi--
                if (currentFo > 0) currentFo--
                fadeGain = fadeInGain * fadeOutGain
            } else {
                fadeGain = 1f
            }

            repeat(channelCount) {
                val raw = inputBuffer.short.toInt()
                output.putShort(
                    (raw * fadeGain).toInt()
                        .coerceIn(-32768, 32767).toShort()
                )
            }
        }

        fadeInFramesRemaining.set(currentFi)
        fadeOutFramesRemaining.set(currentFo)
        output.flip()
    }

}
