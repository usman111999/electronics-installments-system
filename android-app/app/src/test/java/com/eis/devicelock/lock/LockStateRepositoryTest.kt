package com.eis.devicelock.lock

import android.content.SharedPreferences
import com.eis.devicelock.util.Secrets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Pure-JVM test that exercises LockStateRepository against an in-memory
 * SharedPreferences fake. We deliberately avoid Robolectric — the
 * behaviour we care about is "write key, read key back" — so a plain
 * Map-backed fake is enough.
 */
class LockStateRepositoryTest {

    private lateinit var fakePrefs: FakePrefs
    private lateinit var repo: LockStateRepository

    @Before fun setUp() {
        fakePrefs = FakePrefs()
        repo = LockStateRepository(Secrets.forTest(fakePrefs))
    }

    @Test fun `default state is unlocked`() {
        assertFalse(repo.isLocked())
        assertNull(repo.lastCommandId())
    }

    @Test fun `markLocked persists state and message`() {
        repo.markLocked("c-1", "Pay your installment")
        assertTrue(repo.isLocked())
        assertEquals("c-1", repo.lastCommandId())
        assertEquals("applied", repo.lastCommandStatus())
        assertEquals("Pay your installment", repo.lockMessage())
    }

    @Test fun `markUnlocked clears lock state`() {
        repo.markLocked("c-1", "x")
        repo.markUnlocked("c-2")
        assertFalse(repo.isLocked())
        assertEquals("c-2", repo.lastCommandId())
        assertEquals("applied", repo.lastCommandStatus())
    }

    @Test fun `recordCommandFailure does not flip lock state`() {
        repo.markLocked("c-1", "x")
        repo.recordCommandFailure("c-9")
        assertTrue(repo.isLocked())
        assertEquals("c-9", repo.lastCommandId())
        assertEquals("failed", repo.lastCommandStatus())
    }

    @Test fun `recordUnlockAttempt stores wallclock`() {
        val before = System.currentTimeMillis()
        repo.recordUnlockAttempt()
        val after = System.currentTimeMillis()
        val stored = repo.lastUnlockAttemptAt()
        assertTrue(stored in before..after)
    }

    @Test fun `state survives a fresh repository instance backed by same prefs`() {
        repo.markLocked("c-7", "msg")
        val repo2 = LockStateRepository(Secrets.forTest(fakePrefs))
        assertTrue(repo2.isLocked())
        assertEquals("c-7", repo2.lastCommandId())
    }

    // ---- Fake SharedPreferences ----

    private class FakePrefs : SharedPreferences {
        val map = mutableMapOf<String, Any?>()
        override fun getAll(): MutableMap<String, *> = map
        override fun getString(key: String?, defValue: String?): String? =
            map[key] as? String ?: defValue
        override fun getStringSet(key: String?, defValues: MutableSet<String>?) =
            throw NotImplementedError()
        override fun getInt(key: String?, defValue: Int) = (map[key] as? Int) ?: defValue
        override fun getLong(key: String?, defValue: Long) = (map[key] as? Long) ?: defValue
        override fun getFloat(key: String?, defValue: Float) = (map[key] as? Float) ?: defValue
        override fun getBoolean(key: String?, defValue: Boolean) =
            (map[key] as? Boolean) ?: defValue
        override fun contains(key: String?) = map.containsKey(key)
        override fun edit(): SharedPreferences.Editor = FakeEditor(map)
        override fun registerOnSharedPreferenceChangeListener(
            listener: SharedPreferences.OnSharedPreferenceChangeListener?
        ) = Unit
        override fun unregisterOnSharedPreferenceChangeListener(
            listener: SharedPreferences.OnSharedPreferenceChangeListener?
        ) = Unit
    }

    private class FakeEditor(val map: MutableMap<String, Any?>) : SharedPreferences.Editor {
        override fun putString(key: String?, value: String?) =
            apply { if (key != null) map[key] = value }
        override fun putStringSet(key: String?, values: MutableSet<String>?) =
            apply { if (key != null) map[key] = values }
        override fun putInt(key: String?, value: Int) =
            apply { if (key != null) map[key] = value }
        override fun putLong(key: String?, value: Long) =
            apply { if (key != null) map[key] = value }
        override fun putFloat(key: String?, value: Float) =
            apply { if (key != null) map[key] = value }
        override fun putBoolean(key: String?, value: Boolean) =
            apply { if (key != null) map[key] = value }
        override fun remove(key: String?) = apply { map.remove(key) }
        override fun clear() = apply { map.clear() }
        override fun commit() = true
        override fun apply() = Unit
    }
}
