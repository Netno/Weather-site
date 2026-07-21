# Live-bakgrund: Själarnas träd 🌸

En native levande bakgrund (`WallpaperService`) i Android-appen, inspirerad av
Eywas heliga träd i *Avatar*: en fluffig, lysande pilträdskrona av hängande
slingor, en slingrande S-stam med grenar, knotiga rötter, en mark full av
glödande lyktor + neurala trådar, och svävande fröandar (*atokirina*).

Kronan gungar i "vind" och hela djupet tippar i **parallax** när du lutar
telefonen (accelerometer) eller swajar mellan hemskärmarna.

## Filer

| Fil | Roll |
|---|---|
| `app/src/main/java/se/rickmark/weather/SoulTreeWallpaperService.kt` | Själva renderingen (Canvas, hårdvaruaccelererad via `lockHardwareCanvas`) |
| `app/src/main/java/se/rickmark/weather/SetSoulTreeWallpaperActivity.kt` | Genväg som öppnar systemets förhandsvisning så man kan sätta bakgrunden med ett tryck |
| `app/src/main/res/xml/soul_tree_wallpaper.xml` | Metadata (namn, beskrivning, tumnagel) |
| `app/src/main/res/drawable/soul_tree_thumb.xml` | Tumnagel i live-bakgrundsväljaren |

## Bygga

```bash
cd android
./gradlew assembleDebug        # eller assembleRelease
# APK hamnar i app/build/outputs/apk/
```

Kräver Android SDK (compileSdk 34). Ingen ny extern beroende tillkom.

## Aktivera på telefonen

Efter installation, endera:

1. **Genväg:** öppna appen **"Själarnas träd (bakgrund)"** i app-lådan → systemets
   förhandsvisning öppnas → tryck *Ställ in som bakgrund*. Eller
2. **Manuellt:** Inställningar → Bakgrund och stil → **Live-bakgrunder** →
   *Själarnas träd*.

## Justera känslan

Utseendet styrs av konstanterna högst upp i `SceneEngine` i
`SoulTreeWallpaperService.kt` (samma parametrar som reglagen i webb-mocken):

```kotlin
private val cfgWind = 0.45f      // hur mycket slingorna gungar
private val cfgGlow = 0.60f      // glödstyrka (krona, slingor, lyktor)
private val cfgPar  = 0.70f      // lutnings-/parallax-effekt
private val cfgLanterns = 1.0f   // täthet på marklyktorna
private val cfgSprites  = 0.5f   // hur många fröandar som svävar
```

Vill du ha dem som live-inställningar (t.ex. via `SharedPreferences` +
inställningsskärm) är det nästa naturliga steg.
