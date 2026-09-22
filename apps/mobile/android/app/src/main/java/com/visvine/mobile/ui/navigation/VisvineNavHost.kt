package com.visvine.mobile.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.visvine.mobile.ui.screens.agents.AgentChatScreen
import com.visvine.mobile.ui.screens.auth.DevLoginScreen
import com.visvine.mobile.ui.screens.auth.LoginScreen
import com.visvine.mobile.ui.screens.directory.DirectoryScreen
import com.visvine.mobile.ui.screens.directory.FullProfileScreen
import com.visvine.mobile.ui.screens.events.EventDetailScreen
import com.visvine.mobile.ui.screens.events.EventsListScreen
import com.visvine.mobile.ui.screens.messaging.ConversationScreen
import com.visvine.mobile.ui.screens.messaging.NewMessageScreen
import com.visvine.mobile.ui.screens.profile.EditProfileScreen
import com.visvine.mobile.ui.screens.profile.ProfileScreen
import com.visvine.mobile.ui.screens.settings.SettingsScreen

/** Unauthenticated graph: Login → DevLogin. */
@Composable
fun UnauthNavHost() {
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Routes.LOGIN) {
        composable(Routes.LOGIN) {
            LoginScreen(onDevLogin = { nav.navigate(Routes.DEV_LOGIN) })
        }
        composable(Routes.DEV_LOGIN) {
            DevLoginScreen(onBack = { nav.popBackStack() })
        }
    }
}

/**
 * Authenticated graph: the tab host, the Directory and Events screens Home
 * opens, the details, and the modal screens.
 */
@Composable
fun AuthedNavHost(
    pendingRoute: String?,
    onPendingRouteConsumed: () -> Unit,
) {
    val rootNav = rememberNavController()

    NavHost(navController = rootNav, startDestination = Routes.MAIN) {
        composable(Routes.MAIN) {
            MainTabScaffold(
                rootNav = rootNav,
                pendingRoute = pendingRoute,
                onPendingRouteConsumed = onPendingRouteConsumed,
            )
        }

        // Reached from Home's two rows; each keeps its own ScreenHeader.
        composable(Routes.DIRECTORY) {
            DirectoryScreen(
                onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                onOpenProfile = { personId, name -> rootNav.navigate(Routes.fullProfile(personId, name)) },
            )
        }
        composable(Routes.EVENTS) {
            EventsListScreen(
                onProfileClick = { rootNav.navigate(Routes.PROFILE) },
                onOpenEvent = { id, title -> rootNav.navigate(Routes.eventDetail(id, title)) },
            )
        }

        composable(
            route = Routes.FULL_PROFILE,
            arguments = listOf(
                navArgument(Routes.ARG_PERSON_ID) { type = NavType.StringType },
                navArgument(Routes.ARG_PERSON_NAME) { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            FullProfileScreen(
                initialName = entry.arguments?.getString(Routes.ARG_PERSON_NAME),
                onBack = { rootNav.popBackStack() },
            )
        }

        composable(
            route = Routes.EVENT_DETAIL,
            arguments = listOf(
                navArgument(Routes.ARG_EVENT_ID) { type = NavType.StringType },
                navArgument(Routes.ARG_EVENT_TITLE) { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            EventDetailScreen(
                eventTitle = entry.arguments?.getString(Routes.ARG_EVENT_TITLE),
                onBack = { rootNav.popBackStack() },
            )
        }

        composable(
            route = Routes.CONVERSATION,
            arguments = listOf(
                navArgument(Routes.ARG_CONVERSATION_ID) { type = NavType.StringType },
                navArgument(Routes.ARG_CONVERSATION_NAME) { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            ConversationScreen(
                conversationName = entry.arguments?.getString(Routes.ARG_CONVERSATION_NAME),
                onBack = { rootNav.popBackStack() },
            )
        }

        composable(
            route = Routes.AGENT_CHAT,
            arguments = listOf(
                navArgument(Routes.ARG_SPACE_ID) { type = NavType.StringType },
                navArgument(Routes.ARG_AGENT_NAME) { type = NavType.StringType },
                navArgument(Routes.ARG_AGENT_TITLE) { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) { entry ->
            AgentChatScreen(
                title = entry.arguments?.getString(Routes.ARG_AGENT_TITLE),
                onBack = { rootNav.popBackStack() },
            )
        }

        composable(Routes.NEW_MESSAGE) {
            NewMessageScreen(
                onBack = { rootNav.popBackStack() },
                onOpenConversation = { id, name ->
                    rootNav.navigate(Routes.conversation(id, name)) {
                        popUpTo(Routes.NEW_MESSAGE) { inclusive = true }
                    }
                },
            )
        }

        composable(Routes.PROFILE) {
            ProfileScreen(
                onBack = { rootNav.popBackStack() },
                onEditProfile = { rootNav.navigate(Routes.EDIT_PROFILE) },
                onSettings = { rootNav.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.EDIT_PROFILE) {
            EditProfileScreen(onBack = { rootNav.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { rootNav.popBackStack() })
        }
    }
}
