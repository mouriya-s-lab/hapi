package app.hapi.companion.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF3D6837),
    secondary = Color(0xFF54634D),
    tertiary = Color(0xFF386569),
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFA3D397),
    secondary = Color(0xFFBCCBB2),
    tertiary = Color(0xFFA0CFD2),
)

/**
 * Material3 theme for the HAPI companion app.
 *
 * Dynamic color (Material You) on Android 12+, static fallback schemes below.
 * M5 revisits this for OLED-black surfaces and full token coverage.
 */
@Composable
fun HapiTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
