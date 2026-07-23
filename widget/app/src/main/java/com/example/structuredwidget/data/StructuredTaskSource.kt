package com.example.structuredwidget.data

import java.time.LocalDate

interface StructuredTaskSource {
    suspend fun fetchOneOffTasks(date: LocalDate): List<StructuredTask>
    suspend fun fetchRecurringTasks(): List<StructuredTask>
    suspend fun fetchInboxTasks(): List<StructuredTask>
    suspend fun fetchForwardTasks(startDate: LocalDate, endDate: LocalDate): List<StructuredTask>
}
