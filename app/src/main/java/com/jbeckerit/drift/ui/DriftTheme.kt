package com.jbeckerit.drift.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object DriftSpace {
    val xSmall = 4.dp
    val small = 8.dp
    val medium = 12.dp
    val large = 16.dp
    val xLarge = 20.dp
    val xxLarge = 28.dp
}

private val DriftDarkColors = darkColorScheme(
    primary = Color(0xFFA5DCC7),
    onPrimary = Color(0xFF07372B),
    primaryContainer = Color(0xFF1D5140),
    onPrimaryContainer = Color(0xFFC0F6DF),
    secondary = Color(0xFFB9CBE5),
    onSecondary = Color(0xFF253447),
    secondaryContainer = Color(0xFF3A4A5F),
    tertiary = Color(0xFFF3C18F),
    onTertiary = Color(0xFF452B11),
    tertiaryContainer = Color(0xFF5E421F),
    background = Color(0xFF101614),
    onBackground = Color(0xFFE2E9E4),
    surface = Color(0xFF171E1B),
    onSurface = Color(0xFFE2E9E4),
    surfaceVariant = Color(0xFF2A3731),
    onSurfaceVariant = Color(0xFFC2CEC6),
    outline = Color(0xFF8B9B91),
    error = Color(0xFFFFB4AB),
)

private val DriftLightColors = lightColorScheme(
    primary = Color(0xFF16654F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFBDF2DC),
    onPrimaryContainer = Color(0xFF002117),
    secondary = Color(0xFF4B6079),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD3E4FE),
    tertiary = Color(0xFF76552F),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFDDB7),
    background = Color(0xFFF7FBF6),
    onBackground = Color(0xFF181D1A),
    surface = Color(0xFFF7FBF6),
    onSurface = Color(0xFF181D1A),
    surfaceVariant = Color(0xFFDCE7DF),
    onSurfaceVariant = Color(0xFF404943),
    outline = Color(0xFF707A73),
    error = Color(0xFFBA1A1A),
)

private val DriftTypography = Typography(
    displaySmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 36.sp, lineHeight = 42.sp, letterSpacing = (-0.7).sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-0.4).sp),
    headlineSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 30.sp),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 27.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 23.sp),
    bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 26.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
)

private val DriftShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(26.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(32.dp),
)

@Composable
fun DriftTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DriftDarkColors else DriftLightColors,
        typography = DriftTypography,
        shapes = DriftShapes,
        content = content,
    )
}
