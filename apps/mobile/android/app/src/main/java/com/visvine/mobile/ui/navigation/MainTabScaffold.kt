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
import com.visvine.mobile.ui.screens.activity.ActivityScreen
import com.visvine.mobile.ui.screens.home.HomeScreen
import com.visvine.mobile.ui.screens.messaging.MessagesHubScreen
import com.visvine.mobile.ui.viewmodel.SearchViewModel

/**
 * Hosts the three tabs — Home / Messages / Activity — the floating glass tab
 * bar, and the search overlay. Tab content fills the screen and the bar floats
 * over it. Everything a tab opens (a person, an event, a conversation, an
 * agent chat, the Directory and Events screens) is a destination of the root
 * graph, so it sits over the bar.
 */
@Composable
fun MainTabScaffold(
    rootNav: NavController,
    pendingRoute: String?,
    onPendingRouteConsumed: () -> Unit,
    searchViewModel: SearchViewModel = hiltViewModel(),
) {
    val tabNav = rememberNavController()
    val backStackEntry by tabNav.currentBackStackEntryAsState()
    val currentTab = backStackEntry?.destination?.route ?: Routes.HOME

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
            startDestination = Routes.HOME,
            modifier = Modifier.fillMaxSize(),
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                    onOpenPeople = { rootNav.navigate(Routes.DIRECTORY) },
                    onOpenEvents = { rootNav.navigate(Routes.EVENTS) },
                )
            }
            composable(Routes.MESSAGES) {
                MessagesHubScreen(
                    onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                    onOpenAgent = { spaceId, name, title -> rootNav.navigate(Routes.agentChat(spaceId, name, title)) },
                    onOpenConversation = { id, name -> rootNav.navigate(Routes.conversation(id, name)) },
                    onNewMessage = { rootNav.navigate(Routes.NEW_MESSAGE) },
                )
            }
            composable(Routes.ACTIVITY) {
                ActivityScreen(
                    onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                    onOpenAgent = { spaceId, name, title -> rootNav.navigate(Routes.agentChat(spaceId, name, title)) },
                    onOpenConversation = { id, name -> rootNav.navigate(Routes.conversation(id, name)) },
                    onOpenEvent = { id, title -> rootNav.navigate(Routes.eventDetail(id, title)) },
                )
            }
        }

        GlassTabBar(
            current = currentTab,
            onSelect = { route -> selectTab(tabNav, route) },
            onSearch = { searchViewModel.open() },
            modifier = Modifier.align(Alignment.BottomCenter),
        )

        SearchOverlay(searchViewModel = searchViewModel)
    }
}

private fun selectTab(nav: NavController, route: String) {
    nav.navigate(route) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
