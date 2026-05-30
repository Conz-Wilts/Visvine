package com.visvine.mobile

import com.visvine.mobile.core.AppConfig
import com.visvine.mobile.data.remote.MediaUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Port of src/services/__tests__/api.test.ts — the resolveMediaUrl contract. */
class MediaUrlTest {

    @Test
    fun `returns null for null, empty`() {
        assertNull(MediaUrl.resolve(null))
        assertNull(MediaUrl.resolve(""))
    }

    @Test
    fun `passes absolute http(s) and data URLs through unchanged`() {
        assertEquals("https://example.com/a.png", MediaUrl.resolve("https://example.com/a.png"))
        assertEquals("http://example.com/a.png", MediaUrl.resolve("http://example.com/a.png"))
        assertEquals("data:image/png;base64,AAA", MediaUrl.resolve("data:image/png;base64,AAA"))
    }

    @Test
    fun `prefixes relative paths with the API base`() {
        assertEquals("${AppConfig.apiBaseUrl}/media/photo.webp", MediaUrl.resolve("/media/photo.webp"))
    }

    @Test
    fun `leaves bare path tokens alone (no leading slash, no scheme)`() {
        assertEquals("bucket/key.webp", MediaUrl.resolve("bucket/key.webp"))
    }
}
