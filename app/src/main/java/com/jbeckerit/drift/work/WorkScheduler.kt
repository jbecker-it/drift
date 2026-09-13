package com.jbeckerit.drift.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.jbeckerit.drift.DriftApplication
import java.util.concurrent.TimeUnit

class WorkScheduler(context: Context) {
    private val work = WorkManager.getInstance(context)
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun syncSoon() {
        val request = OneTimeWorkRequestBuilder<DriftSyncWorker>().setConstraints(online).setInitialDelay(800, TimeUnit.MILLISECONDS).build()
        work.enqueueUniqueWork("drift-sync-now", ExistingWorkPolicy.REPLACE, request)
    }

    fun schedulePeriodic() {
        val request = PeriodicWorkRequestBuilder<DriftSyncWorker>(6, TimeUnit.HOURS).setConstraints(online).build()
        work.enqueueUniquePeriodicWork("drift-sync-periodic", ExistingPeriodicWorkPolicy.KEEP, request)
    }
}

class DriftSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val app = applicationContext as DriftApplication
        val sync = app.container.settings.current().sync
        if (!sync.enabled) return Result.success()
        return runCatching { app.container.webDav.sync(sync) }.fold(
            onSuccess = { Result.success() },
            onFailure = { if (runAttemptCount >= 4) Result.failure() else Result.retry() },
        )
    }
}
