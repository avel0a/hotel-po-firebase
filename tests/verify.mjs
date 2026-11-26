/**
 * Automated pre-deploy verification & unit tests for Hotel PO System.
 * Run with: node --experimental-vm-modules tests/verify.mjs
 */

import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    escapeHtml,
    safeCsvCell,
    getUnitConversionFactor,
    roundQty,
    formatMoney,
    normalizeRole,
    isPurchaseRequest,
    COMMITTED_STATUSES,
    debounce,
    computeRequestTotals,
    computeBudgetImpact,
    computePriceChangePct
} from '../public/js/config.js';
import {
    BACKUP_ENVELOPE_FORMAT,
    BACKUP_PLAIN_FORMAT,
    BACKUP_COLLECTIONS,
    serializeFirestoreValue,
    deserializeFirestoreValue,
    encryptBackupPayload,
    decryptBackupPayload,
    isEncryptedBackupEnvelope,
    validateBackupDataset,
    uploadEncryptedBackupToCloudinary
} from '../public/js/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Parse every frontend ES module using Node's native SourceTextModule parser
const jsFiles = ['config.js', 'state.js', 'firebase.js', 'backup.js', 'ui.js', 'actions.js', 'auth.js', 'app.js'];
for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(rootDir, 'public', 'js', file), 'utf8');
    new vm.SourceTextModule(code, { identifier: file });
}
console.log(`✓ All ${jsFiles.length} ES modules parsed cleanly`);

// 1b. Cross-module named & default export binding verification
const exportsMap = {};
for (const file of jsFiles) {
    const src = fs.readFileSync(path.join(rootDir, 'public', 'js', file), 'utf8');
    const ex = new Set();
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)) ex.add(m[1]);
    for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
        m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean).forEach(n => ex.add(n));
    }
    if (/export\s+default\b/.test(src)) ex.add('default');
    exportsMap[file] = ex;
}
for (const file of jsFiles) {
    const src = fs.readFileSync(path.join(rootDir, 'public', 'js', file), 'utf8');
    for (const m of src.matchAll(/import\s+(?:(\w+)\s*,\s*)?\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/g)) {
        const targetFile = m[3].split('?')[0];
        const targetExports = exportsMap[targetFile];
        assert.ok(targetExports, `${file} imports missing module ${targetFile}`);
        if (m[1]) assert.ok(targetExports.has('default'), `${file} imports missing default export from ${targetFile}`);
        const names = m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const n of names) {
            assert.ok(targetExports.has(n), `${file} imports missing export "${n}" from ${targetFile}`);
        }
    }
}
console.log('✓ Cross-module import/export bindings verified');

// 2. Security helpers: XSS & CSV injection protection
assert.equal(
    escapeHtml(`<img src=x onerror="alert('xss')">`),
    '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;'
);
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(0), '0');

assert.equal(safeCsvCell('=cmd|"/C calc"!A0'), '"\'=cmd|""/C calc""!A0"');
assert.equal(safeCsvCell('+SUM(A1:A2)'), "'+SUM(A1:A2)");
assert.equal(safeCsvCell('-5'), '-5');
assert.equal(safeCsvCell('Sugar, White'), '"Sugar, White"');
console.log('✓ XSS & CSV formula injection sanitization checks passed');

// 3. Unit conversion, floating-point rounding & debounce helper
assert.equal(getUnitConversionFactor('Bag', 'Kg', 25), 25);
assert.equal(getUnitConversionFactor('Box', 'Each', 1), 10);
assert.equal(getUnitConversionFactor('Kg', 'Kg', 25), 1);
assert.equal(roundQty(0.1 + 0.2), 0.3);
assert.equal(roundQty(10 - 3.3333333), 6.667);
assert.equal(formatMoney(125, 'USD'), 'USD 125.00');
assert.equal(formatMoney(null, 'Birr'), 'Birr 0.00');
assert.equal(typeof debounce(() => {}, 150), 'function');
console.log('✓ Package conversion, float precision, currency & debounce passed');

// 4. Role normalization & workflow classification
assert.equal(normalizeRole('Store Keeper'), 'Storekeeper');
assert.equal(normalizeRole('Storekeeper'), 'Storekeeper');
assert.equal(normalizeRole(null), 'User');
assert.equal(isPurchaseRequest({ requestType: 'Purchase Order', department: 'Kitchen' }), true);
assert.equal(isPurchaseRequest({ requestType: 'Requisition', department: 'Kitchen' }), false);
assert.ok(COMMITTED_STATUSES.includes('Ordered'));
assert.ok(COMMITTED_STATUSES.includes('Received'));
assert.ok(COMMITTED_STATUSES.includes('Issued'));
console.log('✓ Role normalization & workflow status checks passed');

// 5. Verify cache-buster consistency (?v=3.6) across entry points and Firestore rules
const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
assert.ok(indexHtml.includes('/css/styles.css?v=3.6'), 'index.html missing styles.css?v=3.6');
assert.ok(indexHtml.includes('/js/app.js?v=3.6'), 'index.html missing app.js?v=3.6');
for (const entry of ['app.js', 'auth.js', 'actions.js']) {
    const src = fs.readFileSync(path.join(rootDir, 'public', 'js', entry), 'utf8');
    assert.ok(src.includes('?v=3.6'), `${entry} missing ?v=3.6 cache-buster`);
}
const rulesSrc = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');
assert.ok(
    rulesSrc.includes('allow read: if isAdmin() || (isActiveUser() && settingId != \'backup\');'),
    'firestore.rules must short-circuit isAdmin() on /settings so backup collection queries succeed'
);
assert.ok(rulesSrc.includes('match /vendors/{vendorId}'), 'firestore.rules missing /vendors collection rules');
assert.ok(BACKUP_COLLECTIONS.includes('vendors'), 'BACKUP_COLLECTIONS must include vendors');
console.log('✓ Cache-buster (?v=3.6) & Firestore rule safety checks passed');

// 6. Backup serialization, Web Crypto AES-256-GCM encryption & Cloudinary safety policy
class MockTimestamp {
    constructor(seconds, nanoseconds) {
        this.seconds = seconds;
        this.nanoseconds = nanoseconds;
    }
    toDate() {
        return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6));
    }
}

const sampleDataset = {
    format: BACKUP_PLAIN_FORMAT,
    version: 1,
    exportedAt: '2026-11-25T21:00:00.000Z',
    hotelName: 'Skylight Grand Hotel',
    collections: {
        users: [{ id: 'u1', data: { email: 'admin@hotel.com', role: 'System Administrator' } }],
        requests: [{
            id: 'r1',
            data: serializeFirestoreValue({
                department: 'Kitchen',
                totalCost: 2450.5,
                createdAt: new MockTimestamp(1795600000, 123000000)
            })
        }]
    }
};

const restoredReq = deserializeFirestoreValue(sampleDataset.collections.requests[0].data, MockTimestamp);
assert.ok(restoredReq.createdAt instanceof MockTimestamp);
assert.equal(restoredReq.createdAt.seconds, 1795600000);
assert.equal(restoredReq.createdAt.nanoseconds, 123000000);

const summary = validateBackupDataset(sampleDataset);
assert.equal(summary.totalDocs, 2);
assert.equal(summary.counts.requests, 1);

await assert.rejects(
    () => encryptBackupPayload(sampleDataset, 'short'),
    /at least 6 characters/
);

const envelope = await encryptBackupPayload(sampleDataset, 'HotelStrongPass!2026', { hotelName: 'Skylight Grand Hotel' });
assert.equal(envelope.format, BACKUP_ENVELOPE_FORMAT);
assert.equal(envelope.alg, 'AES-256-GCM');
assert.ok(isEncryptedBackupEnvelope(envelope));
assert.ok(!JSON.stringify(envelope).includes('admin@hotel.com'), 'Encrypted envelope must not leak plaintext');

const decrypted = await decryptBackupPayload(envelope, 'HotelStrongPass!2026');
assert.equal(decrypted.collections.users[0].data.email, 'admin@hotel.com');
assert.equal(decrypted.collections.requests[0].data.totalCost, 2450.5);

await assert.rejects(
    () => decryptBackupPayload(envelope, 'WrongPassword123'),
    /Decryption failed/
);

const tampered = { ...envelope, ciphertext: 'AAAA' + envelope.ciphertext.slice(4) };
await assert.rejects(
    () => decryptBackupPayload(tampered, 'HotelStrongPass!2026'),
    /Decryption failed/
);

// Architectural guardrail: refuse unencrypted upload to Cloudinary
await assert.rejects(
    () => uploadEncryptedBackupToCloudinary({
        cloudName: 'demo-cloud',
        uploadPreset: 'unsigned_preset',
        encryptedEnvelope: sampleDataset
    }),
    /Security policy violation/
);
console.log('✓ AES-256-GCM encryption, Timestamp round-trip & Cloudinary security policy checks passed');

// 7. Enterprise Tax/Discount, Budget Overrun & Vendor Price Variance checks
const totals = computeRequestTotals({
    items: [{ price: 100, quantity: 2 }, { price: 50, quantity: 1 }],
    taxRate: 15,
    discountAmount: 50
});
assert.equal(totals.subtotal, 250);
assert.equal(totals.discountAmount, 50);
assert.equal(totals.taxAmount, 30);
assert.equal(totals.totalCost, 230);

// Budget overrun detection
const budgetImpact = computeBudgetImpact({
    req: { id: 'req_new', department: 'Kitchen', totalCost: 4000, createdAt: new Date(2026, 10, 15) },
    budgets: [{ department: 'Kitchen', month: '2026-11', amount: 10000 }],
    requests: [
        { id: 'r1', department: 'Kitchen', status: 'Approved', totalCost: 7500, createdAt: { toDate: () => new Date(2026, 10, 2) } }
    ]
});
assert.equal(budgetImpact.hasBudget, true);
assert.equal(budgetImpact.wouldExceed, true);
assert.equal(budgetImpact.exceededBy, 1500);
assert.equal(budgetImpact.remainingAfter, -1500);

// Vendor price variance calculation
assert.equal(computePriceChangePct(100, 115), 15);
assert.equal(computePriceChangePct(200, 180), -10);
assert.equal(computePriceChangePct(0, 100), null);
console.log('✓ Tax/Discount totals, Budget Overrun guard & Price Variance checks passed');

// 8. Native Android File Bridge & Browser fallback download checks
const { saveBlobFile, saveJsPdfDocument } = await import('../public/js/config.js');
const prevWindow = globalThis.window;
try {
    let bridged = null;
    globalThis.window = {
        AndroidFileBridge: {
            saveFile: (base64, filename, mimeType) => {
                bridged = { base64, filename, mimeType };
            }
        }
    };
    const origFileReader = globalThis.FileReader;
    globalThis.FileReader = class MockFileReader {
        readAsDataURL() {
            this.result = 'data:application/pdf;base64,JVBERi0xLjQ=';
            if (this.onloadend) this.onloadend();
        }
    };
    try {
        const resPdf = saveJsPdfDocument({ output: () => ({ type: 'application/pdf' }), save: () => { throw new Error('Should not call pdf.save inside APK'); } }, 'PO:123/test.pdf');
        assert.equal(resPdf, 'android');
        assert.deepEqual(bridged, { base64: 'JVBERi0xLjQ=', filename: 'PO_123_test.pdf', mimeType: 'application/pdf' });
    } finally {
        globalThis.FileReader = origFileReader;
    }

    let browserSavedName = null;
    globalThis.window = {};
    const resFallback = saveJsPdfDocument({ save: (name) => { browserSavedName = name; } }, 'GRN_001.pdf');
    assert.equal(resFallback, 'browser');
    assert.equal(browserSavedName, 'GRN_001.pdf');
    assert.equal(typeof saveBlobFile, 'function');
} finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
}
console.log('✓ Android File Bridge & browser download fallback checks passed');
