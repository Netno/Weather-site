package se.rickmark.weather

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.widget.RemoteViews
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Inställning för väder-widgetens bakgrundsopacitet. En enkel skjutreglage 0–100 %
 * som sparas i SharedPreferences ("widget"/"opacity") och tillämpas direkt på alla
 * placerade widgetar. Opaciteten rör bara scenbilden och plattans bakgrund – aldrig
 * texten, som alltid ska vara läsbar. Widgetens uppdaterare läser samma värde vid
 * varje refresh så inställningen består.
 */
class WidgetSettingsActivity : AppCompatActivity() {

    private lateinit var valueLabel: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.widget_settings)

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seek = findViewById<SeekBar>(R.id.opacity_seek)
        valueLabel = findViewById(R.id.opacity_val)

        val current = prefs.getInt(KEY_OPACITY, 100).coerceIn(0, 100)
        seek.max = 100
        seek.progress = current
        valueLabel.text = "$current %"

        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                valueLabel.text = "$progress %"
            }

            override fun onStartTrackingTouch(sb: SeekBar?) {}

            override fun onStopTrackingTouch(sb: SeekBar?) {
                val v = (sb?.progress ?: current).coerceIn(0, 100)
                prefs.edit().putInt(KEY_OPACITY, v).apply()
                applyOpacity(this@WidgetSettingsActivity, v)
            }
        })
    }

    companion object {
        const val PREFS = "widget"
        const val KEY_OPACITY = "opacity"

        /** Tillämpar bakgrundsopaciteten direkt på alla placerade widgetar. */
        fun applyOpacity(ctx: Context, opacity: Int) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, WeatherWidget::class.java))
            if (ids.isEmpty()) return
            val v = RemoteViews(ctx.packageName, R.layout.widget)
            val alpha = (opacity.coerceIn(0, 100) * 255) / 100
            v.setInt(R.id.w_bg, "setImageAlpha", alpha)
            v.setInt(R.id.root, "setBackgroundColor", (alpha shl 24) or 0x0B1018)
            for (id in ids) mgr.partiallyUpdateAppWidget(id, v)
        }
    }
}
