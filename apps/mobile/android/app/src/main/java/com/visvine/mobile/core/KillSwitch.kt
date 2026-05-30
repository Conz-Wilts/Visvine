package com.visvine.mobile.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In-app remote kill-switch / force-update flag, built in from day one per the
 * migration plan's safety-net (blast-radius control + fix-forward, not rollback).
 *
 * This is the single seam to wire a remote source (Firebase Remote Config, a
 * tiny `/api/mobile/config` endpoint, etc.). It defaults to [State.Operational]
 * so it is inert until a remote source is connected; [refresh] is where that
 * fetch goes. The root UI gates on this state and shows a blocking screen when
 * the build is disabled or an update is required.
 */
@Singleton
class KillSwitch @Inject constructor() {

    sealed interface State {
        data object Operational : State
        data class Disabled(val message: String) : State
        data class UpdateRequired(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Operational)
    val state: StateFlow<State> = _state.asStateFlow()

    /** Hook for a remote flag fetch. No-op until a remote source is wired. */
    suspend fun refresh() {
        // e.g. _state.value = remoteConfig.fetchMobileGate()
    }
}
