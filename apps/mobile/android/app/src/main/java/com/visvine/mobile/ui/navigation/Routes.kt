package com.visvine.mobile.ui.navigation

import android.net.Uri

/**
 * Route table: an auth/main switch, a tab host (Home / Messages / Activity),
 * the root-level details (Directory and Events, reached from Home; a person,
 * an event, a conversation, an agent chat, the new-message picker), and modal
 * Profile / EditProfile / Settings.
 */
object Routes {
    const val MAIN = "main"

    // Unauthenticated
    const val LOGIN = "login"
    const val DEV_LOGIN = "dev_login"

    // Modal-style
    const val PROFILE = "profile"
    const val EDIT_PROFILE = "edit_profile"
    const val SETTINGS = "settings"

    // Tabs
    const val HOME = "home"
    const val MESSAGES = "messages"
    const val ACTIVITY = "activity"

    // Root-level details reached from Home
    const val DIRECTORY = "directory"
    const val EVENTS = "events"

    // Detail: Full profile
    const val ARG_PERSON_ID = "personId"
    const val ARG_PERSON_NAME = "personName"
    const val FULL_PROFILE = "full_profile/{$ARG_PERSON_ID}?$ARG_PERSON_NAME={$ARG_PERSON_NAME}"
    fun fullProfile(personId: String, name: String?): String {
        val base = "full_profile/${Uri.encode(personId)}"
        return if (name != null) "$base?$ARG_PERSON_NAME=${Uri.encode(name)}" else base
    }

    // Detail: Event
    const val ARG_EVENT_ID = "eventId"
    const val ARG_EVENT_TITLE = "eventTitle"
    const val EVENT_DETAIL = "event_detail/{$ARG_EVENT_ID}?$ARG_EVENT_TITLE={$ARG_EVENT_TITLE}"
    fun eventDetail(eventId: String, title: String?): String {
        val base = "event_detail/${Uri.encode(eventId)}"
        return if (title != null) "$base?$ARG_EVENT_TITLE=${Uri.encode(title)}" else base
    }

    // Detail: Conversation
    const val ARG_CONVERSATION_ID = "conversationId"
    const val ARG_CONVERSATION_NAME = "conversationName"
    const val CONVERSATION = "conversation/{$ARG_CONVERSATION_ID}?$ARG_CONVERSATION_NAME={$ARG_CONVERSATION_NAME}"
    fun conversation(id: String, name: String?): String {
        val base = "conversation/${Uri.encode(id)}"
        return if (name != null) "$base?$ARG_CONVERSATION_NAME=${Uri.encode(name)}" else base
    }

    // Detail: Agent chat — a thread with one agent in one space
    const val ARG_SPACE_ID = "spaceId"
    const val ARG_AGENT_NAME = "agentName"
    const val ARG_AGENT_TITLE = "agentTitle"
    const val AGENT_CHAT = "agent_chat/{$ARG_SPACE_ID}/{$ARG_AGENT_NAME}?$ARG_AGENT_TITLE={$ARG_AGENT_TITLE}"
    fun agentChat(spaceId: String, name: String, title: String?): String {
        val base = "agent_chat/${Uri.encode(spaceId)}/${Uri.encode(name)}"
        return if (title != null) "$base?$ARG_AGENT_TITLE=${Uri.encode(title)}" else base
    }

    // The person picker a new DM starts from
    const val NEW_MESSAGE = "new_message"

    /** Map a pending-route hint ("Home"/"Messages"/"Activity") to a tab route. */
    fun tabForPendingRoute(name: String?): String = when (name?.lowercase()) {
        "messages" -> MESSAGES
        "activity" -> ACTIVITY
        else -> HOME
    }
}
