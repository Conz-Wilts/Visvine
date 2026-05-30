package com.visvine.mobile

import com.visvine.mobile.ui.util.rankByQuery
import com.visvine.mobile.ui.util.searchScore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Guards the name-relevance heuristic shared by Directory / Events / Conversations. */
class SearchScoreTest {

    @Test
    fun `exact match scores highest`() {
        assertEquals(10000, searchScore("ada", "ada"))
    }

    @Test
    fun `prefix beats mid-string match`() {
        assertTrue(searchScore("ad", "ada lovelace") > searchScore("ad", "linda adams"))
    }

    @Test
    fun `no match scores zero`() {
        assertEquals(0, searchScore("xyz", "ada lovelace"))
    }

    @Test
    fun `rankByQuery filters out non-matches and keeps order on blank`() {
        val names = listOf("Ada", "Linda", "Bob")
        assertEquals(names, rankByQuery(names, "  ") { it })
        assertEquals(listOf("Ada", "Linda"), rankByQuery(names, "a") { it })
    }
}
