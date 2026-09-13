package com.jbeckerit.drift.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.jbeckerit.drift.DriftApplication

class RescheduleReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as DriftApplication
        app.container.reminders.scheduleAll(app.container.settings.current().reminders)
    }
}
