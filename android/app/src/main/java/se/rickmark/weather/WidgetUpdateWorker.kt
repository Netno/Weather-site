package se.rickmark.weather

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

class WidgetUpdateWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val d = fetch()
            val views = build(d)
            val mgr = AppWidgetManager.getInstance(applicationContext)
            val ids = mgr.getAppWidgetIds(ComponentName(applicationContext, WeatherWidget::class.java))
            for (id in ids) mgr.updateAppWidget(id, views)
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    // ---- Datahämtning --------------------------------------------------------
    private data class Wx(
        var temp: Double? = null, var wind: Double? = null, var wnow: Double? = null, var windDir: Int? = null,
        var rain: Double? = null, var hum: Double? = null, var uv: Double? = null, var lux: Double? = null,
        var strikes: Int? = null, var feels: Double? = null, var dew: Double? = null, var press: Double? = null,
        var symb: Int? = null, var days: List<Day> = emptyList()
    )
    private data class Day(val date: String, val name: String, val icon: String, val hi: Int, val lo: Int)

    private fun fetch(): Wx {
        val wx = Wx()
        // AcuRite (primär)
        try {
            val a = JSONObject(httpGet("$BASE/api/acurite"))
            if (a.optString("status") == "ok") {
                val atlas = a.getJSONObject("atlas")
                val c = atlas.getJSONObject("current")
                wx.temp = c.dbl("temp"); wx.wind = c.dbl("windAvg") ?: c.dbl("windNow")
                wx.wnow = c.dbl("windNow"); wx.windDir = c.dbl("windDir")?.roundToInt()
                wx.rain = c.dbl("rainToday"); wx.hum = c.dbl("humidity")
                wx.uv = atlas.dbl("uv"); wx.lux = atlas.dbl("lux")
                wx.strikes = atlas.optJSONObject("lightning")?.dbl("dailyStrikes")?.roundToInt() ?: 0
                wx.feels = c.dbl("feelsLike"); wx.dew = c.dbl("dewpt"); wx.press = c.dbl("pressureSL")
            }
        } catch (_: Exception) { }
        // WU-reserv om AcuRite saknas
        if (wx.temp == null) {
            try {
                val w = JSONObject(httpGet("$BASE/api/wu?e=current"))
                val obs = w.optJSONArray("observations")?.optJSONObject(0)
                if (obs != null) {
                    val m = obs.getJSONObject("metric")
                    wx.temp = m.dbl("temp"); wx.wind = m.dbl("windSpeed"); wx.wnow = m.dbl("windGust")
                    wx.windDir = obs.dbl("winddir")?.roundToInt(); wx.rain = m.dbl("precipTotal")
                    wx.hum = obs.dbl("humidity"); wx.uv = obs.dbl("uv")
                    wx.feels = m.dbl("temp"); wx.dew = m.dbl("dewpt"); wx.press = m.dbl("pressure")
                }
            } catch (_: Exception) { }
        }
        // SMHI-prognos + aktuell väderkod
        try {
            val s = JSONObject(httpGet("$BASE/api/smhi"))
            s.optJSONArray("hourly")?.optJSONObject(0)?.let { wx.symb = it.dbl("symb")?.roundToInt() }
            val today = dayFmt.format(Date())
            val out = ArrayList<Day>()
            val daily = s.optJSONArray("daily")
            if (daily != null) {
                var i = 0
                while (i < daily.length() && out.size < 5) {
                    val o = daily.getJSONObject(i); i++
                    val hi = o.dbl("tMax") ?: continue
                    val lo = o.dbl("tMin") ?: hi
                    val date = o.optString("date")
                    val name = if (date == today) "Idag" else weekday(date)
                    out.add(Day(date, name, iconFor(o.dbl("noon")?.roundToInt(), false), hi.roundToInt(), lo.roundToInt()))
                }
            }
            wx.days = out
        } catch (_: Exception) { }
        return wx
    }

    // ---- Bygg vyer -----------------------------------------------------------
    private fun build(d: Wx): RemoteViews {
        val ctx = applicationContext
        val v = RemoteViews(ctx.packageName, R.layout.widget)
        val night = d.lux?.let { it < 30 } ?: isNight()
        v.setImageViewResource(R.id.w_bg, sceneDrawable(d.symb, night))
        v.setTextViewText(R.id.w_icon, iconFor(d.symb, night))
        v.setTextViewText(R.id.w_when, whenFmt.format(Date()))

        val st = sunTimes(dayFmt.format(Date()))
        v.setTextViewText(R.id.w_sun, if (st != null) "☀️ ${st.first}  ·  🌙 ${st.second}" else "")

        v.setTextViewText(R.id.w_temp, f(d.temp, 1))
        v.setTextViewText(R.id.w_wind, f(d.wind?.div(3.6), 1))
        v.setTextViewText(R.id.w_rain, f(d.rain, 1))
        v.setTextViewText(R.id.w_hum, f(d.hum, 0))
        v.setTextViewText(R.id.w_uv, if (d.uv != null) f(d.uv, 0) else "–")
        v.setTextViewText(R.id.w_lux, when {
            d.lux == null -> "–"
            d.lux!! < 30 -> "Mörkt"
            else -> f(d.lux, 0)
        })
        v.setTextViewText(R.id.w_strk, (d.strikes ?: 0).toString())
        v.setTextViewText(R.id.w_feels, f(d.feels ?: d.temp, 0))
        v.setTextViewText(R.id.w_dew, f(d.dew, 1))
        v.setTextViewText(R.id.w_press, if (d.press != null) f(d.press, 0) else "–")
        v.setTextViewText(R.id.w_wnow, f((d.wnow ?: d.wind)?.div(3.6), 1))
        v.setTextViewText(R.id.w_wdir, d.windDir?.let { DIRS[((it / 22.5).roundToInt()) % 16] } ?: "–")

        val fcIds = intArrayOf(R.id.w_fc0, R.id.w_fc1, R.id.w_fc2, R.id.w_fc3, R.id.w_fc4)
        for (i in fcIds.indices) {
            val day = d.days.getOrNull(i)
            if (day != null) {
                v.setTextViewText(fcIds[i], "${day.name}\n${day.icon}\n${day.hi}° ${day.lo}°")
                // Klick på en dag → öppna appen på just den dagens timprognos
                v.setOnClickPendingIntent(fcIds[i], WeatherWidget.pendingUrl(ctx, 200 + i, "$BASE/#dag=${day.date}"))
            } else {
                v.setTextViewText(fcIds[i], "")
            }
        }

        // Klick på en mätcell → öppna appen och skrolla till motsvarande graf
        v.setOnClickPendingIntent(R.id.c_temp, WeatherWidget.pendingUrl(ctx, 301, "$BASE/#graf=temp"))
        v.setOnClickPendingIntent(R.id.c_wind, WeatherWidget.pendingUrl(ctx, 302, "$BASE/#graf=wind"))
        v.setOnClickPendingIntent(R.id.c_rain, WeatherWidget.pendingUrl(ctx, 303, "$BASE/#graf=rain"))
        v.setOnClickPendingIntent(R.id.c_uv, WeatherWidget.pendingUrl(ctx, 304, "$BASE/#graf=uv"))
        v.setOnClickPendingIntent(R.id.c_lux, WeatherWidget.pendingUrl(ctx, 305, "$BASE/#graf=lux"))
        v.setOnClickPendingIntent(R.id.c_press, WeatherWidget.pendingUrl(ctx, 306, "$BASE/#graf=pressure"))
        v.setOnClickPendingIntent(R.id.c_wnow, WeatherWidget.pendingUrl(ctx, 307, "$BASE/#graf=wind"))
        // Resten av widgeten öppnar startsidan
        v.setOnClickPendingIntent(R.id.root, WeatherWidget.pendingUrl(ctx, 100, BASE))
        return v
    }

    // ---- Hjälpare ------------------------------------------------------------
    private fun httpGet(u: String): String {
        val c = URL(u).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 8000
        c.setRequestProperty("User-Agent", "bramhult-widget/1.0")
        try {
            return c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    private fun f(v: Double?, dec: Int): String =
        if (v == null || v.isNaN()) "–" else String.format(Locale("sv", "SE"), "%.${dec}f", v)

    private fun sceneDrawable(symb: Int?, night: Boolean): Int = when (symb) {
        7 -> R.drawable.scene_fog
        5, 6 -> R.drawable.scene_cloudy
        8, 9, 10, 18, 19, 20 -> R.drawable.scene_rain
        11, 21 -> R.drawable.scene_thunder
        12, 13, 14, 15, 16, 17, 22, 23, 24, 25, 26, 27 -> R.drawable.scene_snow
        2, 3, 4 -> if (night) R.drawable.scene_partly_night else R.drawable.scene_partly_day
        else -> if (night) R.drawable.scene_clear_night else R.drawable.scene_clear_day
    }

    private fun iconFor(symb: Int?, night: Boolean): String {
        if (symb == null) return if (night) "🌙" else "☀️"
        if (night && symb in 1..4) return "🌙" // måne
        return when (symb) {
            1 -> "☀️"; 2, 4 -> "🌤️"; 3 -> "⛅"
            5, 6 -> "☁️"; 7 -> "🌫️"
            8, 9 -> "🌦️"; 10, 18, 19, 20 -> "🌧️"
            11, 21 -> "⛈️"; 17, 26, 27 -> "❄️"
            else -> "🌨️"
        }
    }

    // ---- Sol -----------------------------------------------------------------
    private fun sunAltNow(): Double {
        val d = Date()
        val cal = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = d }
        val n = dayOfYearUTC(cal)
        val decl = -23.44 * cos((2 * PI / 365) * (n + 10)) * RAD
        val solar = cal.get(java.util.Calendar.HOUR_OF_DAY) + cal.get(java.util.Calendar.MINUTE) / 60.0 + LON / 15.0
        val h = (solar - 12) * 15 * RAD
        val lat = LAT * RAD
        return asin(sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(h)) / RAD
    }

    private fun isNight(): Boolean = sunAltNow() < -0.833

    private fun sunTimes(dateStr: String): Pair<String, String>? {
        val parts = dateStr.split("-")
        if (parts.size != 3) return null
        val cal = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.clear()
        cal.set(parts[0].toInt(), parts[1].toInt() - 1, parts[2].toInt(), 12, 0, 0)
        val n = dayOfYearUTC(cal)
        val decl = -23.44 * cos((2 * PI / 365) * (n + 10)) * RAD
        val lat = LAT * RAD
        val cosH = (sin(-0.833 * RAD) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl))
        if (cosH < -1 || cosH > 1) return null
        val h0 = acos(cosH) / RAD / 15.0
        val b = (2 * PI / 364) * (n - 81)
        val eot = 9.87 * sin(2 * b) - 7.53 * cos(b) - 1.5 * sin(b)
        fun local(solarH: Double): String {
            val utcMillis = cal.timeInMillis - 12 * 3600_000L +
                ((solarH - LON / 15.0 - eot / 60.0) * 3600_000L).toLong()
            return clockFmt.format(Date(utcMillis))
        }
        return Pair(local(12 - h0), local(12 + h0))
    }

    private fun dayOfYearUTC(cal: java.util.Calendar): Double {
        val start = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        start.clear(); start.set(cal.get(java.util.Calendar.YEAR), 0, 1, 0, 0, 0)
        return (cal.timeInMillis - start.timeInMillis) / 86_400_000.0 + 1.0
    }

    private fun weekday(dateStr: String): String {
        return try {
            val d = dayFmt.parse(dateStr)!!
            val cal = java.util.Calendar.getInstance(STHLM).apply { time = d }
            DAY_NAMES[(cal.get(java.util.Calendar.DAY_OF_WEEK) - 1)]
        } catch (e: Exception) { "" }
    }

    companion object {
        private const val BASE = "https://weather.rickmark.se"
        private const val LAT = 57.7216
        private const val LON = 13.01
        private const val RAD = PI / 180.0
        private val DIRS = arrayOf("N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSV","SV","VSV","V","VNV","NV","NNV")
        private val DAY_NAMES = arrayOf("Sön","Mån","Tis","Ons","Tor","Fre","Lör")
        private val STHLM: TimeZone = TimeZone.getTimeZone("Europe/Stockholm")
        private val dayFmt = SimpleDateFormat("yyyy-MM-dd", Locale("sv", "SE")).apply { timeZone = STHLM }
        private val whenFmt = SimpleDateFormat("d MMM HH:mm", Locale("sv", "SE")).apply { timeZone = STHLM }
        private val clockFmt = SimpleDateFormat("HH:mm", Locale("sv", "SE")).apply { timeZone = STHLM }
    }
}

// JSONObject-hjälpare för säker nummerläsning
private fun JSONObject.dbl(key: String): Double? {
    if (!has(key) || isNull(key)) return null
    val v = optDouble(key, Double.NaN)
    return if (v.isNaN()) null else v
}
