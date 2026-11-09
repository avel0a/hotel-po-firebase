/**
 * Shared application state module.
 * All mutable state is centralized here for easy access across modules.
 */

const state = {
    // Firebase instances
    app: null,
    auth: null,
    db: null,

    // Current user info
    userId: null,
    userRole: null,
    userDepartment: null,

    // Firestore listener unsubscribe functions
    unsubscribers: [],

    // Data caches (populated by real-time listeners)
    allRequestsCache: [],
    allUsersCache: [],
    inventoryItemsCache: [],
    budgetsCache: [],
    stockMovementsCache: [],
    departmentsCache: [],
    rolePermissions: {},

    // Chart.js instances (destroyed and recreated on data change)
    requestsStatusChart: null,
    requestsOverTimeChart: null,
    budgetChart: null,

    // Filtered requests for report PDF export
    currentFilteredRequests: [],

    // Inventory table sort state
    inventorySortColumn: 'name',
    inventorySortDirection: 'asc',

    // UI state
    confirmCallback: null,
    notificationTimeout: null,
};

export default state;
