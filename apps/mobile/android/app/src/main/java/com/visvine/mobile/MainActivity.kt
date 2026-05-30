package com.visvine.mobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import com.visvine.mobile.auth.DeepLinkHandler
import com.visvine.mobile.ui.VisvineRoot
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Single-activity host. `launchMode=singleTask` + onNewIntent funnels the
 * visvine:// OAuth deep link into [DeepLinkHandler], mirroring the
 * Linking.addEventListener / getInitialURL wiring in the old AuthContext.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var deepLinkHandler: DeepLinkHandler

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Cold-start deep link (app launched by the OAuth redirect).
        intent?.data?.let { uri -> deepLinkHandler.handle(uri.toString()) }

        setContent {
            VisvineRoot()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Warm deep link (app already running when the redirect fires).
        intent.data?.let { uri ->
            lifecycleScope.launchWhenStarted {
                deepLinkHandler.handle(uri.toString())
            }
        }
    }
}
