package com.jbeckerit.drift.backup

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class BackupCryptoTest {
    private val password = "a long backup password".toCharArray()
    private val payload = "Private journal — café 🌿".toByteArray(Charsets.UTF_8)

    @Test fun `encrypted archive preserves unicode content`() {
        assertArrayEquals(payload, decrypt(encrypt(payload, password), password))
    }

    @Test fun `each backup uses fresh randomness`() {
        assertFalse(encrypt(payload, password).contentEquals(encrypt(payload, password)))
    }

    @Test fun `wrong password cannot unlock an archive`() {
        val archive = encrypt(payload, password)
        assertThrows(IllegalArgumentException::class.java) {
            decrypt(archive, "another password".toCharArray())
        }
    }

    @Test fun `tampered ciphertext is rejected`() {
        val archive = encrypt(payload, password)
        archive[archive.lastIndex] = (archive.last().toInt() xor 1).toByte()
        assertThrows(IllegalArgumentException::class.java) { decrypt(archive, password) }
    }

    @Test fun `truncated archive is rejected`() {
        val archive = encrypt(payload, password)
        assertThrows(IllegalArgumentException::class.java) {
            decrypt(archive.copyOf(20), password)
        }
        assertThrows(IllegalArgumentException::class.java) {
            decrypt(archive.copyOf(archive.size - 1), password)
        }
    }

    @Test fun `unknown format and version are rejected`() {
        val archive = encrypt(payload, password)
        val badMagic = archive.copyOf().also { it[0] = 0 }
        val futureVersion = archive.copyOf().also { it[8] = 127 }
        assertThrows(IllegalArgumentException::class.java) { decrypt(badMagic, password) }
        assertThrows(IllegalArgumentException::class.java) { decrypt(futureVersion, password) }
    }

    @Test fun `version one encryption envelope remains readable`() {
        // V1 and V2 share the same encryption envelope; payload schemas differ.
        val archive = encrypt(payload, password).also { it[8] = 1 }
        assertArrayEquals(payload, decrypt(archive, password))
    }
}
