const crypto = require('crypto');
const {
    resolveMasterKey,
    encryptPrivateKey,
    decryptPrivateKey,
    generateMasterKey,
    KEY_LENGTH,
} = require('../walletCrypto');

const VALID_KEY = 'a'.repeat(64); // 32 bytes hex
const SAMPLE_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

describe('walletCrypto', () => {
    describe('resolveMasterKey', () => {
        it('fails loudly when the key is unset', () => {
            expect(() => resolveMasterKey(undefined)).toThrow(/WALLET_ENCRYPTION_KEY is not set/);
            expect(() => resolveMasterKey('')).toThrow(/not set/);
        });

        it('fails loudly when the key is the wrong length', () => {
            expect(() => resolveMasterKey('abcd')).toThrow(/must be exactly 32 bytes/);
        });

        it('returns a 32-byte buffer for a valid key', () => {
            const key = resolveMasterKey(VALID_KEY);
            expect(Buffer.isBuffer(key)).toBe(true);
            expect(key.length).toBe(KEY_LENGTH);
        });
    });

    describe('encrypt/decrypt round-trip', () => {
        it('never stores the private key in plaintext', () => {
            const key = resolveMasterKey(VALID_KEY);
            const payload = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            expect(payload.ciphertext).not.toContain(SAMPLE_PRIVATE_KEY);
            expect(payload.ciphertext).not.toContain(SAMPLE_PRIVATE_KEY.replace('0x', ''));
            expect(payload.algorithm).toBe('aes-256-gcm');
            expect(payload.iv).toHaveLength(24); // 12 bytes hex
            expect(payload.authTag).toBeTruthy();
        });

        it('decrypts back to the original private key', () => {
            const key = resolveMasterKey(VALID_KEY);
            const payload = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            expect(decryptPrivateKey(payload, key)).toBe(SAMPLE_PRIVATE_KEY);
        });

        it('produces a unique IV per encryption (no deterministic ciphertext reuse)', () => {
            const key = resolveMasterKey(VALID_KEY);
            const a = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            const b = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            expect(a.iv).not.toBe(b.iv);
            expect(a.ciphertext).not.toBe(b.ciphertext);
        });
    });

    describe('tamper resistance (authenticated encryption)', () => {
        it('throws when the auth tag is altered', () => {
            const key = resolveMasterKey(VALID_KEY);
            const payload = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            const tampered = { ...payload, authTag: crypto.randomBytes(16).toString('hex') };
            expect(() => decryptPrivateKey(tampered, key)).toThrow();
        });

        it('throws when the ciphertext is altered', () => {
            const key = resolveMasterKey(VALID_KEY);
            const payload = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            const flipped = Buffer.from(payload.ciphertext, 'hex');
            flipped[0] ^= 0xff;
            const tampered = { ...payload, ciphertext: flipped.toString('hex') };
            expect(() => decryptPrivateKey(tampered, key)).toThrow();
        });

        it('throws when decrypted with the wrong master key', () => {
            const key = resolveMasterKey(VALID_KEY);
            const payload = encryptPrivateKey(SAMPLE_PRIVATE_KEY, key);
            const wrongKey = resolveMasterKey('b'.repeat(64));
            expect(() => decryptPrivateKey(payload, wrongKey)).toThrow();
        });
    });

    describe('generateMasterKey', () => {
        it('produces a valid 64-char hex key usable by resolveMasterKey', () => {
            const generated = generateMasterKey();
            expect(generated).toMatch(/^[0-9a-f]{64}$/);
            expect(() => resolveMasterKey(generated)).not.toThrow();
        });
    });
});
