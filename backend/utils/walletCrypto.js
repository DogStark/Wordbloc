const crypto = require('crypto');

/**
 * walletCrypto
 *
 * KMS-style envelope encryption for custodial wallet private keys.
 *
 * Uses AES-256-GCM with a 256-bit master key sourced from the environment
 * (`WALLET_ENCRYPTION_KEY`). A private key is NEVER stored in plaintext at
 * rest — only the ciphertext, a per-record random IV, and the GCM auth tag
 * are persisted. Decryption fails loudly if the ciphertext, IV, or tag has
 * been tampered with (authenticated encryption).
 *
 * This module is intentionally dependency-free (Node `crypto` only) and pure
 * so the encryption path can be unit-tested without a database, RPC node, or
 * any network access.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM
const KEY_LENGTH = 32; // 256 bits
const AAD = Buffer.from('spellbloc-custodial-wallet', 'utf8');

/**
 * Resolve and validate the master encryption key from the environment.
 *
 * The key must be 64 hex characters (32 bytes). Startup code should call this
 * once so the process fails loudly at boot rather than at first mint if the
 * key is missing or malformed.
 *
 * @param {string} [rawKey=process.env.WALLET_ENCRYPTION_KEY]
 * @returns {Buffer} 32-byte key
 */
function resolveMasterKey(rawKey = process.env.WALLET_ENCRYPTION_KEY) {
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
        throw new Error(
            'WALLET_ENCRYPTION_KEY is not set. A 32-byte (64 hex char) master key ' +
            'is required to encrypt custodial wallet keys at rest. Generate one with ' +
            '`openssl rand -hex 32` and set it in the environment. Refusing to start.'
        );
    }

    const key = Buffer.from(rawKey.trim(), 'hex');
    if (key.length !== KEY_LENGTH) {
        throw new Error(
            `WALLET_ENCRYPTION_KEY must be exactly ${KEY_LENGTH} bytes ` +
            `(${KEY_LENGTH * 2} hex characters); received ${key.length} bytes. ` +
            'Generate a valid key with `openssl rand -hex 32`.'
        );
    }

    return key;
}

/**
 * Encrypt a wallet private key for storage.
 *
 * @param {string} privateKey - hex private key (e.g. `0x...`)
 * @param {Buffer} [masterKey] - resolved 32-byte key; defaults to env
 * @returns {{ciphertext: string, iv: string, authTag: string, algorithm: string, version: number}}
 */
function encryptPrivateKey(privateKey, masterKey = resolveMasterKey()) {
    if (!privateKey || typeof privateKey !== 'string') {
        throw new Error('encryptPrivateKey requires a non-empty private key string');
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
    cipher.setAAD(AAD);

    const ciphertext = Buffer.concat([
        cipher.update(privateKey, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
        version: 1,
        algorithm: ALGORITHM,
        ciphertext: ciphertext.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
    };
}

/**
 * Decrypt a stored wallet private key.
 *
 * Throws if the payload has been tampered with (GCM auth tag mismatch) or if
 * the wrong master key is supplied.
 *
 * @param {{ciphertext: string, iv: string, authTag: string}} payload
 * @param {Buffer} [masterKey] - resolved 32-byte key; defaults to env
 * @returns {string} the decrypted private key
 */
function decryptPrivateKey(payload, masterKey = resolveMasterKey()) {
    if (!payload || !payload.ciphertext || !payload.iv || !payload.authTag) {
        throw new Error('decryptPrivateKey requires ciphertext, iv, and authTag');
    }

    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const ciphertext = Buffer.from(payload.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);

    return decrypted.toString('utf8');
}

/**
 * Generate a fresh master key (hex). Convenience for ops tooling / tests —
 * never called implicitly at runtime so a missing key can never be silently
 * papered over.
 *
 * @returns {string} 64-char hex string
 */
function generateMasterKey() {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

module.exports = {
    ALGORITHM,
    IV_LENGTH,
    KEY_LENGTH,
    resolveMasterKey,
    encryptPrivateKey,
    decryptPrivateKey,
    generateMasterKey,
};
