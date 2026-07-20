package se.rickmark.weather

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Hemskärmswidget för Brämhults väderstation. Datauppdatering görs i WorkManager. */
class WeatherWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        refreshNow(context)
    }

    override fun onEnabled(context: Context) {
        val work = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(15, TimeUnit.MINUTES)
            .setConstraints(net())
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork("bramhult_widget_periodic", ExistingPeriodicWorkPolicy.UPDATE, work)
        refreshNow(context)
    }

    override fun onDisabled(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork("bramhult_widget_periodic")
    }

    companion object {
        private fun net() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun refreshNow(context: Context) {
            val work = OneTimeWorkRequestBuilder<WidgetUpdateWorker>().setConstraints(net()).build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("bramhult_widget_now", ExistingWorkPolicy.REPLACE, work)
        }

        /** PendingIntent som öppnar appen på en viss URL (för djuplänkar). */
        fun pendingUrl(context: Context, requestCode: Int, url: String): PendingIntent {
            val intent = Intent(context, MainActivity::class.java)
                .setData(android.net.Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            return PendingIntent.getActivity(
                context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
