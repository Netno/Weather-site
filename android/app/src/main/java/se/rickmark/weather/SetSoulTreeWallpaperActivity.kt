package se.rickmark.weather

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/**
 * Liten genväg: öppnar systemets förhandsvisning för live-bakgrunden "Själarnas
 * träd" så man kan sätta den med ett tryck. Har ingen egen UI – startar bara rätt
 * intent och avslutas. Faller tillbaka till den allmänna live-bakgrundsväljaren om
 * direktvisningen inte stöds.
 */
class SetSoulTreeWallpaperActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val component = ComponentName(this, SoulTreeWallpaperService::class.java)
        val preview = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER).apply {
            putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, component)
        }
        try {
            startActivity(preview)
        } catch (e: Exception) {
            try {
                startActivity(Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER))
            } catch (e2: Exception) {
                Toast.makeText(this, R.string.soul_tree_open_failed, Toast.LENGTH_LONG).show()
            }
        }
        finish()
    }
}
