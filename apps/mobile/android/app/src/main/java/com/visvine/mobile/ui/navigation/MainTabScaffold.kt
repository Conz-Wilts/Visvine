package com.visvine.mobile.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.visvine.mobile.ui.components.SearchOverlay
import com.visvine.mobile.ui.screens.directory.DirectoryScreen
import com.visvine.mobile.ui.screens.events.EventsListScreen
import com.visvine.mobile.ui.screens.messaging.ConversationsListScreen
import com.visvine.mobile.ui.viewmodel.SearchViewModel

/**
 * Hosts the three tabs, the floating glass tab bar, and the search overlay —
 * the native equivalent of TabNavigator. Tab content fills the screen and the
 * bar floats over it (content scrolls under the translucent bar, matching RN).
 */
@Composable
fun MainTabScaffold(
    rootNav: NavController,
    isDark: Boolean,
    pendingRoute: String?,
    onPendingRouteConsumed: () -> Unit,
    searchViewModel: SearchViewModel = hiltViewModel(),
) {
    val tabNav = rememberNavController()
    val backStackEntry by tabNav.currentBackStackEntryAsState()
    val currentTab = backStackEntry?.destination?.route ?: Routes.DIRECTORY

    // Land on the tab the OAuth callback requested, then consume the hint.
    LaunchedEffect(pendingRoute) {
        if (pendingRoute != null) {
            selectTab(tabNav, Routes.tabForPendingRoute(pendingRoute))
            onPendingRouteConsumed()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = tabNav,
            startDestination = Routes.DIRECTORY,
            modifier = Modifier.fillMaxSize(),
        ) {
            composable(Routes.DIRECTORY) {
                DirectoryScreen(
                    onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                    onOpenProfile = { personId, name -> rootNav.navigate(Routes.fullProfile(personId, name)) },
                )
            }
            composable(Routes.MESSAGES) {
                ConversationsListScreen(
                    onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                    onOpenConversation = { id, name -> rootNav.navigate(Routes.conversation(id, name)) },
                )
            }
            composable(Routes.EVENTS) {
                EventsListScreen(
                    onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                    onOpenEvent = { id, title -> rootNav.navigate(Routes.eventDetail(id, title)) },
                )
            }
        }

        GlassTabBar(
            isDark = isDark,
            current = currentTab,
            onSelect = { route -> selectTab(tabNav, route) },
            onSearch = { searchViewModel.open() },
            modifier = Modifier.align(Alignment.BottomCenter),
        )

        SearchOverlay(searchViewModel = searchViewModel, isDark = isDark)
    }
}

private fun selectTab(nav: NavController, route: String) {
    nav.navigate(route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
