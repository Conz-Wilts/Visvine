package com.visvine.mobile.ui.icons

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import com.visvine.mobile.R

/**
 * The app's icons — ours, not Material's.
 *
 * Every glyph is an SVG in `assets/icons/` at the repo root, shared with the web
 * app and iOS, converted into `res/drawable/ic_*.xml` by
 * `scripts/build-icons.mjs`. See `docs/icons.md`.
 *
 * This object exists so call sites read like the Material ones they replaced
 * (`AppIcons.Check` where `Icons.Filled.Check` was) and so a renamed drawable is
 * a compile error here rather than a missing-resource crash out in a screen.
 *
 * Usage is unchanged from Material: the drawables declare their strokes in black
 * and are tinted at the call site, so `Icon(AppIcons.Check, null, tint = ...)`
 * keeps following the theme.
 *
 *   Icon(AppIcons.Check, contentDescription = null, tint = colors.accent)
 *
 * Adding one: add the name to ANDROID_ICONS in scripts/build-icons.mjs, run it,
 * then add the property below.
 */
object AppIcons {
    val ArrowDown: Painter @Composable get() = painterResource(R.drawable.ic_arrow_down)
    val ArrowLeft: Painter @Composable get() = painterResource(R.drawable.ic_arrow_left)
    val ArrowUp: Painter @Composable get() = painterResource(R.drawable.ic_arrow_up)
    val Bell: Painter @Composable get() = painterResource(R.drawable.ic_bell)
    val Calendar: Painter @Composable get() = painterResource(R.drawable.ic_calendar)
    val Check: Painter @Composable get() = painterResource(R.drawable.ic_check)
    val CheckSquare: Painter @Composable get() = painterResource(R.drawable.ic_square_check)
    val ChevronDown: Painter @Composable get() = painterResource(R.drawable.ic_chevron_down)
    val ChevronRight: Painter @Composable get() = painterResource(R.drawable.ic_chevron_right)
    val CircleCheck: Painter @Composable get() = painterResource(R.drawable.ic_circle_check)
    val Clock: Painter @Composable get() = painterResource(R.drawable.ic_clock)
    val Close: Painter @Composable get() = painterResource(R.drawable.ic_x)
    val Edit: Painter @Composable get() = painterResource(R.drawable.ic_pencil)
    val EmptySquare: Painter @Composable get() = painterResource(R.drawable.ic_square)
    val Globe: Painter @Composable get() = painterResource(R.drawable.ic_earth)
    val Help: Painter @Composable get() = painterResource(R.drawable.ic_circle_question_mark)
    val Location: Painter @Composable get() = painterResource(R.drawable.ic_map_pin)
    val Lock: Painter @Composable get() = painterResource(R.drawable.ic_lock)
    val Logout: Painter @Composable get() = painterResource(R.drawable.ic_log_out)
    val Mail: Painter @Composable get() = painterResource(R.drawable.ic_mail)
    val Message: Painter @Composable get() = painterResource(R.drawable.ic_message_circle)
    val Network: Painter @Composable get() = painterResource(R.drawable.ic_waypoints)
    val OpenInNew: Painter @Composable get() = painterResource(R.drawable.ic_external_link)
    val Palette: Painter @Composable get() = painterResource(R.drawable.ic_palette)
    val People: Painter @Composable get() = painterResource(R.drawable.ic_users)
    val Person: Painter @Composable get() = painterResource(R.drawable.ic_user)
    val PersonAdd: Painter @Composable get() = painterResource(R.drawable.ic_user_plus)
    val Search: Painter @Composable get() = painterResource(R.drawable.ic_search)
    val Settings: Painter @Composable get() = painterResource(R.drawable.ic_settings)
    val Tag: Painter @Composable get() = painterResource(R.drawable.ic_tag)
    val Tool: Painter @Composable get() = painterResource(R.drawable.ic_hammer)
}
