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
export const ROLES = ['User', 'Purchasing', 'Store Keeper', 'General Manager', 'System Administrator'];

/** Measurement units for requested items */
export const UNITS = ['Each', 'Box', 'Kg', 'Liter', 'Set'];

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
    { id: 'manage_users', label: 'Manage Users & Accounts', desc: 'Can create, edit, suspend, and reset staff accounts' },
    { id: 'manage_settings', label: 'Manage Hotel Settings', desc: 'Can add departments and customize role permissions' }
];

/** Default permissions map per role (used when not customized in Firestore) */
export const DEFAULT_ROLE_PERMISSIONS = {
    'System Administrator': [
        'create_request', 'view_all_requests', 'approve_requests',
        'manage_inventory', 'manage_budgets', 'view_reports',
        'manage_users', 'manage_settings'
    ],
    'General Manager': [
        'create_request', 'view_all_requests', 'approve_requests',
        'manage_budgets', 'view_reports'
    ],
    'Store Keeper': [
        'manage_inventory', 'view_all_requests', 'create_request'
    ],
    'Purchasing': [
        'create_request', 'view_all_requests', 'view_reports'
    ],
    'User': [
        'create_request'
    ]
};
