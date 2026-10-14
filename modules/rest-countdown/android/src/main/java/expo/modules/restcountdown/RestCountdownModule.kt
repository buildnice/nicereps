package expo.modules.restcountdown

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHANNEL = "rest-countdown"
private const val ID = 7301

private fun next(context: Context) =
  PendingIntent.getBroadcast(context, 0, Intent(context, RestCountdownReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

fun clear(context: Context) {
  context.getSystemService(AlarmManager::class.java).cancel(next(context))
  NotificationManagerCompat.from(context).cancel(ID)
}

fun show(context: Context, titles: ArrayList<String>, body: String, ends: LongArray) {
  clear(context)
  val now = System.currentTimeMillis()
  val i = ends.indexOfFirst { it > now }
  val manager = NotificationManagerCompat.from(context)
  if (i < 0 || !manager.areNotificationsEnabled()) return
  manager.createNotificationChannel(NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW).setName("Rest countdown").build())
  val open = PendingIntent.getActivity(context, 0, context.packageManager.getLaunchIntentForPackage(context.packageName), PendingIntent.FLAG_IMMUTABLE)
  val notification = NotificationCompat.Builder(context, CHANNEL)
    .setSmallIcon(context.resources.getIdentifier("notification_icon", "drawable", context.packageName))
    .setContentTitle(titles[i])
    .setContentText(body)
    .setWhen(ends[i])
    .setShowWhen(true)
    .setUsesChronometer(true)
    .setChronometerCountDown(true)
    .setTimeoutAfter(ends[i] - now)
    .setOngoing(true)
    .setSilent(true)
    .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
    .setContentIntent(open)
    .build()
  try {
    manager.notify(ID, notification)
  } catch (_: SecurityException) {
    return
  }
  val alarms = context.getSystemService(AlarmManager::class.java)
  val pending = PendingIntent.getBroadcast(
    context, 0,
    Intent(context, RestCountdownReceiver::class.java).putStringArrayListExtra("titles", titles).putExtra("body", body).putExtra("ends", ends),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  )
  if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ends[i], pending)
  else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ends[i], pending)
}

class RestCountdownReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    show(context, intent.getStringArrayListExtra("titles") ?: return, intent.getStringExtra("body") ?: "", intent.getLongArrayExtra("ends") ?: return)
  }
}

class RestCountdownModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RestCountdown")

    Function("show") { titles: List<String>, body: String, ends: List<Double> ->
      appContext.reactContext?.let { show(it, ArrayList(titles), body, ends.map { end -> end.toLong() }.toLongArray()) }
    }

    Function("clear") {
      appContext.reactContext?.let { clear(it) }
    }

    Function("exact") {
      Build.VERSION.SDK_INT < 31 || appContext.reactContext?.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true
    }
  }
}
