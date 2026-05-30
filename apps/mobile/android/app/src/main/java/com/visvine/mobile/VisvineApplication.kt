package com.visvine.mobile

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Hilt application entry point. Mirrors the provider nesting the RN app set up in
 * App.tsx (Theme → Auth → Community) — here those become singleton-scoped
 * repositories and Hilt-injected ViewModels instead of React Contexts.
 */
@HiltAndroidApp
class VisvineApplication : Application()
