package com.example.structuredwidget.data

/** Encrypt/decrypt credential fields stored in SharedPreferences. */
interface CredentialCipher {
    fun encrypt(plaintext: String): String
    fun decrypt(encoded: String): String
}

/** AES-GCM encryption backed by Android Keystore. */
class CredentialEncryptor(
    private val keyAlias: String = KEY_ALIAS,
) : CredentialCipher {
    companion object {
        private const val KEY_ALIAS = "structured_widget_credentials"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
    }

    override fun encrypt(plaintext: String): String {
        val cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION)
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val blob = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, blob, 0, iv.size)
        System.arraycopy(ciphertext, 0, blob, iv.size, ciphertext.size)
        return android.util.Base64.encodeToString(blob, android.util.Base64.NO_WRAP)
    }

    override fun decrypt(encoded: String): String {
        val blob = android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
        require(blob.size > GCM_IV_BYTES) { "Invalid encrypted blob" }
        val iv = blob.copyOfRange(0, GCM_IV_BYTES)
        val ciphertext = blob.copyOfRange(GCM_IV_BYTES, blob.size)
        val cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION)
        cipher.init(
            javax.crypto.Cipher.DECRYPT_MODE,
            getOrCreateKey(),
            javax.crypto.spec.GCMParameterSpec(GCM_TAG_BITS, iv),
        )
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    private fun getOrCreateKey(): javax.crypto.SecretKey {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = ks.getEntry(keyAlias, null) as? java.security.KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey
        val keyGen = javax.crypto.KeyGenerator.getInstance(
            android.security.keystore.KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        keyGen.init(
            android.security.keystore.KeyGenParameterSpec.Builder(
                keyAlias,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                    android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return keyGen.generateKey()
    }
}

/** Test-only cipher — no Keystore dependency. */
class FakeCredentialCipher : CredentialCipher {
    override fun encrypt(plaintext: String): String = "fake:$plaintext"
    override fun decrypt(encoded: String): String = encoded.removePrefix("fake:")
}
