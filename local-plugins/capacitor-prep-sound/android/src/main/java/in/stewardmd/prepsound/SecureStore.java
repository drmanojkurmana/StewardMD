package in.stewardmd.prepsound;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * AES-GCM secret storage backed by the Android Keystore.
 *
 * The AES-256 key is generated inside the Keystore (alias below) and never
 * leaves it. Ciphertext (12-byte random IV + GCM tag appended by the cipher)
 * is Base64-stored in a private SharedPreferences file. This deliberately
 * avoids the deprecated EncryptedSharedPreferences dependency: only platform
 * KeyStore / JCE APIs are used.
 *
 * Values are never logged by this class or its caller. Keys are restricted to
 * a small allow-list shape so arbitrary app data cannot be parked here.
 */
final class SecureStore {

    private static final String KEY_ALIAS = "stewardmd_prep_sound_aes_gcm_v1";
    private static final String PREFS = "stewardmd_prep_sound_secrets";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_BYTES = 12;
    private static final int MAX_VALUE_CHARS = 8192;
    private static final Pattern KEY_SHAPE = Pattern.compile("^[A-Za-z0-9._-]{1,64}$");

    private final SharedPreferences prefs;
    private final SecureRandom random = new SecureRandom();

    SecureStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isValidKey(String key) {
        return key != null && KEY_SHAPE.matcher(key).matches();
    }

    static boolean isValidValue(String value) {
        return value != null && value.length() <= MAX_VALUE_CHARS;
    }

    synchronized void put(String key, String value) throws Exception {
        SecretKey secretKey = getOrCreateKey();
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] cipherText = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(iv, Base64.NO_WRAP)
                + ":" + Base64.encodeToString(cipherText, Base64.NO_WRAP);
        prefs.edit().putString(key, stored).apply();
    }

    /** Returns the plaintext, or null when absent / undecryptable (key rotated, data corrupt). */
    synchronized String get(String key) {
        String stored = prefs.getString(key, null);
        if (stored == null) return null;
        try {
            int sep = stored.indexOf(':');
            if (sep <= 0) return null;
            byte[] iv = Base64.decode(stored.substring(0, sep), Base64.NO_WRAP);
            byte[] cipherText = Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // Never log the value or ciphertext. A stale entry is treated as absent;
            // the caller (Spotify restore) then falls back to a fresh sign-in.
            return null;
        }
    }

    synchronized void remove(String key) {
        prefs.edit().remove(key).apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
            if (entry != null) return entry.getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }
}
