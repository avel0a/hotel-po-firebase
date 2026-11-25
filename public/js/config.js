/**
 * Firebase configuration and application constants.
 * Update Firebase config here when switching projects.
 */

export const firebaseConfig = {
    apiKey: "AIzaSyALxflk2uNARnqrddDclLjeYCZ8R9Qu99o",
    authDomain: "purchase-70a3f.firebaseapp.com",
    projectId: "purchase-70a3f",
    storageBucket: "purchase-70a3f.appspot.com",
    messagingSenderId: "595940536898",
    appId: "1:595940536898:web:54e8ac8e303a67d623f3db",
    measurementId: "G-CFWNPLZ72X"
};

/** All hotel departments */
export const DEPARTMENTS = [
    'Store', 'Purchasing', 'Housekeeping', 'Kitchen', 'Maintenance', 'Front Desk', 'Management',
    'Information Technology', 'Food&Beverage', 'SPA', 'Security', 'Finance', 'Other'
];

/** Inventory item categories */
export const INVENTORY_CATEGORIES = [
    'Store', 'Housekeeping', 'Kitchen', 'Maintenance', 'Office',
    'Information Technology', 'Food&Beverage', 'SPA', 'Security', 'Finance', 'Other'
];

/** User roles */
export const ROLES = ['User', 'Purchasing', 'Storekeeper', 'General Manager', 'System Administrator'];

/** Request / Order types */
export const REQUEST_TYPES = {
    REQUISITION: 'requisition',
    PURCHASE: 'purchase'
};

/** Flow A: Department Requisition lifecycle statuses */
export const REQUISITION_STATUSES = ['Pending', 'Approved', 'Partially Issued', 'Issued', 'Rejected'];

/** Flow B: Purchase Order lifecycle statuses */
export const PURCHASE_STATUSES = ['Pending', 'Approved', 'Ordered', 'Partially Received', 'Received', 'Rejected'];

/** Measurement units for requested items and inventory */
export const UNITS = ['Kg', 'Liter', 'Each', 'Box', 'Bottle', 'Bag', 'Pack', 'Roll', 'Can', 'Set', 'Carton'];

/** Standard supplier payment terms */
export const PAYMENT_TERMS = ['Cash on Delivery', 'Net 7', 'Net 15', 'Net 30', 'Net 60', 'Advance Payment'];

/**
 * Default package conversion factors if not explicitly specified on the item.
 * E.g., when ordering 1 Box or Bag of an item whose base unit is Kg, Each, or Liter.
 */
export const DEFAULT_UNIT_MULTIPLIERS = {
    'Box': 10,
    'Bag': 25,
    'Pack': 12,
    'Carton': 24,
    'Set': 1,
    'Each': 1,
    'Kg': 1,
    'Liter': 1,
    'Bottle': 1,
    'Roll': 1,
    'Can': 1
};

/**
 * Computes package-to-base conversion factor.
 * E.g., if base unit is Kg and user selects Box (packageSize 25), returns 25.
 * If base unit is Box and user selects Each, returns 1/packageSize.
 */
export function getUnitConversionFactor(selectedUnit, baseUnit = 'Each', packageSize = 1) {
    if (!selectedUnit || !baseUnit || selectedUnit === baseUnit) {
        return 1;
    }
    const pkgUnits = ['Box', 'Bag', 'Pack', 'Carton'];
    const isSelectedPkg = pkgUnits.includes(selectedUnit);
    const isBasePkg = pkgUnits.includes(baseUnit);
    const parsedPkg = Number(packageSize) > 1 ? Number(packageSize) : 0;

    if (isSelectedPkg && !isBasePkg) {
        return parsedPkg > 1 ? parsedPkg : (DEFAULT_UNIT_MULTIPLIERS[selectedUnit] || 1);
    }
    if (!isSelectedPkg && isBasePkg) {
        const factor = parsedPkg > 1 ? parsedPkg : (DEFAULT_UNIT_MULTIPLIERS[baseUnit] || 1);
        return factor > 0 ? (1 / factor) : 1;
    }
    const mSelected = DEFAULT_UNIT_MULTIPLIERS[selectedUnit] || 1;
    const mBase = DEFAULT_UNIT_MULTIPLIERS[baseUnit] || 1;
    return mBase > 0 ? (mSelected / mBase) : 1;
}

/** Request priority levels */
export const PRIORITIES = ['Normal', 'High', 'Urgent'];

/** Configurable granular permissions across the application */
export const AVAILABLE_PERMISSIONS = [
    { id: 'create_request', label: 'Create Purchase Requests & Requisitions', desc: 'Can submit new itemized purchase requests or store requisitions' },
    { id: 'view_all_requests', label: 'View All Requests', desc: 'Can view requests across all hotel departments' },
    { id: 'approve_requests', label: 'Approve / Reject Requests', desc: 'Can review, approve, or reject pending requests' },
    { id: 'manage_inventory', label: 'Manage Inventory & Fill Store', desc: 'Can receive vendor shipments, fill store stock, issue goods to staff, and edit SKUs' },
    { id: 'manage_budgets', label: 'Manage Department Budgets', desc: 'Can set and view monthly department spending limits' },
    { id: 'view_reports', label: 'View Reports & Exports', desc: 'Can view report summaries and export PDF/CSV files' },
    { id: 'manage_vendors', label: 'Manage Vendors & Suppliers', desc: 'Can add, edit, or remove approved hotel suppliers' },
    { id: 'manage_users', label: 'Manage Users & Accounts', desc: 'Can create, edit, suspend, and reset staff accounts' },
    { id: 'manage_settings', label: 'Manage Hotel Settings', desc: 'Can add departments and customize role permissions' }
];

/** Default permissions map per role (used when not customized in Firestore) */
export const DEFAULT_ROLE_PERMISSIONS = {
    'System Administrator': [
        'create_request', 'view_all_requests', 'approve_requests',
        'manage_inventory', 'manage_budgets', 'view_reports',
        'manage_vendors', 'manage_users', 'manage_settings'
    ],
    'General Manager': [
        'create_request', 'view_all_requests', 'approve_requests',
        'manage_budgets', 'view_reports', 'manage_vendors'
    ],
    'Storekeeper': [
        'manage_inventory', 'view_all_requests', 'create_request'
    ],
    'Store Keeper': [
        'manage_inventory', 'view_all_requests', 'create_request'
    ],
    'Purchasing': [
        'create_request', 'view_all_requests', 'view_reports', 'manage_vendors'
    ],
    'User': [
        'create_request'
    ]
};

/**
 * Determines whether a given request is a Purchase Order (Flow B) or Requisition (Flow A).
 * @param {Object} req Request document data
 * @returns {boolean} True if purchase request / PO
 */
export function isPurchaseRequest(req) {
    if (!req) return false;
    return req.requestType === REQUEST_TYPES.PURCHASE ||
           req.requestType === 'purchase' ||
           req.requestType === 'Purchase Order' ||
           req.isRestockOrder === true ||
           req.department === 'Store' ||
           req.department === 'Purchasing';
}

/** Default hotel white-label configuration */
export const DEFAULT_HOTEL_SETTINGS = {
    hotelName: 'Hotel PO System',
    currency: 'Birr',
    hotelAddress: '',
    footerNote: 'Official Hotel Procurement & Store Record',
    taxLabel: 'VAT',
    defaultTaxRate: 0
};

/** Request statuses considered approved / committed for budgets and purchasing metrics */
export const COMMITTED_STATUSES = ['Approved', 'Ordered', 'Partially Issued', 'Issued', 'Partially Received', 'Received'];

/** All lifecycle statuses across Flow A and Flow B */
export const ALL_REQUEST_STATUSES = ['Pending', 'Approved', 'Ordered', 'Partially Issued', 'Issued', 'Partially Received', 'Received', 'Rejected'];

/**
 * Normalizes legacy role aliases (e.g., 'Store Keeper' -> 'Storekeeper').
 */
export function normalizeRole(role) {
    if (!role) return 'User';
    return role === 'Store Keeper' ? 'Storekeeper' : role;
}

/**
 * Escapes HTML special characters to prevent Stored XSS when rendering into innerHTML.
 * @param {*} value Untrusted text or number
 * @returns {string} HTML-safe string
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Formats a CSV cell safely, mitigating CSV formula injection (=, +, -, @, tab, CR)
 * while preserving ordinary negative numbers.
 * @param {*} val Cell value
 * @returns {string} Escaped CSV field
 */
export function safeCsvCell(val) {
    let str = String(val ?? '');
    if (/^[=+\-@\t\r]/.test(str) && !/^-\d+(\.\d+)?$/.test(str)) {
        str = `'${str}`;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Rounds quantities cleanly to avoid IEEE-754 floating point drift.
 */
export function roundQty(val, decimals = 3) {
    const n = Number(val);
    if (!Number.isFinite(n)) return 0;
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
}

/**
 * Formats currency consistently using the configured hotel currency label.
 */
export function formatMoney(amount, currency = 'Birr') {
    const num = Number(amount);
    const safeNum = Number.isFinite(num) ? num : 0;
    return `${currency || 'Birr'} ${safeNum.toFixed(2)}`;
}

/**
 * Debounces rapid UI events (e.g., live search typing on mobile) so rendering never lags.
 */
export function debounce(fn, delayMs = 150) {
    let timer = null;
    return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delayMs);
    };
}

/**
 * Computes line-item subtotal, clamped discount, VAT/tax amount, and grand total cleanly.
 */
export function computeRequestTotals({ items = [], taxRate = 0, discountAmount = 0 } = {}) {
    const subtotal = roundQty(
        (items || []).reduce((acc, it) => acc + ((Number(it?.price) || 0) * (Number(it?.quantity) || 0)), 0),
        2
    );
    const clampedDiscount = roundQty(Math.min(subtotal, Math.max(0, Number(discountAmount) || 0)), 2);
    const taxableAmount = roundQty(Math.max(0, subtotal - clampedDiscount), 2);
    const safeTaxRate = roundQty(Math.max(0, Math.min(100, Number(taxRate) || 0)), 2);
    const taxAmount = roundQty(taxableAmount * (safeTaxRate / 100), 2);
    const totalCost = roundQty(taxableAmount + taxAmount, 2);
    return { subtotal, discountAmount: clampedDiscount, taxRate: safeTaxRate, taxAmount, totalCost };
}

/**
 * Evaluates a request's financial impact against the department's monthly allocated budget.
 */
export function computeBudgetImpact({ req, budgets = [], requests = [] } = {}) {
    if (!req || !req.department || !Array.isArray(budgets) || budgets.length === 0) {
        return { hasBudget: false };
    }
    const reqDate = req.createdAt?.toDate
        ? req.createdAt.toDate()
        : (req.createdAt instanceof Date ? req.createdAt : new Date());
    const period = `${reqDate.getFullYear()}-${String(reqDate.getMonth() + 1).padStart(2, '0')}`;

    const budgetDoc = budgets.find(b => b.department === req.department && b.month === period);
    if (!budgetDoc) {
        return { hasBudget: false, period };
    }

    const allocated = Number(budgetDoc.amount || 0);
    const alreadyCommitted = roundQty((requests || []).reduce((sum, r) => {
        if (!r || r.id === req.id) return sum;
        if (!COMMITTED_STATUSES.includes(r.status) || r.department !== req.department) return sum;
        const d = r.createdAt?.toDate ? r.createdAt.toDate() : null;
        if (!d) return sum;
        const rPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return rPeriod === period ? sum + Number(r.totalCost || 0) : sum;
    }, 0), 2);

    const requestAmount = roundQty(Number(req.totalCost || 0), 2);
    const projectedCommitted = roundQty(alreadyCommitted + requestAmount, 2);
    const remainingBefore = roundQty(allocated - alreadyCommitted, 2);
    const remainingAfter = roundQty(allocated - projectedCommitted, 2);
    const wouldExceed = allocated > 0 ? projectedCommitted > (allocated + 0.001) : requestAmount > 0;
    const exceededBy = wouldExceed ? roundQty(Math.max(0, projectedCommitted - allocated), 2) : 0;
    const usagePctAfter = allocated > 0 ? roundQty((projectedCommitted / allocated) * 100, 1) : 100;

    return {
        hasBudget: true,
        period,
        allocated,
        alreadyCommitted,
        requestAmount,
        projectedCommitted,
        remainingBefore,
        remainingAfter,
        wouldExceed,
        exceededBy,
        usagePctAfter
    };
}

/**
 * Computes percentage unit price change relative to previous base unit price.
 */
export function computePriceChangePct(prevPrice, newBasePrice) {
    const prev = Number(prevPrice);
    const next = Number(newBasePrice);
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(next) || next <= 0) return null;
    return roundQty(((next - prev) / prev) * 100, 1);
}

