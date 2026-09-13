package com.jbeckerit.drift.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [Entry::class, Task::class, TaskTemplate::class], version = 1, exportSchema = false)
abstract class DriftDatabase : RoomDatabase() {
    abstract fun dao(): DriftDao
    companion object {
        fun create(context: Context): DriftDatabase = Room.databaseBuilder(context, DriftDatabase::class.java, "drift.db")
            .fallbackToDestructiveMigration().build()
    }
}
