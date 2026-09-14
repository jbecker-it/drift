package com.jbeckerit.drift.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [Entry::class, Task::class, TaskTemplate::class, EntryTags::class, ContextMemory::class, ChatSession::class, Reward::class, MoodEntry::class],
    version = 2,
    exportSchema = false,
)
abstract class DriftDatabase : RoomDatabase() {
    abstract fun dao(): DriftDao
    companion object {
        fun create(context: Context): DriftDatabase = Room.databaseBuilder(context, DriftDatabase::class.java, "drift.db")
            .addMigrations(MIGRATION_1_2)
            .build()
    }
}
