/**
 * Backup Serialization, Client-Side AES-256-GCM Encryption & Cloudinary Off-Site Upload.
 * Designed for Firebase Spark (free) plan without exposing API secrets or unencrypted
 * sensitive hotel data on third-party media/raw storage.
 */

export const BACKUP_ENVELOPE_FORMAT = 'hotel-po-encrypted-backup-v1';
export const BACKUP_PLAIN_FORMAT = 'hotel-po-backup-v1';
export const BACKUP_COLLECTIONS = [
    'users', 'requests', 'inventory', 'stock_movements', 'budgets', 'departments', 'settings'
];

function getSubtleCrypto() {
    const c = globalThis.crypto;
    if (!c || !c.subtle) {
        throw new Error('Web Crypto API is unavailable in this environment (HTTPS or localhost required).');
    }
    return c;
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Recursively converts Firestore Timestamps and Dates into portable markers
 * so restored documents preserve queryable Firestore Timestamp types.
 */
export function serializeFirestoreValue(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) {
        const ms = value.getTime();
        return {
            __type: 'firestore_timestamp',
            seconds: Math.floor(ms / 1000),
            nanoseconds: (ms % 1000) * 1000000
        };
    }
    if (typeof value === 'object') {
        if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
            return {
                __type: 'firestore_timestamp',
                seconds: value.seconds,
                nanoseconds: Number(value.nanoseconds || 0)
            };
        }
        if (Array.isArray(value)) {
            return value.map(item => serializeFirestoreValue(item));
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v !== undefined) {
                out[k] = serializeFirestoreValue(v);
            }
        }
        return out;
    }
    return value;
}

/**
 * Recursively restores portable timestamp markers back to Firestore Timestamps (or Dates).
 */
export function deserializeFirestoreValue(value, TimestampCtor = null) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        return value.map(item => deserializeFirestoreValue(item, TimestampCtor));
    }
    if (typeof value === 'object') {
        if (value.__type === 'firestore_timestamp' && typeof value.seconds === 'number') {
            const secs = Number(value.seconds) || 0;
            const nanos = Number(value.nanoseconds) || 0;
            if (TimestampCtor && typeof TimestampCtor === 'function') {
                return new TimestampCtor(secs, nanos);
            }
            return new Date(secs * 1000 + Math.floor(nanos / 1000000));
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = deserializeFirestoreValue(v, TimestampCtor);
        }
        return out;
    }
    return value;
}

/**
 * Computes lowercase hex SHA-256 digest of a UTF-8 string.
 */
export async function sha256Hex(text) {
    const c = getSubtleCrypto();
    const data = new TextEncoder().encode(String(text));
    const digest = await c.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

async function deriveAesGcmKey(passphrase, saltBytes, iterations = 250000, usage = ['encrypt']) {
    const c = getSubtleCrypto();
    const keyMaterial = await c.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return c.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        usage
    );
}

export function isEncryptedBackupEnvelope(obj) {
    return Boolean(
        obj &&
        typeof obj === 'object' &&
        obj.format === BACKUP_ENVELOPE_FORMAT &&
        typeof obj.ciphertext === 'string' &&
        typeof obj.salt === 'string' &&
        typeof obj.iv === 'string'
    );
}

/**
 * Encrypts a JSON backup object or string using browser-native AES-256-GCM + PBKDF2-SHA256.
 */
export async function encryptBackupPayload(backupObjOrJson, passphrase, meta = {}) {
    if (typeof passphrase !== 'string' || passphrase.length < 6) {
        throw new Error('Encryption passphrase must be at least 6 characters long.');
    }
    const c = getSubtleCrypto();
    const plaintext = typeof backupObjOrJson === 'string'
        ? backupObjOrJson
        : JSON.stringify(backupObjOrJson);

    const iterations = 250000;
    const salt = c.getRandomValues(new Uint8Array(16));
    const iv = c.getRandomValues(new Uint8Array(12));
    const checksumSha256 = await sha256Hex(plaintext);
    const aesKey = await deriveAesGcmKey(passphrase, salt, iterations, ['encrypt']);

    const encryptedBuffer = await c.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        new TextEncoder().encode(plaintext)
    );

    return {
        format: BACKUP_ENVELOPE_FORMAT,
        alg: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA256',
        iterations,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        createdAt: new Date().toISOString(),
        hotelName: String(meta.hotelName || 'Hotel PO System'),
        checksumSha256,
        ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer))
    };
}

/**
 * Decrypts and integrity-verifies an encrypted backup envelope.
 */
export async function decryptBackupPayload(envelopeOrJson, passphrase) {
    if (typeof passphrase !== 'string' || !passphrase) {
        throw new Error('Please enter the decryption passphrase for this encrypted backup.');
    }
    const envelope = typeof envelopeOrJson === 'string'
        ? JSON.parse(envelopeOrJson)
        : envelopeOrJson;

    if (!isEncryptedBackupEnvelope(envelope)) {
        throw new Error('File is not a valid AES-256-GCM encrypted Hotel PO backup.');
    }

    const iterations = Number(envelope.iterations) || 250000;
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);

    const aesKey = await deriveAesGcmKey(passphrase, salt, iterations, ['decrypt']);
    let decryptedBuffer;
    try {
        const c = getSubtleCrypto();
        decryptedBuffer = await c.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            ciphertext
        );
    } catch (_) {
        throw new Error('Decryption failed: incorrect passphrase or the backup file is corrupted/tampered.');
    }

    const plaintext = new TextDecoder().decode(decryptedBuffer);
    if (envelope.checksumSha256) {
        const actualHash = await sha256Hex(plaintext);
        if (actualHash !== envelope.checksumSha256) {
            throw new Error('Backup integrity check (SHA-256) failed after decryption.');
        }
    }

    return JSON.parse(plaintext);
}

/**
 * Validates a parsed plaintext backup dataset and summarizes document counts.
 */
export function validateBackupDataset(dataset) {
    if (!dataset || typeof dataset !== 'object' || !dataset.collections || typeof dataset.collections !== 'object') {
        throw new Error('Invalid backup structure: missing collections map.');
    }
    const counts = {};
    let totalDocs = 0;
    for (const colName of Object.keys(dataset.collections)) {
        const docs = dataset.collections[colName];
        if (!Array.isArray(docs)) {
            throw new Error(`Invalid backup format in collection "${colName}": expected document array.`);
        }
        for (const entry of docs) {
            if (!entry || typeof entry.id !== 'string' || !entry.data || typeof entry.data !== 'object') {
                throw new Error(`Corrupt document entry in backup collection "${colName}".`);
            }
        }
        counts[colName] = docs.length;
        totalDocs += docs.length;
    }
    return {
        format: dataset.format || BACKUP_PLAIN_FORMAT,
        exportedAt: dataset.exportedAt || null,
        exportedBy: dataset.exportedBy || null,
        hotelName: dataset.hotelName || 'Unknown Property',
        counts,
        totalDocs
    };
}

/**
 * Uploads an AES-256-GCM encrypted backup blob to Cloudinary using an unsigned preset.
 * Refuses any unencrypted payload so sensitive hotel records never leave plaintext on public URLs.
 */
export async function uploadEncryptedBackupToCloudinary({
    cloudName,
    uploadPreset,
    folder = 'hotel-po-backups',
    encryptedEnvelope,
    filename
}) {
    if (!isEncryptedBackupEnvelope(encryptedEnvelope)) {
        throw new Error('Security policy violation: only AES-256-GCM encrypted backups may be uploaded to Cloudinary.');
    }
    const cleanCloud = String(cloudName || '').trim();
    const cleanPreset = String(uploadPreset || '').trim();
    if (!cleanCloud || !cleanPreset) {
        throw new Error('Cloudinary Cloud Name and Unsigned Upload Preset are required.');
    }

    const jsonString = JSON.stringify(encryptedEnvelope);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const safeFile = filename || `hotel_po_encrypted_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    const formData = new FormData();
    formData.append('file', blob, safeFile);
    formData.append('upload_preset', cleanPreset);
    if (folder && String(folder).trim()) {
        formData.append('folder', String(folder).trim());
    }
    formData.append('tags', 'hotel-po-backup,aes-256-gcm');

    const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cleanCloud)}/raw/upload`;
    const response = await fetch(endpoint, { method: 'POST', body: formData });
    let result = null;
    try {
        result = await response.json();
    } catch (_) {
        // fallback handled below
    }

    if (!response.ok) {
        const msg = result?.error?.message || `Cloudinary upload failed (HTTP ${response.status}).`;
        throw new Error(msg);
    }

    return {
        secureUrl: result.secure_url,
        publicId: result.public_id,
        bytes: Number(result.bytes || jsonString.length),
        createdAt: result.created_at || new Date().toISOString(),
        resourceType: result.resource_type || 'raw'
    };
}
