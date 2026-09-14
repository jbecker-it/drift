package com.jbeckerit.drift

import android.app.Application
import com.jbeckerit.drift.ai.AiService
import com.jbeckerit.drift.ai.OnDeviceAiService
import com.jbeckerit.drift.backup.BackupService
import com.jbeckerit.drift.data.DriftDatabase
import com.jbeckerit.drift.data.DriftRepository
import com.jbeckerit.drift.data.SecureSettings
import com.jbeckerit.drift.reminders.NotificationChannels
import com.jbeckerit.drift.reminders.ReminderScheduler
import com.jbeckerit.drift.sync.WebDavSync
import com.jbeckerit.drift.work.WorkScheduler

class DriftApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        NotificationChannels.create(this)

        val settings = SecureSettings(this)
        val scheduler = WorkScheduler(this)
        val repository = DriftRepository(DriftDatabase.create(this)) {
            if (settings.current().sync.enabled) scheduler.syncSoon()
        }
        container = AppContainer(
            settings = settings,
            repository = repository,
            ai = AiService(settings, repository),
            nano = OnDeviceAiService(),
            backup = BackupService(this, repository, settings),
            webDav = WebDavSync(repository),
            reminders = ReminderScheduler(this),
            work = scheduler,
        )
        scheduler.schedulePeriodic()
        container.reminders.scheduleAll(settings.current().reminders)
    }
}

data class AppContainer(
    val settings: SecureSettings,
    val repository: DriftRepository,
    val ai: AiService,
    val nano: OnDeviceAiService,
    val backup: BackupService,
    val webDav: WebDavSync,
    val reminders: ReminderScheduler,
    val work: WorkScheduler,
)
