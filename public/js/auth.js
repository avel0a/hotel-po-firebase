/**
 * Authentication and Firestore real-time listeners module.
 * Handles auth state changes, user profile loading, and data subscriptions.
 */

import state from './state.js';
import {
    initializeFirebaseApp, onAuthStateChanged,
    doc, collection, onSnapshot, query, where, orderBy, getDoc, setDoc, serverTimestamp
} from './firebase.js';
import {
    showLoadingOverlay, hideLoadingOverlay, showNotification,
    updateUIVisibility, showSection,
    renderDashboard, renderDashboardCharts, updateStats,
    renderMyRequests, renderApprovals, renderInventory,
    renderBudgets, renderUsersTable, populateItemNameDatalist,
    populateReportFilters, applyReportFilters
} from './ui.js';

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
            await loadUserProfile(user);
            document.getElementById('login-page').style.display = 'none';
            document.getElementById('app-container').classList.remove('hidden');
            hideLoadingOverlay();
        } else {
            document.getElementById('login-page').style.display = 'flex';
            document.getElementById('app-container').classList.add('hidden');
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
        document.getElementById('user-email-display').textContent = user.email;
        document.getElementById('user-name-display').textContent = user.email;
        document.getElementById('user-role-display').textContent = state.userRole;
        document.getElementById('user-department-display').textContent = state.userDepartment || 'N/A';
        updateUIVisibility();
        attachFirestoreListeners();
    } else {
        // New user — create profile with defaults
        state.userRole = 'User';
        state.userDepartment = 'Other';
        await setDoc(userRef, { email: user.email, role: state.userRole, department: state.userDepartment, createdAt: serverTimestamp() });
        loadUserProfile(user);
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

    // Users (only for privileged roles)
    if (state.userRole === 'System Administrator' || state.userRole === 'General Manager' || state.userRole === 'Purchasing') {
        const usersUnsub = onSnapshot(collection(state.db, 'users'), (snapshot) => {
            state.allUsersCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            if (state.userRole === 'System Administrator') {
                const searchVal = document.getElementById('users-search')?.value || '';
                renderUsersTable(state.allUsersCache, searchVal);
            }
            populateReportFilters(state.allUsersCache);
        }, error => console.error("Error listening to users:", error));
        state.unsubscribers.push(usersUnsub);
    }
}
