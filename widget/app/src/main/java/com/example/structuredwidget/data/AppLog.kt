package com.example.structuredwidget.data

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/** Ring-buffer log for on-screen diagnostics + Logcat. */
object AppLog {
    private const val TAG = "StructuredWidget"
    private const val MAX = 80
    private val lines = CopyOnWriteArrayList<String>()
    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private val timeFmt = ThreadLocal.withInitial {
        SimpleDateFormat("HH:mm:ss", Locale.US)
    }

    fun d(msg: String) {
        Log.d(TAG, msg)
        append("D", msg)
    }

    fun i(msg: String) {
        Log.i(TAG, msg)
        append("I", msg)
    }

    fun w(msg: String, t: Throwable? = null) {
        if (t != null) Log.w(TAG, msg, t) else Log.w(TAG, msg)
        append("W", msg + (t?.let { ": ${it.message}" } ?: ""))
    }

    fun e(msg: String, t: Throwable? = null) {
        if (t != null) Log.e(TAG, msg, t) else Log.e(TAG, msg)
        append("E", msg + (t?.let { ": ${it.message}" } ?: ""))
    }

    fun snapshot(): String = lines.joinToString("\n")

    fun addListener(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: () -> Unit) {
        listeners.remove(listener)
    }

    private fun append(level: String, msg: String) {
        val line = "${timeFmt.get()!!.format(Date())} $level $msg"
        lines.add(line)
        while (lines.size > MAX) {
            lines.removeAt(0)
        }
        listeners.forEach { it.invoke() }
    }
}
