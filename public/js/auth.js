/**
 * Authentication and Firestore real-time listeners module.
 * Handles auth state changes, user profile loading, and data subscriptions.
 */

import state from './state.js';
import { normalizeRole } from './config.js';
import {
    initializeFirebaseApp, onAuthStateChanged, signOut,
    doc, collection, onSnapshot, query, where, orderBy, getDoc, setDoc, serverTimestamp, limit
} from './firebase.js';
import {
    showLoadingOverlay, hideLoadingOverlay, showNotification,
    updateUIVisibility, showSection, hasPermission,
    renderDashboard, renderDashboardCharts, updateStats,
    renderMyRequests, renderApprovals, renderInventory,
    renderBudgets, renderUsersTable, populateItemNameDatalist,
    populateReportFilters, applyReportFilters, renderStockMovements,
    refreshDepartmentSelects, renderDepartmentsList, renderPermissionsMatrix,
    renderNotificationBell, updateSidebarBadges, renderStoreOperations
} from './ui.js?v=2.6';

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

/**
 * Sets up Firebase auth state change listener.
 */
function setupAuthListener() {
    onAuthStateChanged(state.auth, async (user) => {
        if (user) {
            try {
                await loadUserProfile(user);
            } catch (err) {
                console.error("Error loading user profile:", err);
            }
            const loginPage = document.getElementById('login-page');
            const appContainer = document.getElementById('app-container');
            if (loginPage) loginPage.style.display = 'none';
            if (appContainer) appContainer.classList.remove('hidden');
            hideLoadingOverlay();
        } else {
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
 */
async function loadUserProfile(user) {
    state.userId = user.uid;

    // Preload permissions if saved in Firestore
    try {
        const permSnap = await getDoc(doc(state.db, 'settings', 'permissions'));
        if (permSnap.exists()) {
            state.rolePermissions = permSnap.data();
        }
    } catch (e) {
        console.warn("Could not preload role permissions:", e);
    }

    try {
        const userRef = doc(state.db, `users/${state.userId}`);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.status === 'Suspended') {
                showNotification("Your account has been suspended. Please contact the administrator.", true);
                await signOut(state.auth);
                return;
            }
            state.userRole = userData.role;
            state.userDepartment = userData.department;
            const emailDisp = document.getElementById('user-email-display');
            const nameDisp = document.getElementById('user-name-display');
            const roleDisp = document.getElementById('user-role-display');
            const deptDisp = document.getElementById('user-department-display');
            if (emailDisp) emailDisp.textContent = user.email;
            if (nameDisp) nameDisp.textContent = user.email;
            if (roleDisp) roleDisp.textContent = state.userRole;
            if (deptDisp) deptDisp.textContent = state.userDepartment || 'N/A';
            updateUIVisibility();
            attachFirestoreListeners();
        } else {
            // New user — create profile with defaults
            state.userRole = 'User';
            state.userDepartment = 'Other';
            await setDoc(userRef, { email: user.email, role: state.userRole, department: state.userDepartment, createdAt: serverTimestamp() });
            await loadUserProfile(user);
        }
    } catch (err) {
        console.error("Error loading user profile document:", err);
        const emailDisp = document.getElementById('user-email-display');
        const nameDisp = document.getElementById('user-name-display');
        if (emailDisp) emailDisp.textContent = user.email;
        if (nameDisp) nameDisp.textContent = user.email;
        updateUIVisibility();
        attachFirestoreListeners();
    }
}

/**
 * Attaches real-time Firestore listeners for requests, inventory, budgets, and users.
 * Only fetches requests from the last 120 days for performance.
 */
function attachFirestoreListeners() {
    if (!state.userId) return;

    // Unsubscribe from all previous listeners
    state.unsubscribers.forEach(unsub => unsub());
    state.unsubscribers = [];

    // Requests — last 120 days only (performance optimization)
    const date120DaysAgo = new Date();
    date120DaysAgo.setDate(date120DaysAgo.getDate() - 120);

    const requestsQuery = query(
        collection(state.db, 'requests'),
        where("createdAt", ">=", date120DaysAgo),
        orderBy("createdAt", "desc")
    );

    const reqUnsub = onSnapshot(requestsQuery, (snapshot) => {
        state.allRequestsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderDashboard(state.allRequestsCache);
        renderMyRequests(state.allRequestsCache.filter(r => r.createdBy === state.userId));
        renderBudgets(state.budgetsCache, state.allRequestsCache);
        if (state.userRole === 'General Manager' || state.userRole === 'System Administrator') {
            renderApprovals(state.allRequestsCache);
        }
        updateStats(state.allRequestsCache, null);
        renderDashboardCharts(state.allRequestsCache);
        applyReportFilters();
        updateSidebarBadges();
        renderStoreOperations();
    }, error => {
        console.error("Error listening to requests:", error);
        showNotification("Error fetching data. A database index might be required. Check console (F12) for details.", true);
    });
    state.unsubscribers.push(reqUnsub);

    // Inventory
    const invUnsub = onSnapshot(query(collection(state.db, 'inventory'), orderBy("name")), (snapshot) => {
        state.inventoryItemsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderInventory(state.inventoryItemsCache);
        updateStats(null, state.inventoryItemsCache);
        populateItemNameDatalist();
    }, error => console.error("Error listening to inventory:", error));
    state.unsubscribers.push(invUnsub);

    // Budgets
    const budgetsUnsub = onSnapshot(query(collection(state.db, 'budgets')), (snapshot) => {
        state.budgetsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBudgets(state.budgetsCache, state.allRequestsCache);
    }, error => console.error("Error listening to budgets:", error));
    state.unsubscribers.push(budgetsUnsub);

    // Stock Movements Audit Trail
    const movementsUnsub = onSnapshot(query(collection(state.db, 'stock_movements'), orderBy("timestamp", "desc")), (snapshot) => {
        state.stockMovementsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderStockMovements(state.stockMovementsCache);
    }, error => console.error("Error listening to stock movements:", error));
    state.unsubscribers.push(movementsUnsub);

    // Users (for privileged roles and anyone with manage_users or view_reports)
    const normRole = normalizeRole(state.userRole);
    if (normRole === 'System Administrator' || normRole === 'General Manager' || normRole === 'Purchasing' || normRole === 'Storekeeper' || hasPermission(state.userRole, 'manage_users')) {
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
        if (snapshot.exists()) {
            state.rolePermissions = snapshot.data();
        } else {
            state.rolePermissions = {};
        }
        updateUIVisibility();
        renderPermissionsMatrix();
    }, error => console.error("Error listening to role permissions:", error));
    state.unsubscribers.push(permUnsub);

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
