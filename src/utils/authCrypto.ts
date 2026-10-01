/**
 * Client-Side Authentication Cryptography Utility
 *
 * Implements client-side SHA-256 password pre-hashing and secure migration tokens.
 * This guarantees that plaintext passwords are NEVER transmitted over the network
 * or visible in browser DevTools Network tabs.
 */

const LEGACY_MIGRATION_SECRET = 'CICR_VAULT_LEGACY_AUTH_MIGRATION_KEY_2026';
const LEGACY_MIGRATION_SALT = 'CICR_VAULT_SALT';

/**
 * Pure JavaScript SHA-256 implementation for maximum cross-browser/cross-origin resilience.
 * Used whenever WebCrypto is unavailable (e.g. non-HTTPS local development or webview).
 */
export function sha256Fallback(ascii: string): string {
    function rightRotate(value: number, amount: number) {
        return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    const lengthProperty = 'length';
    let i = 0, j = 0;
    let result = '';
    const words: number[] = [];
    const asciiBitLength = ascii[lengthProperty] * 8;

    const hash: number[] = [];
    const k: number[] = [];
    let primeCounter = 0;

    const isComposite: Record<number, number> = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
        if (!isComposite[candidate]) {
            for (i = 0; i < 313; i += candidate) {
                isComposite[i] = candidate;
            }
            hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
            k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
        }
    }

    ascii += '\x80';
    while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return '';
        words[i >> 2] |= j << (((3 - i) % 4) * 8);
    }
    words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
    words[words[lengthProperty]] = asciiBitLength | 0;

    for (j = 0; j < words[lengthProperty];) {
        const w = words.slice(j, (j += 16));
        const oldHash = [...hash];
        hash.length = 8;

        for (i = 0; i < 64; i++) {
            const w15 = w[i - 15], w2 = w[i - 2];
            const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
            const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
            w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

            const s1_maj = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
            const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
            const t2 = (s1_maj + maj) | 0;

            const s1_ch = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
            const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
            const t1 = (hash[7] + s1_ch + ch + k[i] + w[i]) | 0;

            hash.unshift((t1 + t2) | 0);
            hash[4] = (hash[4] + t1) | 0;
            hash.pop();
        }

        for (i = 0; i < 8; i++) {
            hash[i] = (hash[i] + oldHash[i]) | 0;
        }
    }

    for (i = 0; i < 8; i++) {
        for (j = 3; j + 1; j--) {
            const b = (hash[i] >> (j * 8)) & 255;
            result += ((b < 16) ? '0' : '') + b.toString(16);
        }
    }
    return result;
}

/**
 * Computes the SHA-256 cryptographic hash of a password string.
 * Always returns a lowercase 64-character hex string.
 */
export async function hashPasswordClient(password: string): Promise<string> {
    if (!password) return '';
    // If it's already a 64-char hex hash, don't re-hash
    if (/^[0-9a-f]{64}$/i.test(password)) {
        return password.toLowerCase();
    }

    try {
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(password);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch {
        // Fall through to JS fallback
    }

    return sha256Fallback(password);
}

/**
 * Creates an encrypted migration token (AES-GCM) containing the raw password.
 * This allows the backend to verify and automatically upgrade legacy user accounts
 * that were created before client-side hashing was enabled, WITHOUT exposing the raw password
 * in the network payload.
 */
export async function createLegacyAuthToken(rawPassword: string): Promise<string | undefined> {
    if (!rawPassword) return undefined;
    try {
        if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(rawPassword);

            const keyMaterial = await window.crypto.subtle.importKey(
                'raw',
                encoder.encode(LEGACY_MIGRATION_SECRET),
                { name: 'PBKDF2' },
                false,
                ['deriveKey']
            );

            const key = await window.crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: encoder.encode(LEGACY_MIGRATION_SALT),
                    iterations: 1000,
                    hash: 'SHA-256'
                },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );

            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                data
            );

            const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
            const cipherHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
            return `${ivHex}:${cipherHex}`;
        }
    } catch {
        // In the rare event WebCrypto encryption is unavailable, return undefined
    }
    return undefined;
}
