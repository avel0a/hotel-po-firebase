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
    'Housekeeping', 'Kitchen', 'Maintenance', 'Front Desk', 'Management',
    'Information Technology', 'Food&Beverage', 'SPA', 'Security', 'Finance', 'Other'
];

/** Inventory item categories */
export const INVENTORY_CATEGORIES = [
    'Housekeeping', 'Kitchen', 'Maintenance', 'Office',
    'Information Technology', 'Food&Beverage', 'SPA', 'Security', 'Finance', 'Other'
];

/** User roles */
export const ROLES = ['User', 'Purchasing', 'General Manager', 'System Administrator'];

/** Measurement units for requested items */
export const UNITS = ['Each', 'Box', 'Kg', 'Liter', 'Set'];

/** Request priority levels */
export const PRIORITIES = ['Normal', 'High', 'Urgent'];
