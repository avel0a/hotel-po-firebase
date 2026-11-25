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
    COMMITTED_STATUSES
} from '../public/js/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// 1. Parse every frontend ES module using Node's native SourceTextModule parser
const jsFiles = ['config.js', 'state.js', 'firebase.js', 'ui.js', 'actions.js', 'auth.js', 'app.js'];
for (const file of jsFiles) {
    const code = fs.readFileSync(path.join(rootDir, 'public', 'js', file), 'utf8');
    new vm.SourceTextModule(code, { identifier: file });
}
console.log(`✓ All ${jsFiles.length} ES modules parsed cleanly`);

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

// 3. Unit conversion & floating-point rounding accuracy
assert.equal(getUnitConversionFactor('Bag', 'Kg', 25), 25);
assert.equal(getUnitConversionFactor('Box', 'Each', 1), 10);
assert.equal(getUnitConversionFactor('Kg', 'Kg', 25), 1);
assert.equal(roundQty(0.1 + 0.2), 0.3);
assert.equal(roundQty(10 - 3.3333333), 6.667);
assert.equal(formatMoney(125, 'USD'), 'USD 125.00');
assert.equal(formatMoney(null, 'Birr'), 'Birr 0.00');
console.log('✓ Package conversion, float precision & currency formatting passed');

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

// 5. Verify cache-buster consistency (?v=3.2) across entry points
const indexHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
assert.ok(indexHtml.includes('/css/styles.css?v=3.2'), 'index.html missing styles.css?v=3.2');
assert.ok(indexHtml.includes('/js/app.js?v=3.2'), 'index.html missing app.js?v=3.2');
console.log('✓ Cache-buster consistency check passed');
