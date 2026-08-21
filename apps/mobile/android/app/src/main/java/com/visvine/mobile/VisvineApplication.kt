package com.visvine.mobile

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Hilt application entry point. The app-wide state the web app holds in nested
 * React contexts (theme → auth → community) lives here as singleton-scoped
 * repositories, injected into ViewModels.
 */
@HiltAndroidApp
class VisvineApplication : Application()
