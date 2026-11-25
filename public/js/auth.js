/**
 * Authentication and Firestore real-time listeners module.
 * Handles auth state changes, user profile loading, role-scoped bounded data subscriptions,
 * and admin backup status subscriptions.
 */

import state, { mergePaginatedCache } from './state.js';
import { normalizeRole, DEFAULT_HOTEL_SETTINGS } from './config.js';
import {
    initializeFirebaseApp, onAuthStateChanged, signOut,
    doc, collection, onSnapshot, query, where, orderBy, getDoc, setDoc, serverTimestamp, limit
} from './firebase.js';
import {
    showLoadingOverlay, hideLoadingOverlay, showNotification,
    updateUIVisibility, hasPermission, applyHotelBranding,
    renderDashboard, renderDashboardCharts, updateStats,
    renderMyRequests, renderApprovals, renderInventory,
    renderBudgets, renderUsersTable, populateItemNameDatalist,
    populateReportFilters, applyReportFilters, renderStockMovements,
    refreshDepartmentSelects, renderDepartmentsList, renderPermissionsMatrix,
    renderNotificationBell, updateSidebarBadges, renderStoreOperations,
    renderBackupSectionUI, updateAdminBackupReminder
} from './ui.js?v=3.4';

/**
 * Initializes Firebase and sets up auth listener.
 */
export async function initializeFirebase() {
    showLoadingOverlay();
    try {
        initializeFirebaseApp();
        setupAuthListener();
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        showNotification("Error connecting to the service.", true);
        hideLoadingOverlay();
    }
}

function resetDataCaches() {
    state.allRequestsCache = [];
    state.requestsLiveCache = [];
    state.requestsOlderCache = [];
    state.requestsHasMore = false;
    state.requestsLastDoc = null;
    state.requestsDidPaginateOlder = false;

    state.allUsersCache = [];
    state.inventoryItemsCache = [];
    state.budgetsCache = [];

    state.stockMovementsCache = [];
    state.stockMovementsLiveCache = [];
    state.stockMovementsOlderCache = [];
    state.stockMovementsHasMore = false;
    state.stockMovementsLastDoc = null;
    state.stockMovementsDidPaginateOlder = false;

    state.notificationsCache = [];
    state.backupConfig = null;
    state.backupLogsCache = [];
    state.pendingRestoreData = null;

    state.myRequestsUiPage = 1;
    state.inventoryUiPage = 1;
    state.reportsUiPage = 1;
    state.stockMovementsUiPage = 1;
    state.reconUiPage = 1;
}

/**
 * Sets up Firebase auth state change listener.
 */
function setupAuthListener() {
    onAuthStateChanged(state.auth, async (user) => {
        if (user) {
            let authorized = false;
            try {
                authorized = await loadUserProfile(user);
            } catch (err) {
                console.error("Error loading user profile:", err);
            }
            if (authorized) {
                const loginPage = document.getElementById('login-page');
                const appContainer = document.getElementById('app-container');
                if (loginPage) loginPage.style.display = 'none';
                if (appContainer) appContainer.classList.remove('hidden');
            }
            hideLoadingOverlay();
        } else {
            state.userId = null;
            state.userRole = null;
            state.userDepartment = null;
            resetDataCaches();
            const loginPage = document.getElementById('login-page');
            const appContainer = document.getElementById('app-container');
            if (loginPage) loginPage.style.display = 'flex';
            if (appContainer) appContainer.classList.add('hidden');
            state.unsubscribers.forEach(unsub => unsub());
            state.unsubscribers = [];
            hideLoadingOverlay();
        }
    });
}

/**
 * Loads the user's profile from Firestore and sets role/department in state.
 * Blocks Suspended and Deleted accounts immediately.
 * @returns {Promise<boolean>} True if user is active and authorized
 */
async function loadUserProfile(user) {
    state.userId = user.uid;

    // Preload permissions and hotel branding settings
    try {
        const [permSnap, generalSnap] = await Promise.all([
            getDoc(doc(state.db, 'settings', 'permissions')),
            getDoc(doc(state.db, 'settings', 'general'))
        ]);
        if (permSnap.exists()) {
            state.rolePermissions = permSnap.data();
        }
        state.hotelSettings = generalSnap.exists()
            ? { ...DEFAULT_HOTEL_SETTINGS, ...generalSnap.data() }
            : { ...DEFAULT_HOTEL_SETTINGS };
        applyHotelBranding();
    } catch (e) {
        console.warn("Could not preload settings:", e);
    }

    try {
        const userRef = doc(state.db, `users/${state.userId}`);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.status === 'Suspended' || userData.status === 'Deleted') {
                const msg = userData.status === 'Deleted'
                    ? "Your account access has been revoked. Please contact the administrator."
                    : "Your account has been suspended. Please contact the administrator.";
                showNotification(msg, true);
                await signOut(state.auth);
                return false;
            }
            state.userRole = userData.role;
            state.userDepartment = userData.department;

            const emailDisp = document.getElementById('user-email-display');
            const nameDisp = document.getElementById('user-name-display');
            const roleDisp = document.getElementById('user-role-display');
            const deptDisp = document.getElementById('user-department-display');
            const avatarBadge = document.getElementById('user-avatar-badge');
            if (emailDisp) emailDisp.textContent = user.email;
            if (nameDisp) nameDisp.textContent = user.email;
            if (roleDisp) roleDisp.textContent = normalizeRole(state.userRole);
            if (deptDisp) deptDisp.textContent = state.userDepartment || 'N/A';
            if (avatarBadge) avatarBadge.textContent = (user.email || 'U')[0].toUpperCase();

            updateUIVisibility();
            attachFirestoreListeners();
            return true;
        } else {
            // First-time login profile bootstrap (strictly constrained to 'User' in Firestore rules)
            state.userRole = 'User';
            state.userDepartment = 'Other';
            await setDoc(userRef, {
                email: user.email,
                role: state.userRole,
                department: state.userDepartment,
                status: 'Active',
                createdAt: serverTimestamp()
            });
            return await loadUserProfile(user);
        }
    } catch (err) {
        console.error("Error loading user profile document:", err);
        showNotification("Unable to load user profile. Access denied or connection issue.", true);
        await signOut(state.auth);
        return false;
    }
}

/**
 * Attaches real-time Firestore listeners scoped by the signed-in user's permissions.
 * Uses bounded live queries (limit 500) plus cursor-based Load Older pagination so
 * large hotel datasets never freeze mobile browsers or exhaust Firestore Spark quotas.
 */
function attachFirestoreListeners() {
    if (!state.userId) return;

    state.unsubscribers.forEach(unsub => unsub());
    state.unsubscribers = [];

    state.requestsLiveCache = [];
    state.requestsOlderCache = [];
    state.requestsHasMore = false;
    state.requestsLastDoc = null;
    state.requestsDidPaginateOlder = false;

    state.stockMovementsLiveCache = [];
    state.stockMovementsOlderCache = [];
    state.stockMovementsHasMore = false;
    state.stockMovementsLastDoc = null;
    state.stockMovementsDidPaginateOlder = false;

    const normRole = normalizeRole(state.userRole);
    const canViewAllRequests = hasPermission(state.userRole, 'view_all_requests') ||
        hasPermission(state.userRole, 'approve_requests') ||
        hasPermission(state.userRole, 'manage_inventory') ||
        hasPermission(state.userRole, 'view_reports');

    const requestsQuery = canViewAllRequests
        ? query(
            collection(state.db, 'requests'),
            orderBy("createdAt", "desc"),
            limit(state.requestsPageSize)
        )
        : query(
            collection(state.db, 'requests'),
            where("createdBy", "==", state.userId),
            orderBy("createdAt", "desc"),
            limit(state.requestsPageSize)
        );

    const reqUnsub = onSnapshot(requestsQuery, (snapshot) => {
        state.requestsLiveCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        if (!state.requestsDidPaginateOlder) {
            state.requestsHasMore = snapshot.docs.length >= state.requestsPageSize;
            state.requestsLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
        }
        state.allRequestsCache = mergePaginatedCache(state.requestsLiveCache, state.requestsOlderCache);

        const searchVal = document.getElementById('my-requests-search')?.value || '';
        renderDashboard(state.allRequestsCache);
        renderMyRequests(
            state.allRequestsCache.filter(r => canViewAllRequests || r.createdBy === state.userId),
            searchVal
        );
        renderBudgets(state.budgetsCache, state.allRequestsCache);
        if (hasPermission(state.userRole, 'approve_requests') || normRole === 'General Manager' || normRole === 'System Administrator') {
            renderApprovals(state.allRequestsCache);
        }
        updateStats(state.allRequestsCache, null);
        renderDashboardCharts(state.allRequestsCache);
        applyReportFilters();
        updateSidebarBadges();
        renderStoreOperations();
    }, error => {
        console.error("Error listening to requests:", error);
        showNotification("Error fetching requests. Check permissions or database indexes.", true);
    });
    state.unsubscribers.push(reqUnsub);

    // Inventory (active staff need catalog read for item lookup & requisition validation)
    const invUnsub = onSnapshot(query(collection(state.db, 'inventory'), orderBy("name")), (snapshot) => {
        state.inventoryItemsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const searchVal = document.getElementById('inventory-search')?.value || '';
        renderInventory(state.inventoryItemsCache, searchVal);
        updateStats(null, state.inventoryItemsCache);
        populateItemNameDatalist();
    }, error => console.error("Error listening to inventory:", error));
    state.unsubscribers.push(invUnsub);

    // Budgets (restricted to budget managers)
    if (hasPermission(state.userRole, 'manage_budgets')) {
        const budgetsUnsub = onSnapshot(query(collection(state.db, 'budgets')), (snapshot) => {
            state.budgetsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            renderBudgets(state.budgetsCache, state.allRequestsCache);
        }, error => console.error("Error listening to budgets:", error));
        state.unsubscribers.push(budgetsUnsub);
    } else {
        state.budgetsCache = [];
    }

    // Stock Movements Audit Trail (restricted to Storekeeper, Reports, GM, Admin)
    // Bounded to latest 500 movements live tail + cursor Load More pagination
    if (hasPermission(state.userRole, 'manage_inventory') || hasPermission(state.userRole, 'view_reports') || normRole === 'General Manager') {
        const movementsQuery = query(
            collection(state.db, 'stock_movements'),
            orderBy("timestamp", "desc"),
            limit(state.stockMovementsPageSize)
        );
        const movementsUnsub = onSnapshot(movementsQuery, (snapshot) => {
            state.stockMovementsLiveCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            if (!state.stockMovementsDidPaginateOlder) {
                state.stockMovementsHasMore = snapshot.docs.length >= state.stockMovementsPageSize;
                state.stockMovementsLastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
            }
            state.stockMovementsCache = mergePaginatedCache(state.stockMovementsLiveCache, state.stockMovementsOlderCache);
            renderStockMovements(state.stockMovementsCache);
        }, error => console.error("Error listening to stock movements:", error));
        state.unsubscribers.push(movementsUnsub);
    } else {
        state.stockMovementsCache = [];
    }

    // Users directory (for privileged roles and report filters)
    if (normRole === 'System Administrator' || normRole === 'General Manager' || normRole === 'Purchasing' || normRole === 'Storekeeper' || hasPermission(state.userRole, 'manage_users') || hasPermission(state.userRole, 'view_reports')) {
        const usersUnsub = onSnapshot(collection(state.db, 'users'), (snapshot) => {
            state.allUsersCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            if (hasPermission(state.userRole, 'manage_users')) {
                const searchVal = document.getElementById('users-search')?.value || '';
                renderUsersTable(state.allUsersCache, searchVal);
            }
            populateReportFilters(state.allUsersCache);
        }, error => console.error("Error listening to users:", error));
        state.unsubscribers.push(usersUnsub);
    }

    // Hotel Departments
    const deptsUnsub = onSnapshot(query(collection(state.db, 'departments'), orderBy("name")), (snapshot) => {
        state.departmentsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshDepartmentSelects();
        renderDepartmentsList();
    }, error => console.error("Error listening to departments:", error));
    state.unsubscribers.push(deptsUnsub);

    // Role Permissions Settings
    const permUnsub = onSnapshot(doc(state.db, 'settings', 'permissions'), (snapshot) => {
        state.rolePermissions = snapshot.exists() ? snapshot.data() : {};
        updateUIVisibility();
        renderPermissionsMatrix();
    }, error => console.error("Error listening to role permissions:", error));
    state.unsubscribers.push(permUnsub);

    // General Hotel Branding & Currency Settings
    const generalUnsub = onSnapshot(doc(state.db, 'settings', 'general'), (snapshot) => {
        state.hotelSettings = snapshot.exists()
            ? { ...DEFAULT_HOTEL_SETTINGS, ...snapshot.data() }
            : { ...DEFAULT_HOTEL_SETTINGS };
        applyHotelBranding();
        renderInventory(state.inventoryItemsCache, document.getElementById('inventory-search')?.value || '');
        renderMyRequests(state.allRequestsCache, document.getElementById('my-requests-search')?.value || '');
        renderBudgets(state.budgetsCache, state.allRequestsCache);
    }, error => console.error("Error listening to general settings:", error));
    state.unsubscribers.push(generalUnsub);

    // Admin-only Backup Config & History Listener
    if (normRole === 'System Administrator') {
        const backupsUnsub = onSnapshot(collection(state.db, 'backups'), (snapshot) => {
            let cfg = null;
            const logs = [];
            snapshot.docs.forEach(d => {
                if (d.id === 'config') {
                    cfg = { id: d.id, ...d.data() };
                } else {
                    logs.push({ id: d.id, ...d.data() });
                }
            });
            logs.sort((a, b) => {
                const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAtIso || 0).getTime();
                const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAtIso || 0).getTime();
                return tb - ta;
            });
            state.backupConfig = cfg;
            state.backupLogsCache = logs.slice(0, 20);
            renderBackupSectionUI();
            updateAdminBackupReminder();
        }, error => console.warn("Error listening to backups:", error));
        state.unsubscribers.push(backupsUnsub);
    } else {
        state.backupConfig = null;
        state.backupLogsCache = [];
        updateAdminBackupReminder();
    }

    // In-App Notifications (latest 40 notifications)
    const notifsQuery = query(
        collection(state.db, 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(40)
    );
    const notifsUnsub = onSnapshot(notifsQuery, (snapshot) => {
        state.notificationsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderNotificationBell();
        updateSidebarBadges();
    }, error => console.error("Error listening to notifications:", error));
    state.unsubscribers.push(notifsUnsub);
}
