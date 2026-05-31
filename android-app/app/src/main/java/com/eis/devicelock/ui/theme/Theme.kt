package com.eis.devicelock.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Primary = Color(0xFF0F2A47)
private val PrimaryDark = Color(0xFF081A2E)
private val Accent = Color(0xFFF59E0B)

private val LightColors = lightColorScheme(
    primary = Primary,
    onPrimary = Color.White,
    secondary = Accent,
    onSecondary = Color.Black,
    background = Color(0xFFF8FAFC),
    surface = Color.White,
    onSurface = Color(0xFF0F172A)
)

private val DarkColors = darkColorScheme(
    primary = Accent,
    onPrimary = Color.Black,
    secondary = Primary,
    onSecondary = Color.White,
    background = PrimaryDark,
    surface = Color(0xFF0F172A),
    onSurface = Color.White
)

@Composable
fun EisTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content
    )
}
