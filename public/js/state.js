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

    // Data caches (populated by real-time listeners + cursor pagination)
    allRequestsCache: [],
    allUsersCache: [],
    inventoryItemsCache: [],
    budgetsCache: [],
    stockMovementsCache: [],
    departmentsCache: [],
    notificationsCache: [],
    rolePermissions: {},
    hotelSettings: null,

    // Admin backup & Cloudinary settings cache
    backupConfig: null,
    backupLogsCache: [],
    pendingRestoreData: null,

    // Firestore bounded live tails + cursor pagination (prevents UI freezing at scale)
    requestsPageSize: 500,
    requestsLiveCache: [],
    requestsOlderCache: [],
    requestsHasMore: false,
    requestsLastDoc: null,
    requestsDidPaginateOlder: false,

    stockMovementsPageSize: 500,
    stockMovementsLiveCache: [],
    stockMovementsOlderCache: [],
    stockMovementsHasMore: false,
    stockMovementsLastDoc: null,
    stockMovementsDidPaginateOlder: false,

    // Client-side UI table pagination state
    myRequestsUiPage: 1,
    myRequestsUiPageSize: 25,
    inventoryUiPage: 1,
    inventoryUiPageSize: 50,
    reportsUiPage: 1,
    reportsUiPageSize: 50,
    stockMovementsUiPage: 1,
    stockMovementsUiPageSize: 50,
    stockLogFilterItem: null,
    reconUiPage: 1,
    reconUiPageSize: 50,

    // Chart.js instances (destroyed and recreated on data change)
    requestsStatusChart: null,
    requestsOverTimeChart: null,
    budgetChart: null,

    // Filtered requests for report PDF export
    currentFilteredRequests: [],

    // Inventory table sort state
    inventorySortColumn: 'name',
    inventorySortDirection: 'asc',

    // Request filter state
    requestFlowFilter: 'all', // 'all', 'requisition', 'purchase'

    // UI state
    confirmCallback: null,
    notificationTimeout: null,
};

/**
 * Merges live Firestore tail docs with manually loaded older cursor pages,
 * keeping live versions authoritative and preserving chronological order.
 */
export function mergePaginatedCache(liveRows = [], olderRows = []) {
    if (!olderRows || olderRows.length === 0) return [...liveRows];
    const seen = new Set();
    const merged = [];
    for (const row of liveRows) {
        if (row && row.id && !seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
        }
    }
    for (const row of olderRows) {
        if (row && row.id && !seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
        }
    }
    return merged;
}

export default state;
