/**
 * UI module — rendering, modals, notifications, theme, and navigation.
 * All display logic lives here. No data mutations.
 */

import state from './state.js';
import { doc, getDoc } from './firebase.js';
import { DEPARTMENTS, ROLES, AVAILABLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from './config.js';

// ============================================================================
// Loading Overlay
// ============================================================================

export function showLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('hidden', 'invisible');
    overlay.classList.add('opacity-100');
}

export function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.remove('opacity-100');
    overlay.classList.add('opacity-0', 'invisible');
    setTimeout(() => overlay.classList.add('hidden'), 300);
}

// ============================================================================
// Notifications
// ============================================================================

export function showNotification(message, isError = false) {
    const notification = document.getElementById('notification');
    notification.innerHTML = `<p id="notification-message">${message}</p>`;
    notification.className = `notification fixed bottom-5 right-5 text-white py-2 px-4 rounded-lg shadow-lg opacity-0 transform translate-y-10 z-[70] ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    clearTimeout(state.notificationTimeout);
    setTimeout(() => { notification.classList.add('show'); }, 10);
    state.notificationTimeout = setTimeout(() => { notification.classList.remove('show'); }, 3000);
}

// ============================================================================
// Status Badge Helper
// ============================================================================

export function getStatusBadge(status) {
    const colors = {
        Pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-700 dark:text-yellow-200',
        Approved: 'bg-green-100 text-green-800 dark:bg-green-700 dark:text-green-200',
        Rejected: 'bg-red-100 text-red-800 dark:bg-red-700 dark:text-red-200'
    };
    return `<span class="px-2 py-1 text-xs rounded-full ${colors[status] || 'bg-gray-100 text-gray-800'}">${status}</span>`;
}

// ============================================================================
// Permissions & Role-based Visibility
// ============================================================================

/**
 * Checks whether a role has a given permission, using Firestore-saved permissions
 * or falling back to DEFAULT_ROLE_PERMISSIONS.
 */
export function hasPermission(role, permissionName) {
    if (role === 'System Administrator') return true;
    const permissions = state.rolePermissions && state.rolePermissions[role]
        ? state.rolePermissions[role]
        : (DEFAULT_ROLE_PERMISSIONS[role] || []);
    return permissions.includes(permissionName);
}

/**
 * Returns current list of hotel departments (from Firestore or default DEPARTMENTS).
 */
export function getActiveDepartments() {
    if (Array.isArray(state.departmentsCache) && state.departmentsCache.length > 0) {
        return state.departmentsCache.map(d => d.name || d.id);
    }
    return DEPARTMENTS;
}

/**
 * Refreshes all department dropdown selects across the application.
 */
export function refreshDepartmentSelects() {
    const activeDepts = getActiveDepartments();
    const optionsHtml = activeDepts.map(d => `<option value="${d}">${d}</option>`).join('');

    const reqDept = document.getElementById('req-department');
    if (reqDept) {
        const curr = reqDept.value;
        reqDept.innerHTML = optionsHtml;
        if (curr && activeDepts.includes(curr)) reqDept.value = curr;
    }

    const overrideSelect = document.getElementById('req-department-override');
    if (overrideSelect) {
        const curr = overrideSelect.value;
        overrideSelect.innerHTML = optionsHtml;
        if (curr && activeDepts.includes(curr)) overrideSelect.value = curr;
    }

    const newUserDept = document.getElementById('new-user-department');
    if (newUserDept) {
        const curr = newUserDept.value;
        newUserDept.innerHTML = optionsHtml;
        if (curr && activeDepts.includes(curr)) newUserDept.value = curr;
    }

    const budgetDept = document.getElementById('budget-department');
    if (budgetDept) {
        const curr = budgetDept.value;
        budgetDept.innerHTML = optionsHtml;
        if (curr && activeDepts.includes(curr)) budgetDept.value = curr;
    }

    const editUserDept = document.getElementById('edit-user-department');
    if (editUserDept) {
        const curr = editUserDept.value;
        editUserDept.innerHTML = optionsHtml;
        if (curr && activeDepts.includes(curr)) editUserDept.value = curr;
    }
}

export function updateUIVisibility() {
    // Permission map for primary navigation sections
    const sectionPermissionMap = {
        'approvals': 'approve_requests',
        'budgeting': 'manage_budgets',
        'inventory': 'manage_inventory',
        'reports': 'view_reports',
        'user-management': 'manage_users',
        'settings': 'manage_settings'
    };

    // Update navigation items based on dynamic role permissions
    document.querySelectorAll('.nav-link[data-section]').forEach(link => {
        const section = link.dataset.section;
        const requiredPerm = sectionPermissionMap[section];
        const li = link.closest('li');
        if (li && requiredPerm) {
            const hasAccess = hasPermission(state.userRole, requiredPerm);
            li.style.display = hasAccess ? 'list-item' : 'none';
        }
    });

    // Update elements with .requires-role or data-permission
    document.querySelectorAll('.requires-role').forEach(el => {
        if (el.tagName === 'LI' && el.querySelector('.nav-link[data-section]')) {
            // Handled above
            return;
        }

        let isVisible = false;
        if (state.userRole === 'System Administrator') {
            isVisible = true;
        } else if (el.dataset.permission) {
            isVisible = hasPermission(state.userRole, el.dataset.permission);
        } else if (el.dataset.role) {
            const requiredRoles = el.dataset.role.split(',').map(r => r.trim());
            isVisible = requiredRoles.includes(state.userRole);
        }

        if (isVisible) {
            if (el.tagName === 'LI') el.style.display = 'list-item';
            else if (el.tagName === 'TH' || el.tagName === 'TD') el.style.display = 'table-cell';
            else el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
}

// ============================================================================
// Settings — Departments & Permissions Matrix
// ============================================================================

/**
 * Renders the active departments list in the Settings section.
 */
export function renderDepartmentsList() {
    const container = document.getElementById('departments-list-container');
    const badge = document.getElementById('dept-count-badge');
    if (!container) return;

    const activeDepts = getActiveDepartments();
    if (badge) badge.textContent = `${activeDepts.length} Department${activeDepts.length === 1 ? '' : 's'}`;

    if (activeDepts.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-gray-400 text-xs">
                <i class="fas fa-building text-2xl mb-2 opacity-50"></i>
                <p>No departments configured.</p>
            </div>
        `;
        return;
    }

    const usersByDept = (state.allUsersCache || []).reduce((acc, u) => {
        if (u.department) acc[u.department] = (acc[u.department] || 0) + 1;
        return acc;
    }, {});

    const reqsByDept = (state.allRequestsCache || []).reduce((acc, r) => {
        if (r.department) acc[r.department] = (acc[r.department] || 0) + 1;
        return acc;
    }, {});

    container.innerHTML = activeDepts.map(dept => {
        const userCount = usersByDept[dept] || 0;
        const reqCount = reqsByDept[dept] || 0;

        return `
            <div class="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                <div class="flex items-center space-x-3">
                    <div class="w-8 h-8 rounded-lg bg-hotel-primary/10 dark:bg-hotel-primary/20 text-hotel-primary dark:text-blue-300 flex items-center justify-center font-bold text-xs">
                        <i class="fas fa-hotel text-xs"></i>
                    </div>
                    <div>
                        <div class="text-sm font-semibold text-gray-800 dark:text-gray-100">${dept}</div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">
                            <span>${userCount} staff</span> • <span>${reqCount} requests</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button type="button" class="delete-dept-btn p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors rounded hover:bg-red-50 dark:hover:bg-red-950/40" data-department="${dept}" title="Delete Department">
                        <i class="fas fa-trash-alt text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Renders the role permissions checkboxes matrix in the Settings section.
 */
export function renderPermissionsMatrix() {
    const tbody = document.getElementById('permissions-matrix-body');
    if (!tbody) return;

    const roles = ['User', 'Purchasing', 'General Manager', 'System Administrator'];

    tbody.innerHTML = AVAILABLE_PERMISSIONS.map(perm => {
        const cellsHtml = roles.map(role => {
            const isChecked = hasPermission(role, perm.id);
            const isAdmin = role === 'System Administrator';

            return `
                <td class="px-2 py-3 text-center">
                    <input type="checkbox" 
                           class="perm-checkbox w-4 h-4 text-hotel-primary rounded border-gray-300 dark:border-gray-600 focus:ring-hotel-accent cursor-pointer ${isAdmin ? 'opacity-60 cursor-not-allowed' : ''}" 
                           data-role="${role}" 
                           data-permission="${perm.id}" 
                           ${isChecked ? 'checked' : ''} 
                           ${isAdmin ? 'disabled' : ''}
                           title="${isAdmin ? 'System Administrator always has full access' : `${role} - ${perm.label}`}">
                </td>
            `;
        }).join('');

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                <td class="px-4 py-3">
                    <div class="text-xs font-semibold text-gray-800 dark:text-gray-100">${perm.label}</div>
                    <div class="text-[11px] text-gray-500 dark:text-gray-400">${perm.desc}</div>
                </td>
                ${cellsHtml}
            </tr>
        `;
    }).join('');
}

// ============================================================================
// Navigation / Section Switching
// ============================================================================

export function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(s => s.classList.add('hidden'));
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.remove('hidden');
        const title = document.querySelector(`.nav-link[data-section="${sectionId}"]`)?.textContent || 'Dashboard';
        document.getElementById('page-title').textContent = title;
    }
    document.querySelector('.sidebar').classList.remove('open');

    // Handle automatic user and department recognition for New Request
    if (sectionId === 'new-request') {
        const reqUserDisplay = document.getElementById('req-user-display');
        const reqDeptDisplay = document.getElementById('req-dept-display');
        const reqDeptHidden = document.getElementById('req-department');
        const overrideContainer = document.getElementById('req-dept-override-container');
        const overrideCheck = document.getElementById('req-dept-override-check');
        const overrideSelect = document.getElementById('req-department-override');
        const selectWrapper = document.getElementById('req-dept-select-wrapper');

        const currentUserEmail = state.auth?.currentUser?.email || 'N/A';
        const userDept = state.userDepartment || 'Other';

        if (reqUserDisplay) reqUserDisplay.textContent = currentUserEmail;
        if (reqDeptDisplay) reqDeptDisplay.textContent = userDept;
        if (reqDeptHidden) reqDeptHidden.value = userDept;

        // Populate override dropdown with active departments
        const activeDepts = getActiveDepartments();
        if (overrideSelect) {
            overrideSelect.innerHTML = activeDepts.map(d => `<option value="${d}" ${d === userDept ? 'selected' : ''}>${d}</option>`).join('');
        }

        // Only GM and System Admin have permission to order on behalf of another department
        if (overrideContainer) {
            if (state.userRole === 'System Administrator' || state.userRole === 'General Manager') {
                overrideContainer.classList.remove('hidden');
                if (overrideCheck) overrideCheck.checked = false;
                if (selectWrapper) selectWrapper.classList.add('hidden');
            } else {
                overrideContainer.classList.add('hidden');
            }
        }
    }

    if (sectionId === 'settings') {
        renderDepartmentsList();
        renderPermissionsMatrix();
    }

    if (sectionId === 'reports') {
        applyReportFilters();
    }

    // Clear search inputs and re-render tables
    const invSearch = document.getElementById('inventory-search');
    if (invSearch) invSearch.value = '';
    const myReqSearch = document.getElementById('my-requests-search');
    if (myReqSearch) myReqSearch.value = '';
    const usersSearch = document.getElementById('users-search');
    if (usersSearch) usersSearch.value = '';

    renderInventory(state.inventoryItemsCache);
    renderMyRequests(state.allRequestsCache.filter(r => r.createdBy === state.userId));
    if (state.userRole === 'System Administrator') {
        renderUsersTable(state.allUsersCache);
    }
    const clearFilterBtn = document.getElementById('clear-dashboard-filter-btn');
    if (clearFilterBtn) clearFilterBtn.classList.add('hidden');
}

// ============================================================================
// Theme (Dark Mode)
// ============================================================================

export function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    renderDashboardCharts(state.allRequestsCache);
    renderBudgets(state.budgetsCache, state.allRequestsCache);
}

export function loadTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

// ============================================================================
// Modals — Inventory Item
// ============================================================================

export function showItemModal(item = null) {
    const modal = document.getElementById('item-modal');
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md transition-colors duration-300">
            <div class="p-4 border-b flex justify-between items-center">
                <h3 id="modal-title" class="text-lg font-semibold">Add New Inventory Item</h3>
                <button id="close-item-modal-btn" class="text-gray-500 hover:text-gray-700 transition-colors" aria-label="Close modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-4">
                <form id="item-form">
                    <input type="hidden" id="item-id">
                    <div class="space-y-4">
                        <div><label for="item-name" class="block text-sm font-medium text-gray-700 mb-1">Item Name</label><input type="text" id="item-name" class="item-name w-full p-2 border border-gray-300 rounded-md transition-colors duration-300" required></div>
                        <div><label for="item-category" class="block text-sm font-medium text-gray-700 mb-1">Category</label><select id="item-category" class="w-full p-2 border border-gray-300 rounded-md transition-colors duration-300"><option>Housekeeping</option><option>Kitchen</option><option>Maintenance</option><option>Office</option><option>Information Technology</option><option>Food&Beverage</option><option>SPA</option><option>Security</option><option>Finance</option><option>Other</option></select></div>
                        <div class="grid grid-cols-2 gap-4">
                            <div><label for="item-stock" class="block text-sm font-medium text-gray-700 mb-1">Current Stock</label><input type="number" id="item-stock" class="w-full p-2 border border-gray-300 rounded-md transition-colors duration-300" required></div>
                            <div><label for="item-min" class="block text-sm font-medium text-gray-700 mb-1">Minimum Level</label><input type="number" id="item-min" class="w-full p-2 border border-gray-300 rounded-md transition-colors duration-300" required></div>
                        </div>
                        <div><label for="item-price" class="block text-sm font-medium text-gray-700 mb-1">Price ($)</label><input type="number" step="0.01" id="item-price" class="w-full p-2 border border-gray-300 rounded-md transition-colors duration-300" required></div>
                    </div>
                    <div class="flex justify-end space-x-3 mt-6">
                        <button type="button" id="cancel-item-modal-btn" class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-hotel-primary text-white rounded-md hover:bg-hotel-secondary transition-colors">Save Item</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Close/cancel handlers (form submit is handled by event delegation in app.js)
    document.getElementById('close-item-modal-btn').addEventListener('click', hideItemModal);
    document.getElementById('cancel-item-modal-btn').addEventListener('click', hideItemModal);

    const modalTitle = modal.querySelector('#modal-title');
    if (item) {
        if (modalTitle) modalTitle.textContent = 'Edit Inventory Item';
        modal.querySelector('#item-id').value = item.id;
        modal.querySelector('#item-name').value = item.name;
        modal.querySelector('#item-category').value = item.category;
        modal.querySelector('#item-stock').value = item.stock;
        modal.querySelector('#item-min').value = item.min;
        modal.querySelector('#item-price').value = item.price || 0;
    } else {
        if (modalTitle) modalTitle.textContent = 'Add New Inventory Item';
        modal.querySelector('#item-id').value = '';
    }
    modal.classList.remove('hidden', 'opacity-0', 'invisible');
}

export function hideItemModal() {
    const modal = document.getElementById('item-modal');
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// Modals — Issue Stock / Check Out
// ============================================================================

export function showIssueModal(item) {
    const modal = document.getElementById('issue-modal');
    if (!modal) return;

    const deptOptions = getActiveDepartments().map(d => `<option value="${d}">${d}</option>`).join('');

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md transition-colors duration-300 overflow-hidden mx-4">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-dolly mr-2 text-emerald-600"></i> Issue Item / Stock Out
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Record items taken from the store for hotel use.</p>
                </div>
                <button id="close-issue-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="issue-stock-form" class="p-6 space-y-4">
                <input type="hidden" id="issue-item-id" value="${item.id}">
                <input type="hidden" id="issue-item-name" value="${item.name}">
                <input type="hidden" id="issue-item-category" value="${item.category || 'General'}">
                <input type="hidden" id="issue-current-stock" value="${item.stock}">

                <div class="bg-emerald-50 dark:bg-emerald-900/30 p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-800 flex justify-between items-center">
                    <div>
                        <div class="font-bold text-gray-900 dark:text-gray-100">${item.name}</div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">Category: ${item.category}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase">Available in Store</div>
                        <div class="text-xl font-extrabold text-emerald-800 dark:text-emerald-200">${item.stock}</div>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Quantity to Take / Issue *</label>
                    <input type="number" id="issue-quantity" min="1" max="${item.stock}" value="1" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Must be between 1 and ${item.stock}.</p>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Destination Department *</label>
                    <select id="issue-department" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
                        ${deptOptions}
                    </select>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Issued To / Staff Name *</label>
                    <input type="text" id="issue-recipient" placeholder="e.g. Abebe (Chef), Almaz (Housekeeper)..." class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Room / Event / Reason</label>
                    <input type="text" id="issue-reason" placeholder="e.g. Room 204 linen change, Sunday buffet prep..." class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                </div>

                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" id="cancel-issue-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-md transition-colors shadow">Confirm Issuance</button>
                </div>
            </form>
        </div>
    `;

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-issue-modal-btn').addEventListener('click', hideIssueModal);
    document.getElementById('cancel-issue-modal-btn').addEventListener('click', hideIssueModal);
}

export function hideIssueModal() {
    const modal = document.getElementById('issue-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// Modals — Stock Movements / Audit History
// ============================================================================

export function showStockLogModal() {
    const modal = document.getElementById('stock-log-modal');
    if (!modal) return;

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl transition-colors duration-300 overflow-hidden mx-4 max-h-[90vh] flex flex-col">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-history mr-2 text-slate-700 dark:text-slate-300"></i> Stock Movement & Usage Audit Trail
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Real-time log of all items received (Stock In) and issued to departments (Stock Out).</p>
                </div>
                <button id="close-stock-log-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div id="stock-movements-table-container"></div>
            </div>
            <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 flex justify-end">
                <button type="button" id="close-stock-log-btn-bottom" class="px-5 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-md transition-colors shadow">Close</button>
            </div>
        </div>
    `;

    renderStockMovements(state.stockMovementsCache);

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-stock-log-btn').addEventListener('click', hideStockLogModal);
    document.getElementById('close-stock-log-btn-bottom').addEventListener('click', hideStockLogModal);
}

export function hideStockLogModal() {
    const modal = document.getElementById('stock-log-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

export function renderStockMovements(movements) {
    const container = document.getElementById('stock-movements-table-container');
    if (!container) return;

    if (!movements || movements.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500 dark:text-gray-400">
                <i class="fas fa-dolly-flatbed text-4xl mb-3 text-gray-300 dark:text-gray-600"></i>
                <p class="text-sm font-medium">No stock movements recorded yet.</p>
                <p class="text-xs text-gray-400 mt-1">When items are received via PO or issued to departments, full records will appear here.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            <thead class="bg-gray-50 dark:bg-gray-700/60">
                <tr>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Item</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Movement</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Stock Level</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Department / Staff</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reason / Purpose</th>
                    <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Authorized By</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800">
                ${movements.map(m => {
                    const dateStr = m.timestamp?.toDate ? m.timestamp.toDate().toLocaleString() : 'Just now';
                    const isOut = m.type === 'OUT';
                    const badge = isOut
                        ? `<span class="px-2.5 py-1 text-xs font-bold rounded-full bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 inline-flex items-center"><i class="fas fa-arrow-down mr-1"></i> -${m.quantity} OUT</span>`
                        : `<span class="px-2.5 py-1 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 inline-flex items-center"><i class="fas fa-arrow-up mr-1"></i> +${m.quantity} IN</span>`;

                    const stockChange = typeof m.previousStock === 'number' && typeof m.newStock === 'number'
                        ? `<span class="text-xs text-gray-500 dark:text-gray-400">${m.previousStock} ➔ <b class="${isOut ? 'text-amber-600' : 'text-emerald-600'}">${m.newStock}</b></span>`
                        : `<span class="text-xs text-gray-400">N/A</span>`;

                    return `
                        <tr class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">${dateStr}</td>
                            <td class="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                                ${m.itemName}
                                <div class="text-[11px] text-gray-400 font-normal">${m.category || ''}</div>
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap">${badge}</td>
                            <td class="px-4 py-3 whitespace-nowrap">${stockChange}</td>
                            <td class="px-4 py-3 whitespace-nowrap">
                                <div class="font-medium text-gray-800 dark:text-gray-200">${m.department || 'N/A'}</div>
                                <div class="text-xs text-gray-500 dark:text-gray-400">${m.recipient || ''}</div>
                            </td>
                            <td class="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 max-w-xs truncate" title="${m.reason || ''}">
                                ${m.reason || 'N/A'}
                            </td>
                            <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                                ${m.issuedByEmail || 'N/A'}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// ============================================================================
// Modals — Confirmation
// ============================================================================

export function showConfirmModal(message, onConfirm) {
    const modal = document.getElementById('confirm-modal');
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-sm transition-colors duration-300">
            <div class="p-6 text-center">
                <p id="confirm-message" class="mb-4 text-lg">${message}</p>
                <div class="flex justify-center space-x-4">
                    <button id="confirm-cancel-btn" class="px-6 py-2 border rounded-md text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button id="confirm-ok-btn" class="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors">Confirm</button>
                </div>
            </div>
        </div>
    `;
    state.confirmCallback = onConfirm;
    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('confirm-cancel-btn').addEventListener('click', hideConfirmModal);
    document.getElementById('confirm-ok-btn').addEventListener('click', () => {
        if (state.confirmCallback) state.confirmCallback();
        hideConfirmModal();
    });
}

export function hideConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
    state.confirmCallback = null;
}

// ============================================================================
// Modals — Request Details
// ============================================================================

export function showRequestDetailsModal(req) {
    const modal = document.getElementById('request-details-modal');
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg transition-colors duration-300 relative">
            <div class="p-4 border-b flex justify-between items-center">
                <h3 class="text-lg font-semibold">Request Details (ID: ${req.id.substring(0, 8)}...)</h3>
                <button id="close-request-details-modal-btn" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors" aria-label="Close details modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-4 space-y-3">
                <div><span class="font-semibold">Requested By:</span> ${req.createdByEmail || 'N/A'}</div>
                <div><span class="font-semibold">Department:</span> ${req.department}</div>
                <div><span class="font-semibold">Priority:</span> ${req.priority}</div>
                <div><span class="font-semibold">Required By Date:</span> ${req.requiredBy || 'N/A'}</div>
                <div><span class="font-semibold">Status:</span> ${getStatusBadge(req.status)}</div>
                <div><span class="font-semibold">Total Cost:</span> $${(req.totalCost || 0).toFixed(2)}</div>
                <div><span class="font-semibold">Notes:</span> ${req.notes || 'None'}</div>
                <div>
                    <span class="font-semibold">Items:</span>
                    <ul class="list-disc pl-5 mt-1">
                        ${req.items.map(i => `<li>${i.name} - ${i.quantity} ${i.unit || ''} (@ $${(i.price || 0).toFixed(2)} each)</li>`).join('')}
                    </ul>
                </div>
                ${req.approvalNotes ? `<div><span class="font-semibold">Approval Notes:</span> <span class="text-gray-700 dark:text-gray-300">${req.approvalNotes}</span></div>` : ''}
                ${req.received ? `<div><span class="font-semibold text-green-600"><i class="fas fa-check-circle mr-1"></i>Received on: ${req.receivedAt?.toDate().toLocaleDateString() || 'N/A'}</span></div>` : ''}
                ${req.status === 'Approved' && req.processedAt ? `<div><span class="font-semibold text-green-600">Approved on: ${req.processedAt?.toDate().toLocaleDateString() || 'N/A'}</span></div>` : ''}
                ${req.status === 'Rejected' && req.processedAt ? `<div><span class="font-semibold text-red-600">Rejected on: ${req.processedAt?.toDate().toLocaleDateString() || 'N/A'}</span></div>` : ''}
            </div>
        </div>
    `;
    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-request-details-modal-btn').addEventListener('click', hideRequestDetailsModal);
}

export function hideRequestDetailsModal() {
    const modal = document.getElementById('request-details-modal');
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// Request Form Helpers
// ============================================================================

export function addRequestItemRow() {
    const container = document.getElementById('items-container');
    if (!container) return;
    const itemRow = document.createElement('div');
    itemRow.className = 'item-row grid grid-cols-12 gap-2 md:gap-4 items-end';
    itemRow.innerHTML = `
        <div class="col-span-12 md:col-span-5">
            <label class="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
            <input type="text" class="item-name w-full p-2 border border-gray-300 rounded-md transition-colors duration-300" list="inventory-items-list" required>
            <datalist id="inventory-items-list"></datalist>
            <input type="hidden" class="item-price">
        </div>
        <div class="col-span-5 md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
            <input type="number" min="1" class="item-quantity w-full p-2 border border-gray-300 rounded-md transition-colors duration-300" required>
        </div>
        <div class="col-span-4 md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">Unit</label>
            <select class="item-unit w-full p-2 border border-gray-300 rounded-md transition-colors duration-300">
                <option>Each</option><option>Box</option><option>Kg</option><option>Liter</option><option>Set</option>
            </select>
        </div>
        <div class="col-span-3 md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-1">Subtotal</label>
            <span class="item-subtotal block p-2 text-gray-800 dark:text-gray-200 font-medium">$0.00</span>
        </div>
        <div class="col-span-12 md:col-span-1 flex justify-end items-end pb-1">
            <button type="button" class="remove-item-btn p-2 text-red-500 hover:text-red-700 transition-colors" aria-label="Remove item"><i class="fas fa-trash"></i></button>
        </div>
    `;
    container.appendChild(itemRow);
    populateItemNameDatalist();
}

export function populateItemNameDatalist() {
    const datalist = document.getElementById('inventory-items-list');
    if (datalist) {
        datalist.innerHTML = state.inventoryItemsCache.map(item => `<option value="${item.name}"></option>`).join('');
    }
}

export function updateItemSubtotal(row) {
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const quantity = parseInt(row.querySelector('.item-quantity').value) || 0;
    const subtotal = price * quantity;
    row.querySelector('.item-subtotal').textContent = `$${subtotal.toFixed(2)}`;
    updateTotalCost();
}

export function updateTotalCost() {
    const total = Array.from(document.querySelectorAll('#items-container .item-row')).reduce((acc, row) => {
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const quantity = parseInt(row.querySelector('.item-quantity').value) || 0;
        return acc + (price * quantity);
    }, 0);
    document.getElementById('total-cost-display').textContent = `$${total.toFixed(2)}`;
}

// ============================================================================
// Dashboard Rendering
// ============================================================================

export function renderDashboard(requests, filterStatus = null) {
    const tableBody = document.getElementById('dashboard-requests-table');
    const emptyState = document.getElementById('dashboard-requests-empty');
    if (!tableBody || !emptyState) return;

    let requestsToDisplay = requests;
    if (filterStatus) {
        requestsToDisplay = requests.filter(req => req.status === filterStatus);
        document.getElementById('clear-dashboard-filter-btn').classList.remove('hidden');
    } else {
        requestsToDisplay = requests.slice(0, 5);
        document.getElementById('clear-dashboard-filter-btn').classList.add('hidden');
    }

    if (requestsToDisplay.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        tableBody.innerHTML = requestsToDisplay.map(req => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">${req.id.substring(0, 8)}...</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-800 dark:text-gray-200">${req.department}</td>
                <td class="px-6 py-4 whitespace-nowrap text-gray-800 dark:text-gray-200">${req.items.length} items</td>
                <td class="px-6 py-4 whitespace-nowrap">${getStatusBadge(req.status)}</td>
            </tr>
        `).join('');
    }
}

export function renderDashboardCharts(requests) {
    const statusCanvas = document.getElementById('requestsStatusChart');
    if (!statusCanvas) return;
    const statusCtx = statusCanvas.getContext('2d');
    const statusCounts = requests.reduce((acc, req) => {
        acc[req.status] = (acc[req.status] || 0) + 1;
        return acc;
    }, {});

    if (state.requestsStatusChart) state.requestsStatusChart.destroy();
    state.requestsStatusChart = new Chart(statusCtx, {
        type: 'doughnut',
        data: {
            labels: ['Approved', 'Pending', 'Rejected'],
            datasets: [{
                data: [statusCounts.Approved || 0, statusCounts.Pending || 0, statusCounts.Rejected || 0],
                backgroundColor: ['#48BB78', '#ECC94B', '#F56565'],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: document.documentElement.classList.contains('dark') ? '#e2e8f0' : '#4a5568' }
                }
            }
        }
    });

    // Requests Over Time Chart (Bar)
    const timeCanvas = document.getElementById('requestsOverTimeChart');
    if (!timeCanvas) return;
    const timeCtx = timeCanvas.getContext('2d');
    const labels = [];
    const data = [];
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        labels.push(d.toLocaleString('default', { month: 'short', year: 'numeric' }));
        data.push(0);
    }
    requests.forEach(req => {
        if (req.createdAt) {
            const reqDate = req.createdAt.toDate();
            const monthYear = reqDate.toLocaleString('default', { month: 'short', year: 'numeric' });
            const index = labels.indexOf(monthYear);
            if (index !== -1) data[index]++;
        }
    });

    if (state.requestsOverTimeChart) state.requestsOverTimeChart.destroy();
    const isDark = document.documentElement.classList.contains('dark');
    state.requestsOverTimeChart = new Chart(timeCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Requests',
                data: data,
                backgroundColor: '#4299e1',
                borderColor: '#2b6cb0',
                borderWidth: 1,
                borderRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: isDark ? '#e2e8f0' : '#4a5568' },
                    grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
                },
                x: {
                    ticks: { color: isDark ? '#e2e8f0' : '#4a5568' },
                    grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
                }
            },
            plugins: {
                legend: { labels: { color: isDark ? '#e2e8f0' : '#4a5568' } }
            }
        }
    });
}

export function updateStats(requests, inventory) {
    if (requests) {
        document.getElementById('stats-pending').textContent = requests.filter(r => r.status === 'Pending').length;
        document.getElementById('stats-approved').textContent = requests.filter(r => r.status === 'Approved').length;
        document.getElementById('stats-rejected').textContent = requests.filter(r => r.status === 'Rejected').length;
    }
    if (inventory) {
        document.getElementById('stats-low-stock').textContent = inventory.filter(i => i.stock < i.min).length;
    }
}

// ============================================================================
// My Requests Rendering
// ============================================================================

export function renderMyRequests(requests, searchTerm = '') {
    const tableBody = document.getElementById('my-requests-table');
    const emptyState = document.getElementById('my-requests-empty');
    if (!tableBody || !emptyState) return;

    let displayRequests = requests;
    if (state.userRole === 'Purchasing' || state.userRole === 'General Manager' || state.userRole === 'System Administrator') {
        displayRequests = state.allRequestsCache;
    } else {
        displayRequests = state.allRequestsCache.filter(r => r.createdBy === state.userId);
    }

    if (searchTerm) {
        const lc = searchTerm.toLowerCase();
        displayRequests = displayRequests.filter(req =>
            req.department.toLowerCase().includes(lc) ||
            req.items.some(item => item.name.toLowerCase().includes(lc)) ||
            req.status.toLowerCase().includes(lc) ||
            req.priority.toLowerCase().includes(lc) ||
            (req.createdByEmail && req.createdByEmail.toLowerCase().includes(lc))
        );
    }

    if (displayRequests.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        tableBody.innerHTML = displayRequests.map(req => {
            let receivedCell = '';
            if (req.status === 'Approved' && !req.received && req.createdBy === state.userId) {
                receivedCell = `<button class="mark-received-btn px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs transition-colors" data-id="${req.id}">Mark as Received</button>`;
            } else if (req.received) {
                receivedCell = '<span class="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Received</span>';
            }
            const viewBtn = `<button class="view-request-btn px-3 py-1 bg-hotel-accent text-white rounded hover:bg-blue-600 text-xs transition-colors mr-2" data-id="${req.id}">View Details</button>`;
            return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap">${req.createdAt?.toDate().toLocaleDateString() || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap">${req.department}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">$${(req.totalCost || 0).toFixed(2)}</td>
                    <td class="px-6 py-4 whitespace-nowrap">${req.priority}</td>
                    <td class="px-6 py-4 whitespace-nowrap">${getStatusBadge(req.status)}</td>
                    <td class="px-6 py-4 whitespace-nowrap">${viewBtn}${receivedCell}</td>
                </tr>
            `;
        }).join('');
    }
}

// ============================================================================
// Approvals Rendering
// ============================================================================

export function renderApprovals(requests) {
    const container = document.getElementById('approval-cards-container');
    const emptyState = document.getElementById('approvals-empty');
    if (!container || !emptyState) return;

    const pending = requests.filter(r => r.status === 'Pending');
    if (pending.length === 0) {
        container.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        container.innerHTML = pending.map(req => {
            const itemsList = req.items.map(i => `<li>${i.name} - ${i.quantity} ${i.unit}</li>`).join('');
            const requestedByEmail = state.allUsersCache.find(u => u.id === req.createdBy)?.email || 'N/A';
            return `
                <div class="approval-card border rounded-lg overflow-hidden bg-white dark:bg-gray-800 hover:shadow-md transition-shadow duration-200">
                    <div class="bg-gray-50 dark:bg-gray-700 px-4 py-3 flex justify-between items-center">
                        <div>
                            <span class="font-medium text-gray-800 dark:text-gray-200">${req.department}</span>
                            <span class="text-sm text-gray-500 dark:text-gray-400 ml-4">Requested by: ${requestedByEmail}</span>
                            <span class="text-sm text-gray-500 dark:text-gray-400 ml-4">Required by: ${req.requiredBy}</span>
                        </div>
                        <div><span class="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-700 dark:text-blue-200">${req.priority} Priority</span></div>
                    </div>
                    <div class="p-4">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Items Requested</h4>
                                <ul class="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300">${itemsList}</ul>
                                <p class="font-semibold mt-2">Total: $${(req.totalCost || 0).toFixed(2)}</p>
                            </div>
                            <div>
                                <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</h4>
                                <p class="text-sm text-gray-700 dark:text-gray-300">${req.notes || 'None'}</p>
                            </div>
                            <div>
                                <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Approval Notes</h4>
                                <textarea data-id="${req.id}" class="approval-notes-input w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 resize-none mb-2" rows="2" placeholder="Optional notes (e.g. reason for approval/rejection)..."></textarea>
                                <h4 class="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Actions</h4>
                                <div class="flex space-x-2 mt-2">
                                    <button data-id="${req.id}" class="approve-btn flex-1 px-3 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 text-sm transition-colors">Approve</button>
                                    <button data-id="${req.id}" class="reject-btn flex-1 px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 text-sm transition-colors">Reject</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// ============================================================================
// Inventory Rendering
// ============================================================================

export function renderInventory(items, searchTerm = '') {
    const tableBody = document.getElementById('inventory-table');
    const emptyState = document.getElementById('inventory-empty');
    if (!tableBody || !emptyState) return;

    const canEdit = state.userRole === 'System Administrator' || state.userRole === 'Purchasing';
    let itemsToDisplay = [...items];

    if (searchTerm) {
        const lc = searchTerm.toLowerCase();
        itemsToDisplay = itemsToDisplay.filter(item =>
            item.name.toLowerCase().includes(lc) || item.category.toLowerCase().includes(lc)
        );
    }

    itemsToDisplay.sort((a, b) => {
        const aVal = typeof a[state.inventorySortColumn] === 'string' ? a[state.inventorySortColumn].toLowerCase() : a[state.inventorySortColumn];
        const bVal = typeof b[state.inventorySortColumn] === 'string' ? b[state.inventorySortColumn].toLowerCase() : b[state.inventorySortColumn];
        if (aVal < bVal) return state.inventorySortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return state.inventorySortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    if (itemsToDisplay.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    tableBody.innerHTML = itemsToDisplay.map(item => {
        let status, color;
        if (item.stock <= 0) { status = 'Out of Stock'; color = 'red'; }
        else if (item.stock < item.min) { status = 'Low Stock'; color = 'yellow'; }
        else { status = 'In Stock'; color = 'green'; }
        const actionsHtml = canEdit ? `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                <button data-id="${item.id}" class="issue-item-btn text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 mr-3 transition-colors" title="Issue / Check Out stock to department" ${item.stock <= 0 ? 'disabled style="opacity: 0.35; cursor: not-allowed;"' : ''}>
                    <i class="fas fa-dolly"></i>
                </button>
                <button data-id="${item.id}" class="edit-item-btn text-hotel-accent hover:text-hotel-secondary mr-3 transition-colors" aria-label="Edit item" title="Edit Item Details">
                    <i class="fas fa-edit"></i>
                </button>
                <button data-id="${item.id}" class="delete-item-btn text-red-500 hover:text-red-700 transition-colors" aria-label="Delete item" title="Delete Item">
                    <i class="fas fa-trash"></i>
                </button>
            </td>` : '';
        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap">${item.name}</td>
                <td class="px-6 py-4 whitespace-nowrap">${item.category}</td>
                <td class="px-6 py-4 whitespace-nowrap">$${(item.price || 0).toFixed(2)}</td>
                <td class="px-6 py-4 whitespace-nowrap">${item.stock}</td>
                <td class="px-6 py-4 whitespace-nowrap">${item.min}</td>
                <td class="px-6 py-4 whitespace-nowrap"><span class="px-2 py-1 text-xs rounded-full bg-${color}-100 text-${color}-800 dark:bg-${color}-700 dark:text-${color}-200">${status}</span></td>
                ${actionsHtml}
            </tr>
        `;
    }).join('');

    // Update sort icons
    document.querySelectorAll('#inventory-table-element th[data-sort] i').forEach(icon => {
        icon.classList.remove('fa-sort-up', 'fa-sort-down');
        icon.classList.add('fa-sort');
    });
    const currentSortIcon = document.querySelector(`#inventory-table-element th[data-sort="${state.inventorySortColumn}"] i`);
    if (currentSortIcon) {
        currentSortIcon.classList.remove('fa-sort');
        currentSortIcon.classList.add(state.inventorySortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
    }
    updateUIVisibility();
}

// ============================================================================
// Reports Rendering
// ============================================================================

function getPeriodStart(date, periodType) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (periodType === 'week') { d.setDate(d.getDate() - d.getDay()); }
    else if (periodType === 'month') { d.setDate(1); }
    else if (periodType === 'year') { d.setMonth(0, 1); }
    return d.getTime();
}

export function renderReports(requestsToRender) {
    const now = new Date();
    const periods = [
        { label: 'This Week', start: getPeriodStart(now, 'week') },
        { label: 'This Month', start: getPeriodStart(now, 'month') },
        { label: 'This Year', start: getPeriodStart(now, 'year') },
    ];
    const reportSummaryDiv = document.getElementById('report-summary');
    const detailedReportTableDiv = document.getElementById('detailed-report-table');
    const reportsEmptyState = document.getElementById('reports-empty');
    if (!reportSummaryDiv || !detailedReportTableDiv || !reportsEmptyState) return;

    let summaryHtml = `<table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 mb-6">
        <thead class="bg-gray-50 dark:bg-gray-800"><tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Period</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Total Requests</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Approved (Purchased)</th>
        </tr></thead><tbody>`;
    periods.forEach(period => {
        const total = requestsToRender.filter(r => r.createdAt?.toDate().getTime() >= period.start).length;
        const approved = requestsToRender.filter(r => r.status === 'Approved' && r.createdAt?.toDate().getTime() >= period.start).length;
        summaryHtml += `<tr><td class="px-6 py-4">${period.label}</td><td class="px-6 py-4">${total}</td><td class="px-6 py-4">${approved}</td></tr>`;
    });
    summaryHtml += '</tbody></table>';
    reportSummaryDiv.innerHTML = summaryHtml;

    let detailedHtml = `<table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-800"><tr>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Date</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Department</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Total Cost</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Requested By</th>
            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Status</th>
        </tr></thead><tbody>`;
    const sorted = [...requestsToRender].sort((a, b) => (b.createdAt?.toDate().getTime() || 0) - (a.createdAt?.toDate().getTime() || 0));

    if (sorted.length === 0) {
        detailedHtml += `<tr><td colspan="5" class="text-center p-4 text-gray-500">No requests found with current filters.</td></tr>`;
        reportsEmptyState.classList.remove('hidden');
    } else {
        reportsEmptyState.classList.add('hidden');
        sorted.forEach(req => {
            const date = req.createdAt?.toDate().toLocaleDateString() || 'N/A';
            const requestedByEmail = state.allUsersCache.find(u => u.id === req.createdBy)?.email || 'N/A';
            detailedHtml += `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td class="px-4 py-2">${date}</td>
                    <td class="px-4 py-2">${req.department}</td>
                    <td class="px-4 py-2">$${(req.totalCost || 0).toFixed(2)}</td>
                    <td class="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">${requestedByEmail}</td>
                    <td class="px-4 py-2">${getStatusBadge(req.status)}</td>
                </tr>
            `;
        });
    }
    detailedHtml += '</tbody></table>';
    detailedReportTableDiv.innerHTML = detailedHtml;
}

export function applyReportFilters() {
    const fromDate = document.getElementById('from-date-filter').value;
    const toDate = document.getElementById('to-date-filter').value;
    const status = document.getElementById('status-filter').value;
    const userIdFilter = document.getElementById('user-filter').value;

    let filtered = [...state.allRequestsCache];
    if (fromDate) {
        const startTimestamp = new Date(fromDate).getTime();
        filtered = filtered.filter(req => req.createdAt?.toDate().getTime() >= startTimestamp);
    }
    if (toDate) {
        const endTimestamp = new Date(toDate);
        endTimestamp.setHours(23, 59, 59, 999);
        filtered = filtered.filter(req => req.createdAt?.toDate().getTime() <= endTimestamp.getTime());
    }
    if (status) {
        filtered = filtered.filter(req => req.status === status);
    }
    if (userIdFilter) {
        filtered = filtered.filter(req => req.createdBy === userIdFilter);
    }
    state.currentFilteredRequests = filtered;
    renderReports(state.currentFilteredRequests);
}

export function populateReportFilters(users) {
    const userFilter = document.getElementById('user-filter');
    if (!userFilter) return;
    const currentVal = userFilter.value;
    userFilter.innerHTML = '<option value="">All Users</option>';
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.email;
        userFilter.appendChild(option);
    });
    userFilter.value = currentVal;
}

// ============================================================================
// Budgets Rendering
// ============================================================================

export function renderBudgets(budgets, requests) {
    const overviewContainer = document.getElementById('budgets-overview');
    const emptyState = document.getElementById('budgets-empty');
    const budgetChartCanvas = document.getElementById('budgetChart');
    if (!overviewContainer || !emptyState || !budgetChartCanvas) return;

    const currentYear = new Date().getFullYear().toString();
    const currentYearBudgets = budgets.filter(b => b.year === currentYear);

    if (currentYearBudgets.length === 0) {
        overviewContainer.innerHTML = '';
        emptyState.classList.remove('hidden');
        if (state.budgetChart) state.budgetChart.destroy();
        return;
    }

    emptyState.classList.add('hidden');

    const budgetData = currentYearBudgets.map(budget => {
        const [year, month] = budget.month.split('-');
        const spent = requests
            .filter(req =>
                req.status === 'Approved' &&
                req.department === budget.department &&
                req.createdAt &&
                req.createdAt.toDate().getFullYear().toString() === year &&
                (req.createdAt.toDate().getMonth() + 1).toString().padStart(2, '0') === month
            )
            .reduce((acc, req) => acc + (req.totalCost || 0), 0);
        const remaining = budget.amount - spent;
        const percentage = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
        return { ...budget, spent, remaining, percentage };
    });

    budgetData.sort((a, b) => a.month.localeCompare(b.month) || a.department.localeCompare(b.department));

    let tableHtml = `<table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-800"><tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Month</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Department</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Allocated</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Spent</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Remaining</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Usage</th>
        </tr></thead><tbody class="bg-white divide-y divide-gray-200 dark:bg-gray-800">`;

    budgetData.forEach(b => {
        const remainingColor = b.remaining < 0 ? 'text-red-500' : 'text-green-600';
        const progressColor = b.percentage > 90 ? 'bg-red-500' : (b.percentage > 70 ? 'bg-yellow-500' : 'bg-green-500');
        tableHtml += `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap">${b.month}</td>
                <td class="px-6 py-4 whitespace-nowrap">${b.department}</td>
                <td class="px-6 py-4 whitespace-nowrap">$${b.amount.toFixed(2)}</td>
                <td class="px-6 py-4 whitespace-nowrap">$${b.spent.toFixed(2)}</td>
                <td class="px-6 py-4 whitespace-nowrap ${remainingColor}">$${b.remaining.toFixed(2)}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                        <div class="${progressColor} h-2.5 rounded-full" style="width: ${Math.min(b.percentage, 100)}%"></div>
                    </div>
                </td>
            </tr>
        `;
    });

    tableHtml += `</tbody></table>`;
    overviewContainer.innerHTML = tableHtml;

    // Budget Chart
    const budgetChartCtx = budgetChartCanvas.getContext('2d');
    if (state.budgetChart) state.budgetChart.destroy();

    const departments = [...new Set(budgetData.map(b => b.department))].sort();
    const allocatedData = departments.map(dept =>
        budgetData.filter(b => b.department === dept).reduce((sum, b) => sum + b.amount, 0)
    );
    const spentData = departments.map(dept =>
        budgetData.filter(b => b.department === dept).reduce((sum, b) => sum + b.spent, 0)
    );
    const isDark = document.documentElement.classList.contains('dark');

    state.budgetChart = new Chart(budgetChartCtx, {
        type: 'bar',
        data: {
            labels: departments,
            datasets: [
                {
                    label: 'Allocated Budget',
                    data: allocatedData,
                    backgroundColor: 'rgba(66, 153, 225, 0.6)',
                    borderColor: 'rgba(66, 153, 225, 1)',
                    borderWidth: 1,
                    borderRadius: 5,
                },
                {
                    label: 'Spent',
                    data: spentData,
                    backgroundColor: 'rgba(58, 80, 107, 0.6)',
                    borderColor: 'rgba(58, 80, 107, 1)',
                    borderWidth: 1,
                    borderRadius: 5,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: function(value) { return '$' + value; }, color: isDark ? '#e2e8f0' : '#4a5568' },
                    grid: { color: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }
                },
                x: {
                    ticks: { color: isDark ? '#e2e8f0' : '#4a5568' },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { position: 'top', labels: { color: isDark ? '#e2e8f0' : '#4a5568' } }
            }
        }
    });
}

// ============================================================================
// User Management — Modals and Table Rendering
// ============================================================================

function getRoleBadge(role) {
    switch (role) {
        case 'System Administrator':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 inline-flex items-center"><i class="fas fa-shield-alt mr-1"></i>Admin</span>';
        case 'General Manager':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 inline-flex items-center"><i class="fas fa-user-tie mr-1"></i>GM</span>';
        case 'Purchasing':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 inline-flex items-center"><i class="fas fa-shopping-cart mr-1"></i>Purchasing</span>';
        default:
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 inline-flex items-center"><i class="fas fa-user mr-1"></i>User</span>';
    }
}

export function showUserModal(user) {
    const modal = document.getElementById('user-modal');
    if (!modal) return;

    const roleOptions = ROLES.map(r => `<option value="${r}" ${r === user.role ? 'selected' : ''}>${r}</option>`).join('');
    const deptOptions = getActiveDepartments().map(d => `<option value="${d}" ${d === user.department ? 'selected' : ''}>${d}</option>`).join('');
    const userStatus = user.status || 'Active';

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md transition-colors duration-300 overflow-hidden mx-4">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                    <i class="fas fa-user-edit mr-2 text-hotel-accent"></i> Edit User
                </h3>
                <button id="close-user-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="edit-user-form" class="p-6 space-y-4">
                <input type="hidden" id="edit-user-id" value="${user.id}">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Email</label>
                    <input type="text" value="${user.email}" disabled class="w-full p-2.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-300 cursor-not-allowed">
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Role</label>
                    <select id="edit-user-role" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-hotel-accent focus:border-hotel-accent transition-colors">
                        ${roleOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Department</label>
                    <select id="edit-user-department" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-hotel-accent focus:border-hotel-accent transition-colors">
                        ${deptOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Account Status</label>
                    <select id="edit-user-status" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-hotel-accent focus:border-hotel-accent transition-colors">
                        <option value="Active" ${userStatus === 'Active' ? 'selected' : ''}>Active</option>
                        <option value="Suspended" ${userStatus === 'Suspended' ? 'selected' : ''}>Suspended</option>
                    </select>
                </div>
                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" id="cancel-user-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button type="submit" class="px-5 py-2 bg-hotel-primary text-white text-sm font-medium rounded-md hover:bg-hotel-secondary transition-colors shadow">Save Changes</button>
                </div>
            </form>
        </div>
    `;

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-user-modal-btn').addEventListener('click', hideUserModal);
    document.getElementById('cancel-user-modal-btn').addEventListener('click', hideUserModal);
}

export function hideUserModal() {
    const modal = document.getElementById('user-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

export function renderUsersTable(users, searchTerm = '') {
    const tableBody = document.getElementById('users-table');
    const emptyState = document.getElementById('users-empty');
    if (!tableBody || !emptyState) return;

    let displayUsers = users || state.allUsersCache;

    if (searchTerm) {
        const lc = searchTerm.toLowerCase();
        displayUsers = displayUsers.filter(u =>
            (u.email && u.email.toLowerCase().includes(lc)) ||
            (u.role && u.role.toLowerCase().includes(lc)) ||
            (u.department && u.department.toLowerCase().includes(lc))
        );
    }

    if (displayUsers.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        tableBody.innerHTML = displayUsers.map(user => {
            const isSelf = user.id === state.userId;
            const status = user.status || 'Active';
            const statusDot = status === 'Active'
                ? '<span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2" title="Active"></span>'
                : '<span class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 mr-2" title="Suspended"></span>';

            const createdDate = user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : 'N/A';

            return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center">
                        ${statusDot}
                        <span>${user.email}</span>
                        ${isSelf ? '<span class="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 rounded font-normal">You</span>' : ''}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm">${getRoleBadge(user.role)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                        <i class="fas fa-building text-gray-400 mr-1.5 text-xs"></i>${user.department || 'N/A'}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        ${createdDate}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                        <div class="flex items-center justify-end space-x-1">
                            <button class="edit-user-btn p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-gray-700 rounded transition-colors" data-id="${user.id}" title="Edit User Role & Department">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="reset-pwd-user-btn p-1.5 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 hover:bg-amber-50 dark:hover:bg-gray-700 rounded transition-colors" data-id="${user.id}" data-email="${user.email}" title="Send Password Reset Email">
                                <i class="fas fa-key"></i>
                            </button>
                            ${!isSelf ? `
                            <button class="delete-user-btn p-1.5 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-gray-700 rounded transition-colors" data-id="${user.id}" data-email="${user.email}" title="Delete User">
                                <i class="fas fa-trash"></i>
                            </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}
