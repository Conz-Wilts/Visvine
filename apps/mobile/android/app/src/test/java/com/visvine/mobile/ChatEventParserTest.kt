package com.visvine.mobile

import com.visvine.mobile.data.model.ChatEvent
import com.visvine.mobile.data.realtime.parseChatEvent
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The `data:` lines of the agent chat stream, one per `ChatStreamEvent` type. */
class ChatEventParserTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
        isLenient = true
    }

    private val message = """{"id":"m1","role":"assistant","text":"Hello","status":"done","reason":null,"trace":[{"tool":"read_context","detail":"people/ana.md","ok":true}],"createdAt":"2026-09-22T10:00:00.000Z"}"""

    @Test
    fun `user carries the stored question`() {
        val event = parseChatEvent(json, """{"type":"user","message":${message.replace("assistant", "user")}}""")
        assertTrue(event is ChatEvent.User)
        assertEquals("user", (event as ChatEvent.User).message.role)
        assertEquals("m1", event.message.id)
    }

    @Test
    fun `tool carries the call`() {
        val event = parseChatEvent(json, """{"type":"tool","tool":"fetch_url","detail":"https://example.com"}""")
        assertEquals(ChatEvent.Tool("fetch_url", "https://example.com"), event)
    }

    @Test
    fun `tool_result carries the clipped text`() {
        val event = parseChatEvent(json, """{"type":"tool_result","tool":"fetch_url","text":"<html>"}""")
        assertEquals(ChatEvent.ToolResult("fetch_url", "<html>"), event)
    }

    @Test
    fun `assistant carries the answer text`() {
        val event = parseChatEvent(json, """{"type":"assistant","text":"Done."}""")
        assertEquals(ChatEvent.Assistant("Done."), event)
    }

    @Test
    fun `done carries the stored answer with its trace`() {
        val event = parseChatEvent(json, """{"type":"done","message":$message}""")
        assertTrue(event is ChatEvent.Done)
        val stored = (event as ChatEvent.Done).message
        assertEquals("Hello", stored.text)
        assertEquals("done", stored.status)
        assertEquals(1, stored.trace.size)
        assertEquals("read_context", stored.trace[0].tool)
        assertNull(stored.reason)
    }

    @Test
    fun `error carries the reason and the sentence`() {
        val event = parseChatEvent(json, """{"type":"error","reason":"no_model","message":"This space has no model."}""")
        assertEquals(ChatEvent.Error("no_model", "This space has no model."), event)
    }

    @Test
    fun `an unknown type is ignored`() {
        assertNull(parseChatEvent(json, """{"type":"heartbeat"}"""))
    }

    @Test
    fun `a missing type is ignored`() {
        assertNull(parseChatEvent(json, """{"text":"no type"}"""))
    }

    @Test
    fun `malformed data never throws`() {
        assertNull(parseChatEvent(json, "not json"))
        assertNull(parseChatEvent(json, "[1,2]"))
        assertNull(parseChatEvent(json, """{"type":"done"}"""))
        assertNull(parseChatEvent(json, """{"type":"done","message":"a string"}"""))
    }
}
