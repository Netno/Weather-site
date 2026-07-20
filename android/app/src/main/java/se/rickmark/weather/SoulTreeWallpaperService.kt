package se.rickmark.weather

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.service.wallpaper.WallpaperService
import android.view.Choreographer
import android.view.SurfaceHolder
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * Levande bakgrund: "Själarnas träd" (Eywa-inspirerat).
 *
 * En fluffig, lysande pilträdskrona av hängande slingor, en slingrande S-stam med
 * grenar, knotiga rötter, en mark full av glödande lyktor + neurala trådar, samt
 * svävande fröandar (atokirina). Kronan gungar i "vind" och hela djupet tippar i
 * parallax när telefonen lutas (accelerometer) eller när man swajar mellan
 * hemskärmarna. Porterad från webb-mocken.
 */
class SoulTreeWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = SceneEngine()

    private inner class SceneEngine : Engine(), Choreographer.FrameCallback, SensorEventListener {

        private val choreographer = Choreographer.getInstance()
        private val sensors = this@SoulTreeWallpaperService.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        private val accelerometer: Sensor? = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        private var running = false
        private var isVisible = false
        private var w = 1
        private var h = 1
        private var minDim = 1f
        private var sc = 1f            // stroke/detalj-skala relativt en ~412px logisk bredd
        private var startNanos = 0L

        // Konfiguration – matchar mockens fina värden.
        private val cfgWind = 0.45f
        private val cfgGlow = 0.60f
        private val cfgPar = 0.70f
        private val cfgLanterns = 1.0f
        private val cfgSprites = 0.5f

        // Lutning (låg-passad gravitation) + hemskärms-offset.
        private var gX = 0f
        private var gY = SensorManager.GRAVITY_EARTH
        private var gZ = 0f
        private var tiltX = 0f
        private var tiltY = 0f
        private var xOffset = 0.5f

        private val baseY = 0.50f      // där stammen möter rötterna (normaliserat)

        // ---- färgtoner (lavendel-rosa slingor) ----
        private val toneR = intArrayOf(224, 208, 236, 214)
        private val toneG = intArrayOf(172, 150, 200, 160)
        private val toneB = intArrayOf(216, 208, 232, 224)

        private fun aCol(al: Float, r: Int, g: Int, b: Int): Int =
            Color.argb((al * 255f).toInt().coerceIn(0, 255), r, g, b)

        // ---- glow-sprite (återanvänds för alla runda sken) ----
        private val glowSize = 128
        private val glowBmp: Bitmap = Bitmap.createBitmap(glowSize, glowSize, Bitmap.Config.ARGB_8888).also { bmp ->
            val cc = Canvas(bmp)
            val p = Paint(Paint.ANTI_ALIAS_FLAG)
            val c2 = glowSize / 2f
            p.shader = RadialGradient(
                c2, c2, c2,
                intArrayOf(aCol(1f, 255, 255, 255), aCol(0.47f, 255, 255, 255), aCol(0.16f, 255, 255, 255), aCol(0f, 255, 255, 255)),
                floatArrayOf(0f, 0.3f, 0.55f, 1f), Shader.TileMode.CLAMP
            )
            cc.drawCircle(c2, c2, c2, p)
        }

        private val addX = PorterDuffXfermode(PorterDuff.Mode.ADD)
        private fun mult(r: Int, g: Int, b: Int): ColorFilter = PorterDuffColorFilter(Color.rgb(r, g, b), PorterDuff.Mode.MULTIPLY)

        private val filterWarm = mult(255, 198, 128)
        private val filterCyan = mult(120, 224, 255)
        private val filterPink = mult(228, 168, 220)
        private val filterHalo = mult(200, 235, 255)
        private val filterCore = mult(240, 205, 240)
        private val filterCloud = mult(226, 205, 245)
        private val lanternFilters = arrayOf(filterWarm, filterCyan, filterPink)
        private val toneFilters = Array(4) { i -> mult(toneR[i], toneG[i], toneB[i]) }

        // ---- paints ----
        private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true; xfermode = addX }
        private val bgPaint = Paint()
        private val groundPaint = Paint()
        private val crownGlowPaint = Paint().apply { xfermode = addX }
        private val vignettePaint = Paint()
        private val trunkPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val rootPaint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val rimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        private val fluffPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; xfermode = addX }
        private val streamerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; xfermode = addX }
        private val filamentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; xfermode = addX }
        private val mistPaint = Paint().apply { xfermode = addX }
        private val spritePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; xfermode = addX }
        private val beadPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = addX }

        private val toneShaders = Array(4) { i ->
            val r = toneR[i]; val g = toneG[i]; val b = toneB[i]
            LinearGradient(
                0f, 0f, 0f, 1f,
                intArrayOf(aCol(0.55f, r, g, b), aCol(0.32f, r, g, b), aCol(0.06f, min(r + 20, 255), min(g + 30, 255), b)),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
            )
        }

        // ---- scen-element ----
        private class Cluster(val cx: Float, val cy: Float, val r: Float, val phase: Float)
        private class Tendril(
            val ox: Float, val oy: Float, val len: Float, val curveX: Float, val tone: Int,
            val swayAmp: Float, val swaySpeed: Float, val phase: Float, val depth: Float,
            val width: Float, val tip: Boolean, val fluff: Boolean
        )
        private class Seg(val x0: Float, val y0: Float, val cx: Float, val cy: Float, val x1: Float, val y1: Float, val w0: Float, val w1: Float)
        private class Sprite(
            val x0: Float, val y0: Float, val depth: Float, val r: Float, val arms: Int, val legs: Int,
            val rise: Float, val swayAmp: Float, val swaySpeed: Float, val phase: Float,
            val rot: Float, val rotSpeed: Float, val wob: Float, val pulseSpeed: Float, val pulsePhase: Float
        )
        private class Lantern(val x: Float, val y: Float, val near: Float, val r: Float, val filterIndex: Int, val tw: Float, val ph: Float)
        private class Filament(val dir: Float, val reach: Float, val bow: Float, val phase: Float)
        private class MistBand(val y: Float, val h: Float)

        private val clusters = ArrayList<Cluster>()
        private val tendrils = ArrayList<Tendril>()
        private val roots = ArrayList<Seg>()
        private val branches = ArrayList<Seg>()
        private val trunkSpine = ArrayList<FloatArray>()
        private val sprites = ArrayList<Sprite>()
        private val lanterns = ArrayList<Lantern>()
        private val filaments = ArrayList<Filament>()
        private val mist = ArrayList<MistBand>()

        // återanvändbara geometri-objekt (undvik allokering per frame)
        private val mtx = Matrix()
        private val strand = Path()
        private val fillPath = Path()
        private val rimPath = Path()
        private val leftX = FloatArray(13)
        private val leftY = FloatArray(13)
        private val rightX = FloatArray(13)
        private val rightY = FloatArray(13)

        init {
            build()
        }

        private fun build() {
            val rnd = Random(20240720L)
            fun f() = rnd.nextFloat()

            // ---- fluffig krona (klasar) ----
            val cn = 13
            for (i in 0 until cn) {
                val ang = (i / (cn - 1f) - 0.5f) * 2.25f
                val rr = 0.8f + f() * 0.5f
                val cx = 0.5f + sin(ang) * (0.25f + f() * 0.06f) * rr
                val cy = 0.13f + (1f - cos(ang)) * 0.20f + (f() - 0.5f) * 0.05f
                clusters.add(Cluster(cx, cy, 0.05f + f() * 0.04f, f() * TAU))
            }
            for (k in 0 until 5) {
                clusters.add(Cluster(0.5f + (f() - 0.5f) * 0.4f, 0.15f + f() * 0.18f, 0.055f + f() * 0.03f, f() * TAU))
            }

            // ---- slingor: långa streamers + korta fluff-strån ----
            for (cl in clusters) {
                val streamers = 13 + (f() * 7f).toInt()
                for (j in 0 until streamers) {
                    val spread = f() - 0.5f
                    tendrils.add(
                        Tendril(
                            cl.cx + spread * cl.r * 2.4f, cl.cy + (f() - 0.4f) * cl.r,
                            0.26f + f() * 0.42f + kotlin.math.abs(cl.cx - 0.5f) * 0.28f,
                            spread * 0.06f + (f() - 0.5f) * 0.03f, (f() * 4f).toInt().coerceIn(0, 3),
                            0.02f + f() * 0.05f, 0.25f + f() * 0.5f, f() * TAU,
                            0.7f + f() * 0.3f, 0.5f + f() * 0.8f, f() < 0.5f, false
                        )
                    )
                }
                val fluff = 12 + (f() * 8f).toInt()
                for (j in 0 until fluff) {
                    val spread = f() - 0.5f
                    tendrils.add(
                        Tendril(
                            cl.cx + spread * cl.r * 2.7f, cl.cy + (f() - 0.65f) * cl.r,
                            0.05f + f() * 0.15f, spread * 0.05f + (f() - 0.5f) * 0.03f,
                            (f() * 4f).toInt().coerceIn(0, 3),
                            0.015f + f() * 0.03f, 0.3f + f() * 0.6f, f() * TAU,
                            0.7f + f() * 0.3f, 0.4f + f() * 0.5f, false, true
                        )
                    )
                }
            }
            tendrils.sortBy { it.oy }

            // ---- S-stam + grenar ----
            trunkSpine.add(floatArrayOf(0.50f, 0.53f)); trunkSpine.add(floatArrayOf(0.452f, 0.47f))
            trunkSpine.add(floatArrayOf(0.556f, 0.405f)); trunkSpine.add(floatArrayOf(0.494f, 0.345f))
            trunkSpine.add(floatArrayOf(0.508f, 0.30f))
            branches.add(Seg(0.53f, 0.40f, 0.62f, 0.34f, 0.71f, 0.29f, 0.030f, 0.004f))
            branches.add(Seg(0.50f, 0.35f, 0.40f, 0.31f, 0.30f, 0.27f, 0.028f, 0.004f))
            branches.add(Seg(0.505f, 0.31f, 0.50f, 0.26f, 0.50f, 0.21f, 0.024f, 0.003f))
            branches.add(Seg(0.545f, 0.43f, 0.61f, 0.42f, 0.67f, 0.40f, 0.020f, 0.003f))
            branches.add(Seg(0.47f, 0.42f, 0.40f, 0.41f, 0.33f, 0.39f, 0.020f, 0.003f))

            // ---- knotiga rötter ----
            val rn = 9
            for (i in 0 until rn) {
                val dir = (i / (rn - 1f) - 0.5f) * 2.2f
                val spreadX = sin(dir) * (0.16f + f() * 0.18f)
                val endX = 0.5f + spreadX
                val endY = 0.70f + f() * 0.12f
                val ctrlX = 0.5f + spreadX * 0.4f + (f() - 0.5f) * 0.08f
                val ctrlY = baseY + (endY - baseY) * 0.45f
                roots.add(Seg(0.5f + (f() - 0.5f) * 0.05f, baseY, ctrlX, ctrlY, endX, endY, 0.05f + f() * 0.03f, 0.004f + f() * 0.006f))
            }
            roots.sortBy { it.w0 }

            // ---- fröandar (atokirina) ----
            for (i in 0 until 22) {
                sprites.add(
                    Sprite(
                        f(), f() * 1.4f, 0.35f + f() * 0.65f, 0.022f + f() * 0.045f,
                        13 + (f() * 8f).toInt(), 3 + (f() * 3f).toInt(),
                        0.006f + f() * 0.013f, 0.02f + f() * 0.045f, 0.12f + f() * 0.3f, f() * TAU,
                        f() * TAU, (f() - 0.5f) * 0.2f, 0.6f + f() * 1.2f, 0.7f + f() * 0.8f, f() * TAU
                    )
                )
            }

            // ---- marklyktor (perspektiv) ----
            for (i in 0 until 220) {
                val yy = 0.58f + pow07(f()) * 0.46f
                val near = (yy - 0.58f) / 0.46f
                val roll = f()
                val fi = if (roll < 0.6f) 0 else if (roll < 0.85f) 1 else 2
                lanterns.add(Lantern(f(), yy, near, (0.4f + f() * 1.4f) * (0.5f + near), fi, 0.4f + f() * 1.8f, f() * TAU))
            }
            lanterns.sortBy { it.y }

            // ---- neurala trådar ----
            for (i in 0 until 30) {
                filaments.add(Filament((i / 30f) * TAU, 0.3f + f() * 0.45f, (f() - 0.5f) * 0.5f, f() * TAU))
            }

            // ---- drivande dis ----
            for (i in 0 until 3) mist.add(MistBand(0.4f + i * 0.16f + f() * 0.05f, 0.12f + f() * 0.06f))
        }

        // ---- ytans livscykel ----
        override fun onVisibilityChanged(visible: Boolean) {
            isVisible = visible
            if (visible) startLoop() else stopLoop()
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            w = width; h = height; minDim = min(w, h).toFloat(); sc = w / 412f
            buildSizedShaders()
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) { stopLoop() }

        override fun onOffsetsChanged(xO: Float, yO: Float, xS: Float, yS: Float, xP: Int, yP: Int) {
            xOffset = xO
        }

        private fun startLoop() {
            if (running) return
            running = true
            accelerometer?.let { sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
            choreographer.postFrameCallback(this)
        }

        private fun stopLoop() {
            running = false
            sensors.unregisterListener(this)
            choreographer.removeFrameCallback(this)
        }

        override fun doFrame(frameTimeNanos: Long) {
            if (!running || !isVisible) return
            if (startNanos == 0L) startNanos = frameTimeNanos
            val t = (frameTimeNanos - startNanos) / 1_000_000_000f

            // mjuka lutningen
            val g = SensorManager.GRAVITY_EARTH
            val tTX = (-gX / g).coerceIn(-1f, 1f)
            val tTY = ((gY / g) - 0.9f).times(2f).coerceIn(-1f, 1f)
            tiltX += (tTX - tiltX) * 0.06f
            tiltY += (tTY - tiltY) * 0.06f

            val holder = surfaceHolder
            var canvas: Canvas? = null
            try {
                canvas = if (android.os.Build.VERSION.SDK_INT >= 26) holder.lockHardwareCanvas() else holder.lockCanvas()
                if (canvas != null) render(canvas, t)
            } finally {
                if (canvas != null) try { holder.unlockCanvasAndPost(canvas) } catch (_: Exception) {}
            }
            if (running && isVisible) choreographer.postFrameCallback(this)
        }

        // ---- statiska shaders per storlek ----
        private fun buildSizedShaders() {
            val fh = h.toFloat()
            bgPaint.shader = LinearGradient(
                0f, 0f, 0f, fh,
                intArrayOf(Color.rgb(20, 28, 52), Color.rgb(26, 33, 66), Color.rgb(14, 18, 40), Color.rgb(7, 10, 22)),
                floatArrayOf(0f, 0.42f, 0.74f, 1f), Shader.TileMode.CLAMP
            )
            groundPaint.shader = LinearGradient(
                0f, fh * 0.56f, 0f, fh,
                intArrayOf(Color.argb(0, 12, 14, 32), Color.argb(128, 10, 10, 26), Color.argb(217, 6, 6, 16)),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
            )
            crownGlowPaint.shader = RadialGradient(
                w * 0.5f, fh * 0.22f, minDim * 0.7f,
                intArrayOf(aCol(0.20f, 214, 158, 210), aCol(0.08f, 150, 110, 180), aCol(0f, 150, 110, 180)),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
            )
            vignettePaint.shader = RadialGradient(
                w * 0.5f, fh * 0.55f, minDim * 0.95f,
                intArrayOf(Color.argb(0, 0, 0, 0), Color.argb(0, 0, 0, 0), aCol(0.6f, 3, 4, 12)),
                floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
            )
            trunkPaint.shader = LinearGradient(
                0.40f * w, 0f, 0.60f * w, 0f,
                intArrayOf(Color.rgb(7, 5, 16), Color.rgb(40, 29, 64), Color.rgb(7, 5, 16)),
                floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
            )
            rootPaint.shader = LinearGradient(
                0f, baseY * fh, 0f, 0.82f * fh,
                intArrayOf(Color.rgb(34, 24, 56), Color.rgb(8, 6, 16)),
                floatArrayOf(0f, 1f), Shader.TileMode.CLAMP
            )
        }

        // ---- rendering ----
        private fun px() = tiltX * cfgPar

        private fun render(c: Canvas, t: Float) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val wind = (sin(t * 0.4f) + sin(t * 0.13f + 1f) * 0.6f) / 1.6f * (0.4f + cfgWind)

            c.drawColor(Color.rgb(7, 10, 22))
            c.drawPaint(bgPaint)
            c.drawPaint(crownGlowPaint)
            drawMist(c)
            c.drawPaint(groundPaint)
            drawFilaments(c, t)
            drawLanterns(c, t)
            drawRoots(c)
            drawTrunk(c)
            drawCrown(c, t)
            drawTendrils(c, t, wind)
            drawSprites(c, t)
            c.drawPaint(vignettePaint)
        }

        private fun drawGlow(c: Canvas, cx: Float, cy: Float, radius: Float, filter: ColorFilter?, alpha: Float) {
            val s = radius * 2f / glowSize
            mtx.reset(); mtx.setScale(s, s); mtx.postTranslate(cx - radius, cy - radius)
            glowPaint.colorFilter = filter
            glowPaint.alpha = (alpha * 255f).toInt().coerceIn(0, 255)
            c.drawBitmap(glowBmp, mtx, glowPaint)
        }

        private fun drawMist(c: Canvas) {
            val fw = w.toFloat(); val fh = h.toFloat()
            for (m in mist) {
                val y = m.y * fh
                val hh = m.h * fh
                mistPaint.shader = LinearGradient(
                    0f, y - hh, 0f, y + hh,
                    intArrayOf(Color.argb(0, 120, 140, 200), aCol(0.05f, 130, 150, 205), Color.argb(0, 120, 140, 200)),
                    floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
                )
                c.drawRect(0f, y - hh, fw, y + hh, mistPaint)
            }
        }

        private fun drawFilaments(c: Canvas, t: Float) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val bx = (0.5f + px() * 0.03f) * fw
            val by = 0.64f * fh
            filamentPaint.strokeWidth = 1f * sc
            for (fl in filaments) {
                val sh = if (sin(fl.dir) < 0f) -1f else 1f
                val ex = bx + cos(fl.dir) * fl.reach * fw * 0.7f
                val ey = by + kotlin.math.abs(sin(fl.dir)) * fl.reach * fh * 0.5f + 0.04f * fh
                val mx = (bx + ex) / 2f + fl.bow * 0.1f * fw * sh
                val my = (by + ey) / 2f + kotlin.math.abs(fl.bow) * 0.05f * fh
                val flick = 0.06f + 0.05f * (0.5f + 0.5f * sin(t * 0.6f + fl.phase))
                filamentPaint.color = aCol(flick, 120, 150, 220)
                strand.rewind(); strand.moveTo(bx, by); strand.quadTo(mx, my, ex, ey)
                c.drawPath(strand, filamentPaint)
            }
        }

        private fun drawLanterns(c: Canvas, t: Float) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val gi = 0.5f + cfgGlow
            val n = (lanterns.size * cfgLanterns).toInt()
            for (i in 0 until n) {
                val f = lanterns[i]
                val tw = 0.3f + 0.7f * (0.5f + 0.5f * sin(t * f.tw + f.ph))
                val x = (f.x + px() * 0.05f * f.near) * fw
                val y = f.y * fh
                val rad = f.r * (1f + f.near) * sc * 4f
                drawGlow(c, x, y, rad, lanternFilters[f.filterIndex], 0.9f * gi * tw)
            }
        }

        private fun taper(x0: Float, y0: Float, cx: Float, cy: Float, x1: Float, y1: Float, w0: Float, w1: Float) {
            fillPath.rewind(); rimPath.rewind()
            val steps = 12
            for (s in 0..steps) {
                val u = s / steps.toFloat(); val iu = 1f - u
                val mx = iu * iu * x0 + 2f * iu * u * cx + u * u * x1
                val my = iu * iu * y0 + 2f * iu * u * cy + u * u * y1
                val dx = 2f * iu * (cx - x0) + 2f * u * (x1 - cx)
                val dy = 2f * iu * (cy - y0) + 2f * u * (y1 - cy)
                val len = sqrt(dx * dx + dy * dy).let { if (it == 0f) 1f else it }
                val nx = -dy / len; val ny = dx / len
                val ww = (w0 * (1f - u) + w1 * u) / 2f
                leftX[s] = mx + nx * ww; leftY[s] = my + ny * ww
                rightX[s] = mx - nx * ww; rightY[s] = my - ny * ww
            }
            fillPath.moveTo(leftX[0], leftY[0])
            for (s in 1..steps) fillPath.lineTo(leftX[s], leftY[s])
            for (s in steps downTo 0) fillPath.lineTo(rightX[s], rightY[s])
            fillPath.close()
            rimPath.moveTo(leftX[0], leftY[0])
            for (s in 1..steps) rimPath.lineTo(leftX[s], leftY[s])
        }

        private fun drawRoots(c: Canvas) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val sx = px() * 0.03f * fw
            rimPaint.color = aCol(0.22f, 150, 140, 205); rimPaint.strokeWidth = 1.2f * sc
            for (r in roots) {
                taper(r.x0 * fw + sx, r.y0 * fh, r.cx * fw + sx, r.cy * fh, r.x1 * fw + sx, r.y1 * fh, r.w0 * fw, r.w1 * fw)
                c.drawPath(fillPath, rootPaint)
                c.drawPath(rimPath, rimPaint)
            }
        }

        private fun drawTrunk(c: Canvas) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val sx = px() * 0.03f * fw
            rimPaint.color = aCol(0.2f, 162, 150, 215); rimPaint.strokeWidth = 1.2f * sc
            for (b in branches) {
                taper(b.x0 * fw + sx, b.y0 * fh, b.cx * fw + sx, b.cy * fh, b.x1 * fw + sx, b.y1 * fh, b.w0 * fw, b.w1 * fw)
                c.drawPath(fillPath, trunkPaint)
                c.drawPath(rimPath, rimPaint)
            }
            val wArr = floatArrayOf(0.084f, 0.063f, 0.046f, 0.032f, 0.02f)
            for (i in 0 until trunkSpine.size - 1) {
                val p = trunkSpine[i]; val q = trunkSpine[i + 1]
                val mx = (p[0] + q[0]) / 2f; val my = (p[1] + q[1]) / 2f
                taper(p[0] * fw + sx, p[1] * fh, mx * fw + sx, my * fh, q[0] * fw + sx, q[1] * fh, wArr[i] * fw, wArr[i + 1] * fw)
                c.drawPath(fillPath, trunkPaint)
                c.drawPath(rimPath, rimPaint)
            }
        }

        private fun drawCrown(c: Canvas, t: Float) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val sx = px() * 0.045f * fw
            // mjukt moln-sken bakom hela kronan
            drawGlow(c, 0.5f * fw + sx, 0.2f * fh, minDim * 0.55f, filterCloud, 0.16f * (0.5f + cfgGlow))
            for (cl in clusters) {
                val beat = 0.7f + 0.3f * (0.5f + 0.5f * sin(t * 0.8f + cl.phase))
                drawGlow(c, cl.cx * fw + sx, cl.cy * fh, cl.r * minDim * 1.4f, filterCore, 0.4f * beat * (0.5f + cfgGlow))
            }
        }

        private fun drawTendrils(c: Canvas, t: Float, wind: Float) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val sx = px() * 0.045f * fw
            val gi = 0.5f + cfgGlow
            for (T in tendrils) {
                val sway = (wind * 0.5f + sin(t * T.swaySpeed + T.phase) * 0.5f) * T.swayAmp + px() * 0.045f * T.depth
                val ox = T.ox * fw + sx * T.depth
                val oy = T.oy * fh
                val lenPx = T.len * fh
                val steps = 11
                strand.rewind()
                var lastX = 0f; var lastY = 0f
                for (s in 0..steps) {
                    val u = s / steps.toFloat()
                    val x = ox + (T.curveX * u + sway * (u * sqrt(u))) * fw
                    val y = oy + lenPx * (u * 0.55f + u * u * 0.45f)
                    if (s == 0) strand.moveTo(x, y) else strand.lineTo(x, y)
                    lastX = x; lastY = y
                }
                if (T.fluff) {
                    val r = toneR[T.tone]; val g = toneG[T.tone]; val b = toneB[T.tone]
                    fluffPaint.color = aCol(0.4f * gi, min(r + 22, 255), min(g + 26, 255), b)
                    fluffPaint.strokeWidth = T.width * sc
                    c.drawPath(strand, fluffPaint)
                } else {
                    mtx.reset(); mtx.setScale(1f, lenPx); mtx.postTranslate(0f, oy)
                    val sh = toneShaders[T.tone]
                    sh.setLocalMatrix(mtx)
                    streamerPaint.shader = sh
                    streamerPaint.alpha = (gi.coerceAtMost(1f) * 255f).toInt()
                    streamerPaint.strokeWidth = T.width * sc
                    c.drawPath(strand, streamerPaint)
                    if (T.tip) {
                        drawGlow(c, lastX, lastY, T.width * 3.5f * sc, toneFilters[T.tone], 0.4f * gi)
                    }
                }
            }
            streamerPaint.shader = null
        }

        private fun drawSprites(c: Canvas, t: Float) {
            val fw = w.toFloat(); val fh = h.toFloat()
            val gi = 0.45f + cfgGlow * 0.7f
            val n = (sprites.size * cfgSprites).toInt()
            for (i in 0 until n) {
                val S = sprites[i]
                val par = px() * 0.08f * S.depth
                val parY = tiltY * cfgPar * 0.06f * S.depth
                val x = (S.x0 + sin(t * S.swaySpeed + S.phase) * S.swayAmp + par) * fw
                val yNorm = wrap(S.y0 - t * S.rise * (0.5f + cfgWind * 0.5f)) + parY
                val y = yNorm * fh
                val pulse = 1f + sin(t * S.pulseSpeed + S.pulsePhase) * 0.1f
                val R = S.r * minDim * pulse

                c.save()
                c.translate(x, y)
                c.rotate((S.rot + t * S.rotSpeed) * DEG)
                // halo
                drawGlow(c, 0f, 0f, R * 1.3f, filterHalo, 0.14f * gi)
                // fontän av bågande trådar
                for (a in 0 until S.arms) {
                    val ang = (a / S.arms.toFloat()) * TAU
                    val wob = sin(t * S.wob + a * 0.9f) * 0.14f
                    val ca = cos(ang + wob); val sa = sin(ang + wob)
                    val tipX = ca * R; val tipY = sa * R * 0.86f - R * 0.18f
                    val ctrlX = ca * R * 0.42f; val ctrlY = sa * R * 0.42f - R * 0.55f
                    strand.rewind(); strand.moveTo(0f, 0f); strand.quadTo(ctrlX, ctrlY, tipX, tipY)
                    spritePaint.color = aCol(0.10f * gi, 180, 225, 255); spritePaint.strokeWidth = (R * 0.05f).coerceAtLeast(1f)
                    c.drawPath(strand, spritePaint)
                    spritePaint.color = aCol(0.5f * gi, 224, 245, 255); spritePaint.strokeWidth = (R * 0.018f).coerceAtLeast(0.5f)
                    c.drawPath(strand, spritePaint)
                    beadPaint.color = aCol(0.6f * gi, 240, 250, 255)
                    c.drawCircle(tipX, tipY, R * 0.03f, beadPaint)
                }
                // dinglande ben
                for (l in 0 until S.legs) {
                    val off = (l / (S.legs - 1f).coerceAtLeast(1f) - 0.5f) * R * 0.5f
                    val swing = sin(t * 1.3f + l) * R * 0.12f
                    strand.rewind(); strand.moveTo(off * 0.3f, R * 0.05f)
                    strand.quadTo(off + swing, R * 0.55f, off * 0.6f + swing, R * 0.95f)
                    spritePaint.color = aCol(0.4f * gi, 214, 240, 255); spritePaint.strokeWidth = (R * 0.02f).coerceAtLeast(0.5f)
                    c.drawPath(strand, spritePaint)
                }
                // lysande frökärna
                drawGlow(c, 0f, -R * 0.05f, R * 0.5f, null, 0.9f * gi)
                c.restore()
            }
        }

        override fun onSensorChanged(event: SensorEvent) {
            if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
                val al = 0.15f
                gX += al * (event.values[0] - gX)
                gY += al * (event.values[1] - gY)
                gZ += al * (event.values[2] - gZ)
            }
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    private companion object {
        val TAU = (Math.PI * 2).toFloat()
        val DEG = (180.0 / Math.PI).toFloat()   // radianer → grader (Canvas.rotate vill ha grader)
        fun pow07(x: Float): Float = Math.pow(x.toDouble(), 0.7).toFloat()
        fun wrap(v: Float): Float {
            var r = v % 1.4f
            if (r < 0f) r += 1.4f
            return r - 0.2f
        }
    }
}
