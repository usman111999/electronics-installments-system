package com.eis.devicelock.net

import android.content.Context
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.io.File

/**
 * Disk-backed FIFO queue of pending events we still owe the server.
 *
 * Stored as a single JSON array file under app private storage. This is
 * deliberately simple — at worst we hold a few dozen events between
 * connectivity windows.
 */
class CommandQueue(context: Context) {

    private val file: File = File(context.filesDir, "command_queue.json")
    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val type = Types.newParameterizedType(List::class.java, QueuedEvent::class.java)
    private val adapter = moshi.adapter<List<QueuedEvent>>(type)

    @Synchronized
    fun enqueue(event: QueuedEvent) {
        val current = read().toMutableList()
        current.add(event)
        write(current)
    }

    @Synchronized
    fun drain(): List<QueuedEvent> {
        val current = read()
        if (current.isNotEmpty()) write(emptyList())
        return current
    }

    @Synchronized
    fun peek(): List<QueuedEvent> = read()

    private fun read(): List<QueuedEvent> {
        if (!file.exists()) return emptyList()
        val text = runCatching { file.readText() }.getOrNull().orEmpty()
        if (text.isBlank()) return emptyList()
        return runCatching { adapter.fromJson(text) ?: emptyList() }.getOrDefault(emptyList())
    }

    private fun write(list: List<QueuedEvent>) {
        file.writeText(adapter.toJson(list))
    }

    @JsonClass(generateAdapter = true)
    data class QueuedEvent(
        val kind: String,       // "heartbeat" | "rejected_command"
        val payloadJson: String,
        val createdAt: Long
    )
}
