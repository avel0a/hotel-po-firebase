/**
 * UI module — rendering, modals, notifications, theme, and navigation.
 * All display logic lives here. No data mutations.
 */

import state from './state.js';
import { doc, getDoc } from './firebase.js';
import { DEPARTMENTS, ROLES, AVAILABLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, UNITS, DEFAULT_UNIT_MULTIPLIERS, getUnitConversionFactor, isPurchaseRequest, normalizeRole } from './config.js';

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
    const badgeConfigs = {
        'Pending': {
            classes: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border border-amber-300 dark:border-amber-700',
            icon: 'fa-clock'
        },
        'Approved': {
            classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border border-blue-300 dark:border-blue-700',
            icon: 'fa-check'
        },
        'Ordered': {
            classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200 border border-purple-300 dark:border-purple-700',
            icon: 'fa-truck'
        },
        'Partially Issued': {
            classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200 border border-orange-300 dark:border-orange-700',
            icon: 'fa-boxes'
        },
        'Issued': {
            classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700',
            icon: 'fa-check-double'
        },
        'Partially Received': {
            classes: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200 border border-sky-300 dark:border-sky-700',
            icon: 'fa-dolly-flatbed'
        },
        'Received': {
            classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200 border border-teal-300 dark:border-teal-700',
            icon: 'fa-warehouse'
        },
        'Rejected': {
            classes: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 border border-red-300 dark:border-red-700',
            icon: 'fa-times-circle'
        }
    };
    const config = badgeConfigs[status] || {
        classes: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600',
        icon: 'fa-circle'
    };
    return `<span class="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${config.classes}"><i class="fas ${config.icon} mr-1 text-[10px]"></i>${status}</span>`;
}

// ============================================================================
// Permissions & Role-based Visibility
// ============================================================================

/**
 * Checks whether a role has a given permission, using Firestore-saved permissions
 * or falling back to DEFAULT_ROLE_PERMISSIONS.
 */
export function hasPermission(role, permissionName) {
    const norm = normalizeRole(role);
    if (norm === 'System Administrator') return true;
    const altRole = norm === 'Storekeeper' ? 'Store Keeper' : null;
    const permissions = (state.rolePermissions && state.rolePermissions[norm])
        ? state.rolePermissions[norm]
        : (altRole && state.rolePermissions && state.rolePermissions[altRole])
            ? state.rolePermissions[altRole]
            : (DEFAULT_ROLE_PERMISSIONS[norm] || (altRole ? DEFAULT_ROLE_PERMISSIONS[altRole] : []) || []);
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
        const normUserRole = normalizeRole(state.userRole);
        if (normUserRole === 'System Administrator') {
            isVisible = true;
        } else if (el.dataset.permission) {
            isVisible = hasPermission(state.userRole, el.dataset.permission);
        } else if (el.dataset.role) {
            const requiredRoles = el.dataset.role.split(',').map(r => normalizeRole(r.trim()));
            isVisible = requiredRoles.includes(normUserRole);
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

    const roles = ['User', 'Purchasing', 'Storekeeper', 'General Manager', 'System Administrator'];

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

        // Auto-select Request Purpose based on user role
        const reqTypePo = document.getElementById('req-type-po');
        const reqTypeReq = document.getElementById('req-type-requisition');
        if (reqTypePo && reqTypeReq) {
            if (state.userRole === 'Purchasing' || normalizeRole(state.userRole) === 'Storekeeper' || userDept === 'Store' || userDept === 'Purchasing') {
                reqTypePo.checked = true;
                reqTypeReq.checked = false;
            } else {
                reqTypeReq.checked = true;
                reqTypePo.checked = false;
            }
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
    renderMyRequests(state.allRequestsCache);
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
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md transition-colors duration-300">
            <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750 rounded-t-xl">
                <h3 id="modal-title" class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                    <i class="fas fa-box-open mr-2 text-hotel-accent"></i> ${item ? 'Edit Inventory Item' : 'Add New Inventory Item'}
                </h3>
                <button id="close-item-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-5">
                <form id="item-form">
                    <input type="hidden" id="item-id">
                    <input type="hidden" id="item-prev-stock" value="${item ? (item.stock ?? 0) : 0}">
                    <input type="hidden" id="item-prev-price" value="${item ? (item.price ?? 0) : 0}">
                    <div class="space-y-4">
                        <div>
                            <label for="item-name" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">Item Name</label>
                            <input type="text" id="item-name" class="item-name w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm" placeholder="e.g. White Sugar" required>
                        </div>
                        <div>
                            <label for="item-category" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">Category</label>
                            <select id="item-category" class="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm">
                                <option>Housekeeping</option><option>Kitchen</option><option>Maintenance</option><option>Office</option><option>Information Technology</option><option>Food&Beverage</option><option>SPA</option><option>Security</option><option>Finance</option><option>Other</option>
                            </select>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label for="item-unit" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">Base Unit</label>
                                <select id="item-unit" class="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm">
                                    ${UNITS.map(u => `<option value="${u}">${u}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label for="item-package-size" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1" title="Number of base units in one box/bag/pack">Units / Pkg</label>
                                <input type="number" min="1" step="1" id="item-package-size" value="1" placeholder="e.g. 25" class="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm">
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label for="item-stock" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">Current Stock</label>
                                <input type="number" id="item-stock" min="0" class="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-bold transition-colors duration-300 text-sm" required>
                            </div>
                            <div>
                                <label for="item-min" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">Min. Alert Level</label>
                                <input type="number" id="item-min" min="0" class="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm" required>
                            </div>
                        </div>
                        <div>
                            <label for="item-price" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">Base Unit Price (Birr)</label>
                            <input type="number" step="0.01" min="0" id="item-price" class="w-full p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm" required>
                        </div>
                        <div id="item-adjustment-reason-container" class="${item ? '' : 'hidden'}">
                            <label for="item-adjustment-reason" class="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                <i class="fas fa-clipboard-check text-amber-500 mr-1"></i> Adjustment Reason / Audit Note
                            </label>
                            <input type="text" id="item-adjustment-reason" placeholder="e.g. Physical stock count discrepancy, Damaged items written off..." class="w-full p-2.5 border border-amber-300 dark:border-amber-600/60 rounded-lg bg-amber-50/40 dark:bg-gray-700 text-gray-800 dark:text-gray-100 transition-colors duration-300 text-sm">
                            <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1">Increasing or decreasing stock is permanently logged to the Stock Movement Audit Trail.</p>
                            ${item ? `
                                <div class="mt-2.5 p-2 rounded-lg bg-gray-100/70 dark:bg-gray-750 border border-gray-200 dark:border-gray-600 flex items-center justify-between text-xs">
                                    <span class="text-gray-600 dark:text-gray-300 flex items-center">
                                        <i class="fas fa-history text-indigo-500 mr-1.5"></i> Movement History
                                    </span>
                                    <button type="button" class="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-semibold view-item-history-btn" data-id="${item.id}">
                                        View Audit Trail ➔
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="flex justify-end space-x-3 mt-6 pt-3 border-t border-gray-100 dark:border-gray-700">
                        <button type="button" id="cancel-item-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm font-medium transition-colors">Cancel</button>
                        <button type="submit" class="px-4 py-2 bg-hotel-primary text-white rounded-lg hover:bg-hotel-secondary text-sm font-semibold transition-colors shadow-sm">Save Item</button>
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
        if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit mr-2 text-hotel-accent"></i> Edit Inventory Item';
        modal.querySelector('#item-id').value = item.id;
        modal.querySelector('#item-prev-stock').value = item.stock ?? 0;
        modal.querySelector('#item-prev-price').value = item.price ?? 0;
        modal.querySelector('#item-name').value = item.name;
        modal.querySelector('#item-category').value = item.category;
        modal.querySelector('#item-unit').value = item.unit || 'Each';
        modal.querySelector('#item-package-size').value = item.packageSize || 1;
        modal.querySelector('#item-stock').value = item.stock;
        modal.querySelector('#item-min').value = item.min;
        modal.querySelector('#item-price').value = item.price || 0;
    } else {
        if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-box-open mr-2 text-hotel-accent"></i> Add New Inventory Item';
        modal.querySelector('#item-id').value = '';
        modal.querySelector('#item-prev-stock').value = 0;
        modal.querySelector('#item-prev-price').value = 0;
        modal.querySelector('#item-unit').value = 'Each';
        modal.querySelector('#item-package-size').value = 1;
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
// Modals — Receive Goods / Fill Store (Stock In)
// ============================================================================

export function showReceiveModal(item = null) {
    const modal = document.getElementById('receive-modal');
    if (!modal) return;

    const items = state.inventoryItemsCache || [];
    const itemSelectHtml = item ? `
        <input type="hidden" id="receive-item-id" value="${item.id}">
        <input type="hidden" id="receive-item-name" value="${item.name}">
        <input type="hidden" id="receive-item-category" value="${item.category || 'General'}">
        <input type="hidden" id="receive-current-stock" value="${item.stock}">
        <div class="bg-emerald-50 dark:bg-emerald-900/30 p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-800 flex justify-between items-center">
            <div>
                <div class="font-bold text-gray-900 dark:text-gray-100">${item.name}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">Category: ${item.category}</div>
            </div>
            <div class="text-right">
                <div class="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase">Current Stock</div>
                <div class="text-xl font-extrabold text-emerald-800 dark:text-emerald-200">${item.stock}</div>
            </div>
        </div>
    ` : `
        <div>
            <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Select Item to Stock In</label>
            <select id="receive-item-select" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
                <option value="">-- Choose item from inventory --</option>
                ${items.map(i => `<option value="${i.id}" data-stock="${i.stock}" data-name="${i.name}" data-category="${i.category}" data-price="${i.price || 0}">${i.name} (Current: ${i.stock})</option>`).join('')}
            </select>
        </div>
        <div id="receive-selected-info" class="hidden bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 flex justify-between items-center">
            <div>
                <div id="receive-selected-name" class="font-bold text-gray-900 dark:text-gray-100"></div>
                <div id="receive-selected-category" class="text-xs text-gray-500 dark:text-gray-400"></div>
            </div>
            <div class="text-right">
                <div class="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase">Current Stock</div>
                <div id="receive-selected-stock" class="text-xl font-extrabold text-emerald-800 dark:text-emerald-200">0</div>
            </div>
        </div>
        <input type="hidden" id="receive-item-id" value="">
        <input type="hidden" id="receive-item-name" value="">
        <input type="hidden" id="receive-item-category" value="">
        <input type="hidden" id="receive-current-stock" value="0">
    `;

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md transition-colors duration-300 overflow-hidden mx-4">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-arrow-circle-down mr-2 text-emerald-600"></i> Receive Goods / Fill Store
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Record incoming vendor deliveries and increase store inventory.</p>
                </div>
                <button id="close-receive-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="receive-stock-form" class="p-6 space-y-4">
                ${itemSelectHtml}

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Quantity Received</label>
                        <input type="number" id="receive-quantity" min="1" placeholder="e.g. 50" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Unit Price (Birr)</label>
                        <input type="number" step="0.01" min="0" id="receive-price" value="${item ? (item.price || '') : ''}" placeholder="e.g. 250" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Supplier / Vendor Name</label>
                    <input type="text" id="receive-supplier" placeholder="e.g. BGI Ethiopia, Ambassel, Local Market..." class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors" required>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Delivery Note / Invoice / PO #</label>
                    <input type="text" id="receive-invoice" placeholder="e.g. INV-2024-889, DN-104..." class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">Notes / Storage Location</label>
                    <input type="text" id="receive-notes" placeholder="e.g. Main Dry Store Shelf 4, Cold Room..." class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                </div>

                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" id="cancel-receive-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-md transition-colors shadow">Confirm Stock In</button>
                </div>
            </form>
        </div>
    `;

    // Hook up dropdown selection if no pre-selected item
    const select = document.getElementById('receive-item-select');
    if (select) {
        select.addEventListener('change', () => {
            const opt = select.options[select.selectedIndex];
            const infoBox = document.getElementById('receive-selected-info');
            if (select.value && opt) {
                document.getElementById('receive-item-id').value = select.value;
                document.getElementById('receive-item-name').value = opt.dataset.name;
                document.getElementById('receive-item-category').value = opt.dataset.category;
                document.getElementById('receive-current-stock').value = opt.dataset.stock;
                document.getElementById('receive-selected-name').textContent = opt.dataset.name;
                document.getElementById('receive-selected-category').textContent = `Category: ${opt.dataset.category}`;
                document.getElementById('receive-selected-stock').textContent = opt.dataset.stock;
                const priceInput = document.getElementById('receive-price');
                if (priceInput && (!priceInput.value || priceInput.value == '0')) {
                    priceInput.value = opt.dataset.price;
                }
                if (infoBox) infoBox.classList.remove('hidden');
            } else {
                if (infoBox) infoBox.classList.add('hidden');
            }
        });
    }

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-receive-modal-btn').addEventListener('click', hideReceiveModal);
    document.getElementById('cancel-receive-modal-btn').addEventListener('click', hideReceiveModal);
}

export function hideReceiveModal() {
    const modal = document.getElementById('receive-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// ============================================================================
// Modals — Flow A: Issue Requisition (Stock Decreases)
// ============================================================================

/**
 * Robustly matches an inventory item by ID, normalized name, or fuzzy inclusion.
 */
export function findInventoryItem(reqItem) {
    if (!reqItem) return null;
    const cache = state.inventoryItemsCache || [];
    if (reqItem.itemId || reqItem.id) {
        const byId = cache.find(i => i.id === (reqItem.itemId || reqItem.id));
        if (byId) return byId;
    }
    const norm = (str) => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const target = norm(reqItem.name);
    if (!target) return null;
    const exact = cache.find(i => norm(i.name) === target);
    if (exact) return exact;
    return cache.find(i => {
        const iname = norm(i.name);
        return iname.includes(target) || target.includes(iname);
    }) || null;
}

export function showIssueRequisitionModal(req) {
    const modal = document.getElementById('issue-requisition-modal');
    if (!modal) return;

    let totalIssuableAcrossAll = 0;

    const itemsRowsHtml = (req.items || []).map((item, idx) => {
        const invItem = findInventoryItem(item);
        const currentStock = invItem ? Number(invItem.stock || 0) : 0;
        const requestedQty = Number(item.quantity || 0);
        const issuedQty = Number(item.issuedQuantity || 0);
        const remainingQty = Math.max(0, requestedQty - issuedQty);

        // Conversion factor from requested unit to base inventory unit
        const conversionFactor = Number(item.conversionFactor) || (invItem ? getUnitConversionFactor(item.unit, invItem.unit, invItem.packageSize) : 1);
        const rawAvailable = conversionFactor > 0 ? (currentStock / conversionFactor) : currentStock;
        const availableInRequestedUnit = rawAvailable >= 1
            ? Math.floor(rawAvailable)
            : (rawAvailable > 0 ? Number(rawAvailable.toFixed(2)) : 0);

        let maxIssuable = 0;
        let isOutOfStock = false;
        let isAlreadyFulfilled = false;

        if (remainingQty <= 0) {
            isAlreadyFulfilled = true;
        } else if (currentStock <= 0) {
            isOutOfStock = true;
        } else {
            maxIssuable = Math.min(remainingQty, availableInRequestedUnit);
            totalIssuableAcrossAll += maxIssuable;
        }

        const defaultIssue = maxIssuable > 0 ? maxIssuable : 0;
        const isStockLow = availableInRequestedUnit < remainingQty;
        const packageHint = conversionFactor !== 1 ? `<div class="text-[10px] text-blue-600 dark:text-blue-400 font-medium">1 ${item.unit} = ${conversionFactor} ${invItem?.unit || item.baseUnit || 'units'}</div>` : '';

        // Status badge
        let stockBadge = '';
        if (!invItem) {
            stockBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"><i class="fas fa-exclamation-triangle mr-1"></i> Not in catalog</span>`;
        } else if (isOutOfStock) {
            stockBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"><i class="fas fa-times-circle mr-1"></i> Out of Stock (0 ${invItem.unit || ''})</span>`;
        } else {
            stockBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${isStockLow ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'}">
                ${currentStock} ${invItem.unit || 'in store'}
            </span>`;
        }

        // Input control
        let inputHtml = '';
        if (isAlreadyFulfilled) {
            inputHtml = `
                <div class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center justify-end">
                    <i class="fas fa-check-double mr-1"></i> Fulfilled
                </div>
                <input type="hidden" class="issue-qty-input" data-index="${idx}" data-max="0" value="0">
            `;
        } else if (isOutOfStock || !invItem || maxIssuable <= 0) {
            inputHtml = `
                <div class="flex flex-col items-end">
                    <input type="number"
                        class="issue-qty-input w-24 p-1.5 text-sm font-bold border border-gray-200 dark:border-gray-700 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-center cursor-not-allowed"
                        data-index="${idx}"
                        data-max="0"
                        min="0"
                        value="0"
                        disabled>
                    <span class="text-[10px] text-red-500 font-medium mt-0.5"><i class="fas fa-ban mr-0.5"></i> 0 available</span>
                </div>
            `;
        } else {
            inputHtml = `
                <div class="flex flex-col items-end">
                    <input type="number"
                        step="any"
                        class="issue-qty-input w-24 p-1.5 text-sm font-bold border-2 border-blue-400 dark:border-blue-500 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"
                        data-index="${idx}"
                        data-max="${maxIssuable}"
                        min="0"
                        max="${maxIssuable}"
                        value="${defaultIssue}">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Max: ${maxIssuable} ${item.unit || ''}</span>
                </div>
            `;
        }

        return `
            <tr class="border-b border-gray-150 dark:border-gray-700/60 hover:bg-gray-50/50 dark:hover:bg-gray-755">
                <td class="py-3 px-3">
                    <div class="font-medium text-gray-900 dark:text-gray-100">${item.name}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">${item.unit || 'Units'}</div>
                    ${packageHint}
                </td>
                <td class="py-3 px-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                    ${requestedQty}
                    ${conversionFactor !== 1 ? `<div class="text-[10px] text-gray-400">(${requestedQty * conversionFactor} ${invItem?.unit || 'base'})</div>` : ''}
                </td>
                <td class="py-3 px-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    ${issuedQty}
                </td>
                <td class="py-3 px-3 text-center font-bold text-amber-600 dark:text-amber-400">
                    ${remainingQty}
                </td>
                <td class="py-3 px-3 text-center">
                    ${stockBadge}
                    ${conversionFactor !== 1 && currentStock > 0 ? `<div class="text-[10px] text-gray-500 mt-0.5">(${availableInRequestedUnit} ${item.unit} issuable)</div>` : ''}
                </td>
                <td class="py-3 px-3 text-right">
                    ${inputHtml}
                </td>
            </tr>
        `;
    }).join('');

    const noStockAlertHtml = totalIssuableAcrossAll <= 0 ? `
        <div class="p-3.5 bg-amber-50 dark:bg-amber-950/40 rounded-lg border-2 border-amber-300 dark:border-amber-700 text-xs text-amber-900 dark:text-amber-200 flex items-start space-x-2.5">
            <i class="fas fa-exclamation-triangle text-amber-600 dark:text-amber-400 text-base mt-0.5 shrink-0"></i>
            <div class="flex-1">
                <p class="font-bold text-sm text-amber-800 dark:text-amber-300">Cannot Issue Items: Store Stock Is 0</p>
                <p class="mt-0.5">All requested items on this requisition are currently <strong>out of stock in the store (0 available)</strong> or already fulfilled. Store levels must be restocked before issuance.</p>
                <p class="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <strong>Next Steps:</strong> Restock via a <strong>Purchase Order (Restock Store)</strong> or use <strong>Auto-Baseline Opening Stock</strong> in Inventory Reconciliation.
                </p>
            </div>
        </div>
    ` : '';

    const submitBtnHtml = totalIssuableAcrossAll <= 0 ? `
        <button type="button" id="issue-req-goto-inventory-btn" class="px-4 py-2 border border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-sm font-semibold rounded-md transition-colors mr-2">
            <i class="fas fa-boxes mr-1.5"></i> Go to Inventory / Restock
        </button>
        <button type="submit" disabled class="px-5 py-2 bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white text-sm font-semibold rounded-md shadow flex items-center">
            <i class="fas fa-ban mr-1.5"></i> Cannot Issue (0 Stock)
        </button>
    ` : `
        <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md transition-colors shadow flex items-center">
            <i class="fas fa-hand-holding-box mr-1.5"></i> Confirm Stock Issue
        </button>
    `;

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl transition-colors duration-300 overflow-hidden mx-4 max-h-[90vh] flex flex-col">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-hand-holding-box mr-2 text-blue-600"></i> Issue Requisition to Department
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Dispense approved stock from store to department. Store stock will decrease.</p>
                </div>
                <button id="close-issue-requisition-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="issue-requisition-form" class="p-6 space-y-4 overflow-y-auto flex-1">
                <input type="hidden" id="issue-req-id" value="${req.id}">

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-blue-50/60 dark:bg-blue-950/20 p-3.5 rounded-lg border border-blue-200/60 dark:border-blue-900/40 text-xs">
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Requisition #:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200">#${req.id.substring(0, 8)}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Department:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200">${req.department}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Requested By:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200 truncate block" title="${req.createdByEmail || ''}">${req.createdByEmail || 'N/A'}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Priority:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200">${req.priority}</span>
                    </div>
                </div>

                ${noStockAlertHtml}

                <div>
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            Requested Items & Quantities to Issue
                        </label>
                        ${totalIssuableAcrossAll > 0 ? `
                        <button type="button" id="issue-req-fill-max-btn" class="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 font-semibold underline">
                            Issue All Available
                        </button>
                        ` : ''}
                    </div>
                    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-50 dark:bg-gray-750 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                    <th class="py-2 px-3 text-left">Item</th>
                                    <th class="py-2 px-3 text-center">Requested</th>
                                    <th class="py-2 px-3 text-center">Issued</th>
                                    <th class="py-2 px-3 text-center">Remaining</th>
                                    <th class="py-2 px-3 text-center">In Store</th>
                                    <th class="py-2 px-3 text-right">Issue Now</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-150 dark:divide-gray-700/60 bg-white dark:bg-gray-800">
                                ${itemsRowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                            Issued To (Staff Member Name) *
                        </label>
                        <input type="text" id="issue-req-recipient" placeholder="e.g. Abebe (Sous Chef), Kitchen staff" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-blue-500 focus:border-blue-500 transition-colors" required>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                            Issue Notes / Delivery Location
                        </label>
                        <input type="text" id="issue-req-notes" placeholder="e.g. Delivered directly to pastry pantry" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-blue-500 focus:border-blue-500 transition-colors">
                    </div>
                </div>

                <div class="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-start space-x-2">
                    <i class="fas fa-info-circle mt-0.5"></i>
                    <div>
                        <strong>Storekeeper Action:</strong> Confirming issuance decrements inventory store levels and logs an immutable Stock Movement audit entry. If quantities remain unfulfilled, the requisition stays open as <em>Partially Issued</em>.
                    </div>
                </div>

                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700 items-center">
                    <button type="button" id="cancel-issue-requisition-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    ${submitBtnHtml}
                </div>
            </form>
        </div>
    `;

    // Hook up Fill Max button
    const fillMaxBtn = document.getElementById('issue-req-fill-max-btn');
    if (fillMaxBtn) {
        fillMaxBtn.addEventListener('click', () => {
            modal.querySelectorAll('.issue-qty-input:not([disabled])').forEach(input => {
                const max = parseFloat(input.dataset.max) || 0;
                if (max > 0) {
                    input.value = max;
                }
            });
        });
    }

    // Hook up Go to Inventory button if present
    const gotoInvBtn = document.getElementById('issue-req-goto-inventory-btn');
    if (gotoInvBtn) {
        gotoInvBtn.addEventListener('click', () => {
            hideIssueRequisitionModal();
            showSection('inventory');
        });
    }

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-issue-requisition-modal-btn').addEventListener('click', hideIssueRequisitionModal);
    document.getElementById('cancel-issue-requisition-modal-btn').addEventListener('click', hideIssueRequisitionModal);
}

export function hideIssueRequisitionModal() {
    const modal = document.getElementById('issue-requisition-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// Modals — Flow B: Mark PO as Ordered (Purchasing Action — NO stock edit)
// ============================================================================

export function showOrderPOModal(req) {
    const modal = document.getElementById('order-po-modal');
    if (!modal) return;

    const itemsSummary = (req.items || []).map(i =>
        `<li class="flex justify-between text-xs py-1 border-b border-gray-100 dark:border-gray-700">
            <span class="font-medium text-gray-800 dark:text-gray-200">${i.name} (${i.quantity} ${i.unit || ''})</span>
            <span class="text-gray-600 dark:text-gray-400">Birr ${((i.price || 0) * (i.quantity || 1)).toFixed(2)}</span>
        </li>`
    ).join('');

    const d = new Date();
    d.setDate(d.getDate() + 3);
    const defaultDateStr = d.toISOString().split('T')[0];

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg transition-colors duration-300 overflow-hidden mx-4">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-shopping-cart mr-2 text-purple-600"></i> Place Purchase Order with Vendor
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Purchasing team order commitment. Does NOT edit inventory stock.</p>
                </div>
                <button id="close-order-po-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="order-po-form" class="p-6 space-y-4">
                <input type="hidden" id="order-po-id" value="${req.id}">

                <div class="bg-purple-50/60 dark:bg-purple-950/20 p-3.5 rounded-lg border border-purple-200/60 dark:border-purple-900/40 text-xs">
                    <div class="flex justify-between mb-1.5">
                        <span class="font-semibold text-gray-700 dark:text-gray-300">Purchase Order: #${req.id.substring(0, 8)}</span>
                        <span class="font-bold text-purple-700 dark:text-purple-300">Total: Birr ${(req.totalCost || 0).toFixed(2)}</span>
                    </div>
                    <ul class="max-h-28 overflow-y-auto">
                        ${itemsSummary}
                    </ul>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                        Supplier / Vendor Name *
                    </label>
                    <input type="text" id="order-po-supplier" placeholder="e.g. Bole Wholesale Food Trading PLC, Ambassel..." value="${req.supplier || ''}" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-purple-500 focus:border-purple-500 transition-colors" required>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                            Supplier Order / Quote #
                        </label>
                        <input type="text" id="order-po-ref" placeholder="e.g. QT-2026-90" value="${req.orderRef || ''}" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-purple-500 focus:border-purple-500 transition-colors">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                            Expected Delivery Date *
                        </label>
                        <input type="date" id="order-po-delivery-date" value="${req.expectedDeliveryDate || defaultDateStr}" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-purple-500 focus:border-purple-500 transition-colors" required>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                        Purchasing Notes & Terms
                    </label>
                    <textarea id="order-po-notes" rows="2" placeholder="e.g. Net 30 payment, free delivery to hotel loading dock..." class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-purple-500 focus:border-purple-500 transition-colors">${req.purchasingNotes || ''}</textarea>
                </div>

                <div class="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200 flex items-start space-x-2">
                    <i class="fas fa-shield-alt mt-0.5"></i>
                    <div>
                        <strong>Purchasing Separation of Duty:</strong> Marking as <em>Ordered</em> commits the order to the vendor. Hotel inventory is <strong>NOT</strong> increased at this step. Only the Storekeeper adds stock when goods are physically received and inspected.
                    </div>
                </div>

                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" id="cancel-order-po-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button type="submit" class="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-md transition-colors shadow">Mark as Ordered</button>
                </div>
            </form>
        </div>
    `;

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-order-po-modal-btn').addEventListener('click', hideOrderPOModal);
    document.getElementById('cancel-order-po-modal-btn').addEventListener('click', hideOrderPOModal);
}

export function hideOrderPOModal() {
    const modal = document.getElementById('order-po-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// Modals — Flow B: Receive PO Goods into Store (Storekeeper Action — Stock INCREASES)
// ============================================================================

export function showReceiveGoodsModal(req) {
    const modal = document.getElementById('receive-goods-modal');
    if (!modal) return;

    const itemsRowsHtml = (req.items || []).map((item, idx) => {
        const orderedQty = Number(item.quantity || 0);
        const receivedQty = Number(item.receivedQuantity || 0);
        const remainingQty = Math.max(0, orderedQty - receivedQty);
        const currentPrice = Number(item.price || 0);
        const conversionFactor = Number(item.conversionFactor) || (DEFAULT_UNIT_MULTIPLIERS[item.unit] || 1);
        const packageNote = conversionFactor !== 1
            ? `<div class="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">1 ${item.unit} = ${conversionFactor} ${item.baseUnit || 'units'}</div>`
            : '';
        const baseCostNote = conversionFactor !== 1 && currentPrice > 0
            ? `<div class="text-[10px] text-gray-400 text-right mt-0.5">≈ ${(currentPrice / conversionFactor).toFixed(2)} Birr / ${item.baseUnit || 'unit'}</div>`
            : '';

        return `
            <tr class="border-b border-gray-150 dark:border-gray-700/60 hover:bg-gray-50/50 dark:hover:bg-gray-755">
                <td class="py-3 px-3">
                    <div class="font-medium text-gray-900 dark:text-gray-100">${item.name}</div>
                    <div class="text-xs text-gray-500 dark:text-gray-400">${item.unit || 'Units'}</div>
                    ${packageNote}
                </td>
                <td class="py-3 px-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                    ${orderedQty}
                    ${conversionFactor !== 1 ? `<div class="text-[10px] text-gray-400">(${orderedQty * conversionFactor} base)</div>` : ''}
                </td>
                <td class="py-3 px-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    ${receivedQty}
                </td>
                <td class="py-3 px-3 text-center font-bold text-amber-600 dark:text-amber-400">
                    ${remainingQty}
                </td>
                <td class="py-3 px-3 text-center">
                    <input type="number"
                        class="receive-goods-qty-input w-24 p-1.5 text-sm font-bold border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center focus:ring-emerald-500 focus:border-emerald-500"
                        data-index="${idx}"
                        data-remaining="${remainingQty}"
                        min="0"
                        max="${remainingQty}"
                        value="${remainingQty}">
                </td>
                <td class="py-3 px-3 text-right">
                    <input type="number"
                        step="0.01"
                        class="receive-goods-price-input w-28 p-1.5 text-sm font-semibold border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-right focus:ring-emerald-500 focus:border-emerald-500"
                        data-index="${idx}"
                        min="0"
                        value="${currentPrice.toFixed(2)}">
                    ${baseCostNote}
                </td>
            </tr>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl transition-colors duration-300 overflow-hidden mx-4 max-h-[90vh] flex flex-col">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-truck-loading mr-2 text-emerald-600"></i> Receive Goods into Store
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Inspect vendor shipment and stock into hotel warehouse. Stock will INCREASE.</p>
                </div>
                <button id="close-receive-goods-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <form id="receive-goods-form" class="p-6 space-y-4 overflow-y-auto flex-1">
                <input type="hidden" id="receive-goods-po-id" value="${req.id}">

                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-emerald-50/60 dark:bg-emerald-950/20 p-3.5 rounded-lg border border-emerald-200/60 dark:border-emerald-900/40 text-xs">
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Purchase Order:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200">#${req.id.substring(0, 8)}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Supplier:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200 truncate block" title="${req.supplier || 'Vendor'}">${req.supplier || 'N/A'}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Supplier Ref:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200">${req.orderRef || 'N/A'}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Expected Date:</span>
                        <span class="font-bold text-gray-800 dark:text-gray-200">${req.expectedDeliveryDate || 'N/A'}</span>
                    </div>
                </div>

                <div>
                    <div class="flex justify-between items-center mb-2">
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            Shipment Line Items (Actual Delivered & Price)
                        </label>
                        <button type="button" id="receive-goods-fill-remaining-btn" class="text-xs text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 font-semibold underline">
                            Receive All Remaining
                        </button>
                    </div>
                    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                        <table class="min-w-full text-sm">
                            <thead class="bg-gray-50 dark:bg-gray-750 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                    <th class="py-2 px-3 text-left">Item</th>
                                    <th class="py-2 px-3 text-center">Ordered</th>
                                    <th class="py-2 px-3 text-center">Received</th>
                                    <th class="py-2 px-3 text-center">Remaining</th>
                                    <th class="py-2 px-3 text-center">Qty Received</th>
                                    <th class="py-2 px-3 text-right">Actual Price</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-150 dark:divide-gray-700/60 bg-white dark:bg-gray-800">
                                ${itemsRowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                            Delivery Note / Supplier Invoice #
                        </label>
                        <input type="text" id="receive-goods-invoice" placeholder="e.g. INV-9024 or DN-331" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
                            Storekeeper Inspection / Storage Notes
                        </label>
                        <input type="text" id="receive-goods-notes" placeholder="e.g. Inspected, standard condition, placed on Shelf A" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-emerald-500 focus:border-emerald-500 transition-colors">
                    </div>
                </div>

                <div class="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-start space-x-2">
                    <i class="fas fa-boxes mt-0.5"></i>
                    <div>
                        <strong>Storekeeper Action:</strong> Confirming receipt immediately increments store stock levels and recalculates the weighted average cost. If partial delivery, the PO remains open as <em>Partially Received</em>.
                    </div>
                </div>

                <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <button type="button" id="cancel-receive-goods-modal-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Cancel</button>
                    <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-md transition-colors shadow">Confirm Goods Receipt</button>
                </div>
            </form>
        </div>
    `;

    // Hook up Fill Remaining button
    const fillRemBtn = document.getElementById('receive-goods-fill-remaining-btn');
    if (fillRemBtn) {
        fillRemBtn.addEventListener('click', () => {
            modal.querySelectorAll('.receive-goods-qty-input').forEach(input => {
                input.value = input.dataset.remaining || 0;
            });
        });
    }

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-receive-goods-modal-btn').addEventListener('click', hideReceiveGoodsModal);
    document.getElementById('cancel-receive-goods-modal-btn').addEventListener('click', hideReceiveGoodsModal);
}

export function hideReceiveGoodsModal() {
    const modal = document.getElementById('receive-goods-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================================
// Modals — Stock Movements / Audit History
// ============================================================================

export function showStockLogModal(filterItem = null) {
    const modal = document.getElementById('stock-log-modal');
    if (!modal) return;

    // Guard against DOM Event objects being passed if called directly as event listener
    const isValidItem = filterItem &&
        typeof filterItem === 'object' &&
        !(filterItem instanceof Event) &&
        (typeof filterItem.name === 'string' || typeof filterItem.id === 'string');

    const item = isValidItem ? filterItem : null;
    const isFiltered = !!item;
    const itemName = item?.name || '';
    const title = isFiltered ? `Audit Trail: ${itemName}` : `Stock Movement & Usage Audit Trail`;
    const subtitle = isFiltered
        ? `Movement and adjustment history for <strong>${itemName}</strong> (Category: ${item.category || 'General'} | Current Stock: <strong>${item.stock ?? 0} ${item.unit || ''}</strong>).`
        : `Real-time log of all items received (Stock In), issued to departments (Stock Out), and inventory recount adjustments.`;

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl transition-colors duration-300 overflow-hidden mx-4 max-h-[90vh] flex flex-col">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div>
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center">
                        <i class="fas fa-history mr-2 ${isFiltered ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}"></i> ${title}
                    </h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${subtitle}</p>
                </div>
                <button id="close-stock-log-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close modal">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="p-4 overflow-y-auto flex-1">
                <div id="stock-movements-table-container"></div>
            </div>
            <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 flex justify-between items-center">
                <div>
                    ${isFiltered ? `
                        <button type="button" id="show-all-movements-btn" class="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 font-semibold flex items-center">
                            <i class="fas fa-list-ul mr-1.5"></i> View Complete Store Movement Log
                        </button>
                    ` : ''}
                </div>
                <button type="button" id="close-stock-log-btn-bottom" class="px-5 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-md transition-colors shadow">Close</button>
            </div>
        </div>
    `;

    const allMovements = state.stockMovementsCache || [];
    let movementsToDisplay = allMovements;
    if (isFiltered) {
        const filterId = item.id;
        const filterLcName = (item.name || '').trim().toLowerCase();
        movementsToDisplay = allMovements.filter(m => {
            const matchesId = filterId && m.itemId === filterId;
            const matchesName = filterLcName && m.itemName && m.itemName.trim().toLowerCase() === filterLcName;
            return matchesId || matchesName;
        });
    }

    renderStockMovements(movementsToDisplay);

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    modal.classList.add('opacity-100');
    document.getElementById('close-stock-log-btn').addEventListener('click', hideStockLogModal);
    document.getElementById('close-stock-log-btn-bottom').addEventListener('click', hideStockLogModal);

    const showAllBtn = document.getElementById('show-all-movements-btn');
    if (showAllBtn) {
        showAllBtn.addEventListener('click', () => {
            showStockLogModal(null);
        });
    }
}

export function hideStockLogModal() {
    const modal = document.getElementById('stock-log-modal');
    if (!modal) return;
    modal.classList.remove('opacity-100');
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
    const isPO = req.requestType === 'purchase' || req.requestType === 'Purchase Order' || req.department === 'Store' || req.department === 'Purchasing' || req.isRestockOrder === true;

    const typeBadge = isPO
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700"><i class="fas fa-truck-loading mr-1"></i>Purchase Order (Stock In)</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border border-blue-300 dark:border-blue-700"><i class="fas fa-hand-holding-box mr-1"></i>Department Requisition (Stock Out)</span>';

    const itemsRows = (req.items || []).map(i => {
        const progressText = isPO
            ? `Received: ${i.receivedQuantity || 0} / ${i.quantity}`
            : `Issued: ${i.issuedQuantity || 0} / ${i.quantity}`;
        return `
            <tr class="border-b border-gray-150 dark:border-gray-700/60 text-xs">
                <td class="py-2 px-3 font-medium text-gray-900 dark:text-gray-100">${i.name}</td>
                <td class="py-2 px-3 text-center text-gray-700 dark:text-gray-300">${i.quantity} ${i.unit || ''}</td>
                <td class="py-2 px-3 text-right text-gray-600 dark:text-gray-400">Birr ${(i.price || 0).toFixed(2)}</td>
                <td class="py-2 px-3 text-right font-semibold text-gray-800 dark:text-gray-200">Birr ${((i.price || 0) * (i.quantity || 1)).toFixed(2)}</td>
                <td class="py-2 px-3 text-center font-semibold text-slate-700 dark:text-slate-300">${progressText}</td>
            </tr>
        `;
    }).join('');

    let actionBtnHtml = '';
    if (!isPO && (req.status === 'Approved' || req.status === 'Partially Issued') && hasPermission(state.userRole, 'manage_inventory')) {
        actionBtnHtml = `<button type="button" class="modal-detail-action-issue-btn px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-semibold transition-colors shadow flex items-center" data-id="${req.id}"><i class="fas fa-hand-holding-box mr-1.5"></i>Issue Items</button>`;
    } else if (isPO && req.status === 'Approved' && (state.userRole === 'Purchasing' || state.userRole === 'System Administrator' || hasPermission(state.userRole, 'create_request'))) {
        actionBtnHtml = `<button type="button" class="modal-detail-action-order-btn px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-semibold transition-colors shadow flex items-center" data-id="${req.id}"><i class="fas fa-shopping-cart mr-1.5"></i>Place Order</button>`;
    } else if (isPO && (req.status === 'Ordered' || req.status === 'Partially Received') && hasPermission(state.userRole, 'manage_inventory')) {
        actionBtnHtml = `<button type="button" class="modal-detail-action-receive-btn px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-semibold transition-colors shadow flex items-center" data-id="${req.id}"><i class="fas fa-truck-loading mr-1.5"></i>Receive Goods into Store</button>`;
    }

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl transition-colors duration-300 relative overflow-hidden mx-4 max-h-[90vh] flex flex-col">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div class="flex items-center space-x-2">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-gray-100">Request #${req.id.substring(0, 8)}</h3>
                    ${typeBadge}
                </div>
                <button id="close-request-details-modal-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" aria-label="Close details modal"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-6 space-y-4 overflow-y-auto flex-1">
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 dark:bg-gray-750 p-3.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Department</span>
                        <span class="font-bold text-gray-900 dark:text-gray-100">${req.department}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Status</span>
                        <div class="mt-0.5">${getStatusBadge(req.status)}</div>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Priority</span>
                        <span class="font-bold text-gray-900 dark:text-gray-100">${req.priority}</span>
                    </div>
                    <div>
                        <span class="text-gray-500 dark:text-gray-400 block">Total Estimated</span>
                        <span class="font-extrabold text-gray-900 dark:text-gray-100">Birr ${(req.totalCost || 0).toFixed(2)}</span>
                    </div>
                </div>

                <div class="text-xs space-y-1 text-gray-600 dark:text-gray-300">
                    <div><span class="font-semibold text-gray-800 dark:text-gray-200">Requested By:</span> ${req.createdByEmail || 'N/A'}</div>
                    <div><span class="font-semibold text-gray-800 dark:text-gray-200">Required By Date:</span> ${req.requiredBy || 'N/A'}</div>
                    ${req.createdAt?.toDate ? `<div><span class="font-semibold text-gray-800 dark:text-gray-200">Created:</span> ${req.createdAt.toDate().toLocaleString()}</div>` : ''}
                    <div><span class="font-semibold text-gray-800 dark:text-gray-200">Notes:</span> ${req.notes || 'None'}</div>
                </div>

                ${isPO && (req.supplier || req.expectedDeliveryDate) ? `
                    <div class="bg-purple-50/70 dark:bg-purple-950/20 p-3 rounded-lg border border-purple-200/60 dark:border-purple-900/40 text-xs space-y-1">
                        <div class="font-bold text-purple-900 dark:text-purple-300">Vendor Purchase Details:</div>
                        <div><span class="font-semibold">Supplier:</span> ${req.supplier || 'N/A'}</div>
                        <div><span class="font-semibold">Order / Quote Ref:</span> ${req.orderRef || 'N/A'}</div>
                        <div><span class="font-semibold">Expected Delivery:</span> ${req.expectedDeliveryDate || 'N/A'}</div>
                        ${req.purchasingNotes ? `<div><span class="font-semibold">Purchasing Notes:</span> ${req.purchasingNotes}</div>` : ''}
                    </div>
                ` : ''}

                ${req.approvalNotes ? `
                    <div class="bg-blue-50/70 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200/60 dark:border-blue-900/40 text-xs">
                        <span class="font-bold text-blue-900 dark:text-blue-300">GM Approval Notes:</span>
                        <p class="text-gray-700 dark:text-gray-300 mt-0.5">${req.approvalNotes}</p>
                    </div>
                ` : ''}

                <div>
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-2">Item Breakdown</h4>
                    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                        <table class="min-w-full text-xs">
                            <thead class="bg-gray-50 dark:bg-gray-750 text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                                <tr>
                                    <th class="py-2 px-3 text-left">Item</th>
                                    <th class="py-2 px-3 text-center">Qty</th>
                                    <th class="py-2 px-3 text-right">Unit Price</th>
                                    <th class="py-2 px-3 text-right">Total</th>
                                    <th class="py-2 px-3 text-center">Fulfillment</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-150 dark:divide-gray-700/60 bg-white dark:bg-gray-800">
                                ${itemsRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 flex justify-between items-center">
                <button type="button" id="footer-close-details-btn" class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">Close</button>
                ${actionBtnHtml}
            </div>
        </div>
    `;

    modal.classList.remove('hidden', 'opacity-0', 'invisible');
    document.getElementById('close-request-details-modal-btn').addEventListener('click', hideRequestDetailsModal);
    const footerClose = document.getElementById('footer-close-details-btn');
    if (footerClose) footerClose.addEventListener('click', hideRequestDetailsModal);

    // Contextual button listeners inside details modal
    const issueBtn = modal.querySelector('.modal-detail-action-issue-btn');
    if (issueBtn) {
        issueBtn.addEventListener('click', () => {
            hideRequestDetailsModal();
            showIssueRequisitionModal(req);
        });
    }
    const orderBtn = modal.querySelector('.modal-detail-action-order-btn');
    if (orderBtn) {
        orderBtn.addEventListener('click', () => {
            hideRequestDetailsModal();
            showOrderPOModal(req);
        });
    }
    const recvBtn = modal.querySelector('.modal-detail-action-receive-btn');
    if (recvBtn) {
        recvBtn.addEventListener('click', () => {
            hideRequestDetailsModal();
            showReceiveGoodsModal(req);
        });
    }
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
    itemRow.className = 'item-row grid grid-cols-12 gap-2 md:gap-3 items-start bg-gray-50/50 dark:bg-gray-800/40 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700/50';
    itemRow.dataset.basePrice = "0";
    itemRow.dataset.baseUnit = "Each";
    itemRow.dataset.packageSize = "1";
    itemRow.dataset.conversionFactor = "1";
    itemRow.dataset.inStore = "false";
    itemRow.dataset.storeStock = "0";
    itemRow.innerHTML = `
        <div class="col-span-12 md:col-span-4">
            <label class="block md:hidden text-xs font-semibold text-gray-500 mb-1">Item Name</label>
            <input type="text" class="item-name w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md transition-colors duration-300 text-sm" list="inventory-items-list" placeholder="Search item..." required autocomplete="off">
            <div class="item-stock-hint text-[11px] mt-1 font-medium hidden"></div>
        </div>
        <div class="col-span-6 md:col-span-2">
            <label class="block md:hidden text-xs font-semibold text-gray-500 mb-1">Quantity</label>
            <input type="number" min="1" value="1" class="item-quantity w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md transition-colors duration-300 text-sm text-center" required>
        </div>
        <div class="col-span-6 md:col-span-2">
            <label class="block md:hidden text-xs font-semibold text-gray-500 mb-1">Unit</label>
            <select class="item-unit w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md transition-colors duration-300 text-sm">
                ${UNITS.map(u => `<option value="${u}">${u}</option>`).join('')}
            </select>
            <div class="item-unit-note text-[10px] text-blue-600 dark:text-blue-400 mt-0.5 hidden truncate font-medium"></div>
        </div>
        <div class="col-span-6 md:col-span-2">
            <label class="block md:hidden text-xs font-semibold text-gray-500 mb-1">Unit Price (Birr)</label>
            <input type="number" step="0.01" min="0" value="0.00" class="item-price w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md transition-colors duration-300 text-sm text-right" required>
        </div>
        <div class="col-span-4 md:col-span-1 text-right pt-2">
            <label class="block md:hidden text-xs font-semibold text-gray-500 mb-1">Subtotal</label>
            <span class="item-subtotal block p-1 text-gray-900 dark:text-gray-100 font-semibold text-sm">Birr 0.00</span>
        </div>
        <div class="col-span-2 md:col-span-1 flex justify-center items-center pt-2">
            <button type="button" class="remove-item-btn p-2 text-red-500 hover:text-red-700 transition-colors" title="Remove row" aria-label="Remove item"><i class="fas fa-trash"></i></button>
        </div>
    `;
    container.appendChild(itemRow);
    populateItemNameDatalist();
}

/**
 * Handles typing or selecting an item name from datalist.
 * Synchronizes store inventory data, stock hints, and pricing.
 */
export function handleItemRowNameChange(row) {
    if (!row) return;
    const itemNameInput = row.querySelector('.item-name');
    if (!itemNameInput) return;

    const val = itemNameInput.value.trim();
    const stockHint = row.querySelector('.item-stock-hint');
    const unitSelect = row.querySelector('.item-unit');
    const priceInput = row.querySelector('.item-price');
    const unitNote = row.querySelector('.item-unit-note');

    const reqTypeInput = document.querySelector('input[name="req-type"]:checked');
    const isRequisition = !reqTypeInput || reqTypeInput.value === 'Requisition';

    const invItem = (state.inventoryItemsCache || []).find(
        item => (item.name || '').trim().toLowerCase() === val.toLowerCase()
    );

    if (invItem) {
        row.dataset.inStore = "true";
        row.dataset.storeStock = invItem.stock || 0;
        row.dataset.basePrice = invItem.price || 0;
        row.dataset.baseUnit = invItem.unit || 'Each';
        row.dataset.packageSize = invItem.packageSize || 1;

        if (unitSelect && invItem.unit) {
            unitSelect.value = invItem.unit;
        }

        const factor = getUnitConversionFactor(unitSelect ? unitSelect.value : invItem.unit, invItem.unit, invItem.packageSize);
        row.dataset.conversionFactor = factor;

        if (priceInput) {
            priceInput.value = (Number(invItem.price || 0) * factor).toFixed(2);
        }

        if (unitNote) {
            if (factor !== 1) {
                unitNote.textContent = `1 ${unitSelect.value} = ${factor} ${invItem.unit}`;
                unitNote.classList.remove('hidden');
            } else {
                unitNote.classList.add('hidden');
            }
        }

        if (stockHint) {
            stockHint.classList.remove('hidden');
            const stock = Number(invItem.stock || 0);
            if (stock > 0) {
                stockHint.className = 'item-stock-hint text-[11px] mt-1 font-medium text-emerald-600 dark:text-emerald-400';
                stockHint.innerHTML = `<i class="fas fa-check-circle mr-1"></i> In Store: <strong>${stock} ${invItem.unit || 'units'}</strong> available`;
            } else {
                stockHint.className = 'item-stock-hint text-[11px] mt-1 font-medium text-red-600 dark:text-red-400';
                stockHint.innerHTML = `<i class="fas fa-times-circle mr-1"></i> <span class="font-bold">Out of Stock (0 ${invItem.unit || ''})</span> — Restock via Purchase Order`;
            }
        }
    } else {
        row.dataset.inStore = "false";
        row.dataset.storeStock = "0";
        const currentPrice = parseFloat(priceInput ? priceInput.value : 0) || 0;
        const currentUnit = unitSelect ? unitSelect.value : 'Each';
        row.dataset.basePrice = currentPrice;
        row.dataset.baseUnit = currentUnit;
        row.dataset.packageSize = 1;
        row.dataset.conversionFactor = 1;

        if (unitNote) unitNote.classList.add('hidden');

        if (stockHint) {
            if (!val) {
                stockHint.classList.add('hidden');
                stockHint.innerHTML = '';
            } else if (isRequisition) {
                stockHint.classList.remove('hidden');
                stockHint.className = 'item-stock-hint text-[11px] mt-1 font-medium text-red-600 dark:text-red-400';
                stockHint.innerHTML = `<i class="fas fa-exclamation-triangle mr-1"></i> <span class="font-bold">Not in store inventory.</span> Requisitions require existing stock. (Switch to Purchase Order if ordering new items)`;
            } else {
                stockHint.classList.remove('hidden');
                stockHint.className = 'item-stock-hint text-[11px] mt-1 font-medium text-blue-600 dark:text-blue-400';
                stockHint.innerHTML = `<i class="fas fa-info-circle mr-1"></i> New Item (will be cataloged into store upon delivery receipt)`;
            }
        }
    }

    updateItemSubtotal(row);
}

/**
 * Automatically recalculates unit price when user selects a different unit of measure.
 * e.g., Base unit is Kg (120 Birr), selecting Box or Bag scales price accordingly.
 */
export function handleItemRowUnitChange(row) {
    if (!row) return;
    const unitSelect = row.querySelector('.item-unit');
    const priceInput = row.querySelector('.item-price');
    const unitNote = row.querySelector('.item-unit-note');
    if (!unitSelect || !priceInput) return;

    const selectedUnit = unitSelect.value;
    const baseUnit = row.dataset.baseUnit || selectedUnit;
    const basePrice = parseFloat(row.dataset.basePrice) || 0;
    const packageSize = parseFloat(row.dataset.packageSize) || 1;

    const factor = getUnitConversionFactor(selectedUnit, baseUnit, packageSize);
    row.dataset.conversionFactor = factor;

    if (basePrice > 0) {
        priceInput.value = (basePrice * factor).toFixed(2);
    }

    if (unitNote) {
        if (factor !== 1) {
            unitNote.textContent = `1 ${selectedUnit} = ${factor} ${baseUnit}`;
            unitNote.classList.remove('hidden');
        } else {
            unitNote.classList.add('hidden');
        }
    }

    updateItemSubtotal(row);
}

export function populateItemNameDatalist() {
    const datalist = document.getElementById('inventory-items-list');
    if (datalist) {
        datalist.innerHTML = (state.inventoryItemsCache || []).map(item => {
            const stockInfo = `${item.stock || 0} ${item.unit || ''} in store`;
            const priceInfo = item.price ? ` — Birr ${Number(item.price).toFixed(2)}` : '';
            return `<option value="${item.name}">${stockInfo}${priceInfo}</option>`;
        }).join('');
    }
}

export function updateItemSubtotal(row) {
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const quantity = parseInt(row.querySelector('.item-quantity').value) || 0;
    const subtotal = price * quantity;
    row.querySelector('.item-subtotal').textContent = `Birr ${subtotal.toFixed(2)}`;
    updateTotalCost();
}

export function updateTotalCost() {
    const total = Array.from(document.querySelectorAll('#items-container .item-row')).reduce((acc, row) => {
        const price = parseFloat(row.querySelector('.item-price').value) || 0;
        const quantity = parseInt(row.querySelector('.item-quantity').value) || 0;
        return acc + (price * quantity);
    }, 0);
    document.getElementById('total-cost-display').textContent = `Birr ${total.toFixed(2)}`;
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

    let baseRequests = requests || state.allRequestsCache || [];
    if (!hasPermission(state.userRole, 'view_all_requests')) {
        baseRequests = baseRequests.filter(r => r.createdBy === state.userId);
    }

    const isPO = (req) => {
        if (req.requestType === 'purchase' || req.requestType === 'Purchase Order') return true;
        if (req.requestType === 'requisition' || req.requestType === 'Requisition') return false;
        return req.department === 'Store' || req.department === 'Purchasing' || req.isRestockOrder === true;
    };

    // Update filter counts
    const allCount = baseRequests.length;
    const reqCount = baseRequests.filter(r => !isPO(r)).length;
    const poCount = baseRequests.filter(r => isPO(r)).length;

    const allCountEl = document.getElementById('count-all-requests');
    const reqCountEl = document.getElementById('count-req-requests');
    const poCountEl = document.getElementById('count-po-requests');
    if (allCountEl) allCountEl.textContent = allCount;
    if (reqCountEl) reqCountEl.textContent = reqCount;
    if (poCountEl) poCountEl.textContent = poCount;

    // Filter by active flow
    let displayRequests = baseRequests;
    if (state.requestFlowFilter === 'requisition') {
        displayRequests = displayRequests.filter(r => !isPO(r));
    } else if (state.requestFlowFilter === 'purchase') {
        displayRequests = displayRequests.filter(r => isPO(r));
    }

    if (searchTerm) {
        const lc = searchTerm.toLowerCase();
        displayRequests = displayRequests.filter(req =>
            (req.department && req.department.toLowerCase().includes(lc)) ||
            (req.items && req.items.some(item => item.name && item.name.toLowerCase().includes(lc))) ||
            (req.status && req.status.toLowerCase().includes(lc)) ||
            (req.priority && req.priority.toLowerCase().includes(lc)) ||
            (req.requestType && req.requestType.toLowerCase().includes(lc)) ||
            (req.supplier && req.supplier.toLowerCase().includes(lc)) ||
            (req.orderRef && req.orderRef.toLowerCase().includes(lc)) ||
            (req.createdByEmail && req.createdByEmail.toLowerCase().includes(lc))
        );
    }

    if (displayRequests.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        tableBody.innerHTML = displayRequests.map(req => {
            const po = isPO(req);
            const typeBadge = po
                ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700" title="Vendor Purchase Order (Stock In)"><i class="fas fa-truck-loading mr-1"></i>Purchase</span>'
                : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200 border border-blue-300 dark:border-blue-700" title="Department Requisition (Stock Out)"><i class="fas fa-hand-holding-box mr-1"></i>Requisition</span>';

            const itemsSummary = req.items && req.items.length > 0
                ? `${req.items.map(i => `${i.quantity}x ${i.name}`).slice(0, 2).join(', ')}${req.items.length > 2 ? ` (+${req.items.length - 2})` : ''}`
                : 'No items';

            const viewBtn = `<button class="view-request-btn px-2.5 py-1 bg-hotel-accent hover:bg-blue-600 text-white rounded text-xs transition-colors inline-flex items-center shadow-sm mr-1.5" data-id="${req.id}"><i class="fas fa-eye mr-1"></i>View</button>`;

            let contextualAction = '';
            if (!po) {
                // Flow A: Requisition
                if ((req.status === 'Approved' || req.status === 'Partially Issued')) {
                    if (hasPermission(state.userRole, 'manage_inventory')) {
                        contextualAction = `<button class="issue-req-btn px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors inline-flex items-center shadow-sm" data-id="${req.id}" title="Issue items to department (decreases store stock)"><i class="fas fa-hand-holding-box mr-1"></i>Issue Items</button>`;
                    } else {
                        contextualAction = `<span class="text-xs text-amber-700 dark:text-amber-400 italic">Awaiting Storekeeper</span>`;
                    }
                } else if (req.status === 'Issued') {
                    contextualAction = `<span class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center"><i class="fas fa-check-double mr-1"></i>Issued</span>`;
                }
            } else {
                // Flow B: Purchase Order
                if (req.status === 'Approved') {
                    if (state.userRole === 'Purchasing' || state.userRole === 'System Administrator' || hasPermission(state.userRole, 'create_request')) {
                        contextualAction = `<button class="order-po-btn px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs transition-colors inline-flex items-center shadow-sm" data-id="${req.id}" title="Place order with vendor"><i class="fas fa-shopping-cart mr-1"></i>Place Order</button>`;
                    } else {
                        contextualAction = `<span class="text-xs text-purple-700 dark:text-purple-400 italic">Awaiting Purchasing</span>`;
                    }
                } else if (req.status === 'Ordered' || req.status === 'Partially Received') {
                    if (hasPermission(state.userRole, 'manage_inventory')) {
                        contextualAction = `<button class="receive-po-goods-btn px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs transition-colors inline-flex items-center shadow-sm" data-id="${req.id}" title="Receive goods into store (increases stock)"><i class="fas fa-truck-loading mr-1"></i>Receive Goods</button>`;
                    } else {
                        contextualAction = `<span class="text-xs text-blue-700 dark:text-blue-400 italic">Awaiting Store Goods</span>`;
                    }
                } else if (req.status === 'Received') {
                    contextualAction = `<span class="text-xs font-semibold text-teal-600 dark:text-teal-400 inline-flex items-center"><i class="fas fa-warehouse mr-1"></i>Stocked In</span>`;
                }
            }

            return `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td class="px-4 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">
                        ${req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString() : 'N/A'}
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        ${typeBadge}
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        <div class="font-medium text-gray-900 dark:text-gray-100">${req.department}</div>
                        <div class="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[140px]" title="${req.createdByEmail || ''}">${req.createdByEmail || ''}</div>
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-700 dark:text-gray-300 max-w-[180px] truncate" title="${itemsSummary}">
                        ${itemsSummary}
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap text-xs font-bold text-gray-900 dark:text-gray-100">
                        Birr ${(req.totalCost || 0).toFixed(2)}
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap text-xs">
                        <span class="font-semibold text-gray-700 dark:text-gray-300">${req.priority}</span>
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap">
                        ${getStatusBadge(req.status)}
                    </td>
                    <td class="px-4 py-3 whitespace-nowrap text-xs">
                        <div class="flex items-center">
                            ${viewBtn}
                            ${contextualAction}
                        </div>
                    </td>
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
            const isPO = req.requestType === 'purchase' || req.requestType === 'Purchase Order' || req.department === 'Store' || req.department === 'Purchasing' || req.isRestockOrder === true;

            const typeBanner = isPO
                ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700"><i class="fas fa-truck-loading mr-1"></i>Purchase Order (Vendor Stock In)</span>'
                : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border border-blue-300 dark:border-blue-700"><i class="fas fa-hand-holding-box mr-1"></i>Dept Requisition (Store Stock Out)</span>';

            const itemsList = (req.items || []).map(i => `<li>${i.name} - ${i.quantity} ${i.unit || ''} (@ Birr ${(i.price || 0).toFixed(2)})</li>`).join('');
            const requestedByEmail = state.allUsersCache.find(u => u.id === req.createdBy)?.email || req.createdByEmail || 'N/A';
            return `
                <div class="approval-card border rounded-lg overflow-hidden bg-white dark:bg-gray-800 hover:shadow-md transition-shadow duration-200">
                    <div class="bg-gray-50 dark:bg-gray-750 px-4 py-3 flex flex-wrap justify-between items-center gap-2 border-b border-gray-200 dark:border-gray-700">
                        <div class="flex items-center space-x-3">
                            <span class="font-bold text-gray-900 dark:text-gray-100">${req.department}</span>
                            ${typeBanner}
                        </div>
                        <div class="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>Requested by: <strong class="text-gray-700 dark:text-gray-300">${requestedByEmail}</strong></span>
                            <span>•</span>
                            <span>Required: <strong class="text-gray-700 dark:text-gray-300">${req.requiredBy || 'N/A'}</strong></span>
                            <span>•</span>
                            <span class="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-700 dark:text-blue-200 font-semibold">${req.priority}</span>
                        </div>
                    </div>
                    <div class="p-4">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Items Requested</h4>
                                <ul class="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-0.5">${itemsList}</ul>
                                <p class="font-extrabold text-sm text-gray-900 dark:text-gray-100 mt-2">Total Estimated: Birr ${(req.totalCost || 0).toFixed(2)}</p>
                            </div>
                            <div>
                                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Notes & Justification</h4>
                                <p class="text-sm text-gray-700 dark:text-gray-300 italic">${req.notes || 'No notes provided.'}</p>
                            </div>
                            <div>
                                <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">General Manager Decision</h4>
                                <textarea data-id="${req.id}" class="approval-notes-input w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 resize-none mb-2" rows="2" placeholder="Optional approval / rejection instructions..."></textarea>
                                <div class="flex space-x-2">
                                    <button data-id="${req.id}" class="approve-btn flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-semibold transition-colors shadow-sm"><i class="fas fa-check mr-1"></i>Approve</button>
                                    <button data-id="${req.id}" class="reject-btn flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-semibold transition-colors shadow-sm"><i class="fas fa-times mr-1"></i>Reject</button>
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

    const canEdit = state.userRole === 'System Administrator' || hasPermission(state.userRole, 'manage_inventory');
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
            <td class="px-3 md:px-4 py-2.5 whitespace-nowrap text-right text-sm">
                <div class="inline-flex items-center space-x-1">
                    <button data-id="${item.id}" class="receive-item-btn p-1.5 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded transition-colors" title="Receive / Fill Store (Stock In)">
                        <i class="fas fa-arrow-circle-down"></i>
                    </button>
                    <button data-id="${item.id}" class="issue-item-btn p-1.5 text-blue-600 hover:text-blue-800 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded transition-colors" title="Issue / Check Out stock to department" ${item.stock <= 0 ? 'disabled style="opacity: 0.35; cursor: not-allowed;"' : ''}>
                        <i class="fas fa-dolly"></i>
                    </button>
                    <button data-id="${item.id}" class="view-item-history-btn p-1.5 text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded transition-colors" aria-label="View history" title="View Audit Trail & Movement History">
                        <i class="fas fa-history"></i>
                    </button>
                    <button data-id="${item.id}" class="edit-item-btn p-1.5 text-hotel-accent hover:text-hotel-secondary hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded transition-colors" aria-label="Edit item" title="Edit Item Details & Adjust Stock">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button data-id="${item.id}" class="delete-item-btn p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 rounded transition-colors" aria-label="Delete item" title="Delete Item">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>` : '';
        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors">
                <td class="px-3 md:px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100 max-w-[200px] truncate" title="${item.name}">${item.name}</td>
                <td class="px-3 md:px-4 py-2.5 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">${item.category}</td>
                <td class="px-3 md:px-4 py-2.5 whitespace-nowrap text-xs font-semibold text-gray-800 dark:text-gray-200">Birr ${(item.price || 0).toFixed(2)}${item.unit ? ' / ' + item.unit : ''}</td>
                <td class="px-3 md:px-4 py-2.5 whitespace-nowrap text-xs font-bold ${item.stock <= 0 ? 'text-red-600' : (item.stock < item.min ? 'text-amber-600' : 'text-emerald-600')}">${item.stock} ${item.unit || ''}</td>
                <td class="px-3 md:px-4 py-2.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">${item.min} ${item.unit || ''}</td>
                <td class="px-3 md:px-4 py-2.5 whitespace-nowrap"><span class="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-${color}-100 text-${color}-800 dark:bg-${color}-900/60 dark:text-${color}-200">${status}</span></td>
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
    renderStoreOperations();
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
                    <td class="px-4 py-2">Birr ${(req.totalCost || 0).toFixed(2)}</td>
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
                <td class="px-6 py-4 whitespace-nowrap">Birr ${b.amount.toFixed(2)}</td>
                <td class="px-6 py-4 whitespace-nowrap">Birr ${b.spent.toFixed(2)}</td>
                <td class="px-6 py-4 whitespace-nowrap ${remainingColor}">Birr ${b.remaining.toFixed(2)}</td>
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
                    ticks: { callback: function(value) { return 'Birr ' + value; }, color: isDark ? '#e2e8f0' : '#4a5568' },
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
    switch (normalizeRole(role)) {
        case 'System Administrator':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 inline-flex items-center"><i class="fas fa-shield-alt mr-1"></i>Admin</span>';
        case 'General Manager':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 inline-flex items-center"><i class="fas fa-user-tie mr-1"></i>GM</span>';
        case 'Storekeeper':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 inline-flex items-center"><i class="fas fa-warehouse mr-1"></i>Storekeeper</span>';
        case 'Purchasing':
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 inline-flex items-center"><i class="fas fa-shopping-cart mr-1"></i>Purchasing</span>';
        default:
            return '<span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 inline-flex items-center"><i class="fas fa-user mr-1"></i>User</span>';
    }
}

export function showUserModal(user) {
    const modal = document.getElementById('user-modal');
    if (!modal) return;

    const normalizedUserRole = normalizeRole(user.role);
    const roleOptions = ROLES.map(r => `<option value="${r}" ${r === normalizedUserRole ? 'selected' : ''}>${r}</option>`).join('');
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

// ============================================================================
// Stock Reconciliation Report
// ============================================================================

/**
 * Computes reconciliation data for all inventory items against stock movements.
 * Compares item.stock with sum of movements (IN minus OUT) and flags mismatches.
 * @returns {Array<Object>} List of reconciled item objects
 */
export function computeStockReconciliation() {
    const items = state.inventoryItemsCache || [];
    const movements = state.stockMovementsCache || [];

    // Group movements by itemId or normalized itemName
    const movementsByItem = new Map();

    movements.forEach(m => {
        const qty = Number(m.quantity) || 0;
        const type = String(m.type || '').toUpperCase();
        const key = m.itemId || (m.itemName ? m.itemName.trim().toLowerCase() : null);
        if (!key) return;

        if (!movementsByItem.has(key)) {
            movementsByItem.set(key, { totalIn: 0, totalOut: 0, count: 0 });
        }
        const record = movementsByItem.get(key);
        record.count += 1;
        if (type === 'IN') {
            record.totalIn += qty;
        } else if (type === 'OUT') {
            record.totalOut += qty;
        }
    });

    return items.map(item => {
        const keyById = item.id;
        const keyByName = item.name ? item.name.trim().toLowerCase() : '';

        const recordById = movementsByItem.get(keyById) || { totalIn: 0, totalOut: 0, count: 0 };
        const recordByName = (keyByName && keyByName !== keyById) ? (movementsByItem.get(keyByName) || { totalIn: 0, totalOut: 0, count: 0 }) : { totalIn: 0, totalOut: 0, count: 0 };

        const totalIn = recordById.totalIn + recordByName.totalIn;
        const totalOut = recordById.totalOut + recordByName.totalOut;
        const movementCount = recordById.count + recordByName.count;

        const systemStock = Number(item.stock || 0);
        const computedStock = totalIn - totalOut;
        const difference = systemStock - computedStock;
        const isMatch = difference === 0;

        return {
            id: item.id,
            name: item.name,
            category: item.category || 'General',
            price: Number(item.price || 0),
            systemStock,
            totalIn,
            totalOut,
            computedStock,
            difference,
            isMatch,
            movementCount
        };
    }).sort((a, b) => {
        if (a.isMatch !== b.isMatch) return a.isMatch ? 1 : -1;
        return a.name.localeCompare(b.name);
    });
}

let activeReconciliationFilter = 'all';
let activeReconciliationSearch = '';

export function showStockReconciliationModal() {
    const modal = document.getElementById('stock-reconciliation-modal');
    if (!modal) return;

    activeReconciliationFilter = 'all';
    activeReconciliationSearch = '';

    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl transition-colors duration-300 overflow-hidden mx-4 max-h-[92vh] flex flex-col">
            <!-- Modal Header -->
            <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-750">
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-300">
                        <i class="fas fa-balance-scale text-lg"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">Stock Reconciliation Report</h3>
                        <p class="text-xs text-gray-500 dark:text-gray-400">Compares current inventory stock against the sum of stock movements (IN minus OUT).</p>
                    </div>
                </div>
                <button id="close-stock-reconciliation-btn" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1" aria-label="Close reconciliation modal">
                    <i class="fas fa-times text-lg"></i>
                </button>
            </div>

            <!-- Modal Body -->
            <div class="p-5 overflow-y-auto flex-1 space-y-4">
                <!-- Educational Explainer Card -->
                <div class="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-lg p-3 text-xs text-indigo-950 dark:text-indigo-200 flex items-start space-x-2.5">
                    <i class="fas fa-info-circle text-indigo-600 dark:text-indigo-400 text-sm mt-0.5 flex-shrink-0"></i>
                    <div class="flex-1 space-y-1">
                        <div class="font-bold text-gray-900 dark:text-gray-100">How Stock Reconciliation Works:</div>
                        <p class="leading-relaxed">
                            <strong>System Stock</strong> is what is currently saved on each inventory card. 
                            <strong>Computed Stock</strong> is calculated from the movement audit ledger (<code class="font-mono bg-indigo-100 dark:bg-indigo-900/60 px-1 py-0.5 rounded text-[11px]">Total IN - Total OUT</code>).
                        </p>
                        <p class="text-indigo-800 dark:text-indigo-300">
                            Items that had stock before movement tracking began show a variance (System Stock vs Computed Stock). Click <strong>Auto-Reconcile Variances</strong> (or click <strong>Reconcile</strong> / <strong>Set Baseline</strong> on any row) to record the missing opening balance or adjustment in the movement ledger.
                        </p>
                    </div>
                </div>

                <!-- Summary Metrics Cards -->
                <div id="reconciliation-kpis" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

                <!-- Controls: Filter Tabs & Search & Export -->
                <div class="flex flex-col sm:flex-row justify-between items-center gap-3 pt-1">
                    <div class="flex flex-wrap items-center gap-1.5 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg text-xs w-full sm:w-auto">
                        <button type="button" class="recon-filter-btn px-3 py-1.5 rounded-md font-semibold transition-colors bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm" data-filter="all">All Items (<span id="recon-count-all">0</span>)</button>
                        <button type="button" class="recon-filter-btn px-3 py-1.5 rounded-md font-semibold transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900" data-filter="mismatch">Mismatches (<span id="recon-count-mismatch">0</span>)</button>
                        <button type="button" class="recon-filter-btn px-3 py-1.5 rounded-md font-semibold transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900" data-filter="match">Matched (<span id="recon-count-match">0</span>)</button>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                        <div class="relative flex-1 sm:w-56">
                            <input type="text" id="recon-search-input" placeholder="Filter by item or category..." class="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:ring-indigo-500 focus:border-indigo-500">
                            <i class="fas fa-search absolute left-2.5 top-2 text-gray-400 text-xs"></i>
                        </div>
                        <button type="button" id="recon-auto-baseline-btn" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center transition-colors shadow-sm whitespace-nowrap" title="Automatically record opening balances or reconciling adjustments for all mismatched items">
                            <i class="fas fa-magic mr-1.5"></i> Auto-Reconcile Variances
                        </button>
                        <button type="button" id="recon-export-csv-btn" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center transition-colors shadow-sm whitespace-nowrap" title="Export Reconciliation Report to CSV">
                            <i class="fas fa-file-csv mr-1.5"></i> Export CSV
                        </button>
                    </div>
                </div>

                <!-- Reconciliation Results Table Container -->
                <div id="reconciliation-table-container" class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto"></div>
            </div>

            <!-- Modal Footer -->
            <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750 flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                <div>
                    <span>Computed Stock formula: <code class="font-mono bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-[11px]">Total IN - Total OUT</code></span>
                </div>
                <button type="button" id="close-stock-reconciliation-btn-bottom" class="px-5 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded-md transition-colors shadow">Close</button>
            </div>
        </div>
    `;

    renderReconciliationContent();

    modal.classList.remove('hidden', 'opacity-0', 'invisible');

    document.getElementById('close-stock-reconciliation-btn').addEventListener('click', hideStockReconciliationModal);
    document.getElementById('close-stock-reconciliation-btn-bottom').addEventListener('click', hideStockReconciliationModal);

    const filterBtns = modal.querySelectorAll('.recon-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => {
                b.classList.remove('bg-white', 'dark:bg-gray-600', 'text-gray-900', 'dark:text-white', 'shadow-sm');
                b.classList.add('text-gray-600', 'dark:text-gray-300');
            });
            btn.classList.add('bg-white', 'dark:bg-gray-600', 'text-gray-900', 'dark:text-white', 'shadow-sm');
            btn.classList.remove('text-gray-600', 'dark:text-gray-300');
            activeReconciliationFilter = btn.dataset.filter;
            renderReconciliationContent();
        });
    });

    const searchInput = document.getElementById('recon-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            activeReconciliationSearch = e.target.value.trim().toLowerCase();
            renderReconciliationContent();
        });
    }

    const exportBtn = document.getElementById('recon-export-csv-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', downloadStockReconciliationCsv);
    }
}

export function hideStockReconciliationModal() {
    const modal = document.getElementById('stock-reconciliation-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'invisible');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

export function renderReconciliationContent() {
    const allResults = computeStockReconciliation();
    const mismatchesCount = allResults.filter(r => !r.isMatch).length;
    const matchesCount = allResults.filter(r => r.isMatch).length;
    const totalCount = allResults.length;

    // Update filter badge counters
    const countAllSpan = document.getElementById('recon-count-all');
    const countMismatchSpan = document.getElementById('recon-count-mismatch');
    const countMatchSpan = document.getElementById('recon-count-match');
    if (countAllSpan) countAllSpan.textContent = totalCount;
    if (countMismatchSpan) {
        countMismatchSpan.textContent = mismatchesCount;
        if (mismatchesCount > 0) {
            countMismatchSpan.className = "px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300 font-bold";
        }
    }
    if (countMatchSpan) countMatchSpan.textContent = matchesCount;

    // Render KPIs
    const kpisContainer = document.getElementById('reconciliation-kpis');
    if (kpisContainer) {
        const netDiscrepancyUnits = allResults.reduce((sum, r) => sum + Math.abs(r.difference), 0);
        kpisContainer.innerHTML = `
            <div class="bg-gray-50 dark:bg-gray-750 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Inventory SKUs</div>
                <div class="text-xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">${totalCount}</div>
            </div>
            <div class="bg-green-50/70 dark:bg-green-950/20 p-3 rounded-lg border border-green-200 dark:border-green-900/40">
                <div class="text-[11px] font-semibold text-green-700 dark:text-green-400 uppercase">Balanced (Match)</div>
                <div class="text-xl font-extrabold text-green-700 dark:text-green-300 mt-1">${matchesCount}</div>
            </div>
            <div class="${mismatchesCount > 0 ? 'bg-red-50/80 dark:bg-red-950/30 border-red-200 dark:border-red-900/40' : 'bg-gray-50 dark:bg-gray-750 border-gray-200 dark:border-gray-700'} p-3 rounded-lg border">
                <div class="text-[11px] font-semibold ${mismatchesCount > 0 ? 'text-red-700 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'} uppercase">Mismatches</div>
                <div class="text-xl font-extrabold ${mismatchesCount > 0 ? 'text-red-600 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'} mt-1">${mismatchesCount}</div>
            </div>
            <div class="bg-indigo-50/70 dark:bg-indigo-950/20 p-3 rounded-lg border border-indigo-200 dark:border-indigo-900/40">
                <div class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase">Total Unit Variance</div>
                <div class="text-xl font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">${netDiscrepancyUnits}</div>
            </div>
        `;
    }

    // Filter by tab
    let displayList = allResults;
    if (activeReconciliationFilter === 'mismatch') {
        displayList = displayList.filter(r => !r.isMatch);
    } else if (activeReconciliationFilter === 'match') {
        displayList = displayList.filter(r => r.isMatch);
    }

    // Filter by search
    if (activeReconciliationSearch) {
        displayList = displayList.filter(r =>
            r.name.toLowerCase().includes(activeReconciliationSearch) ||
            r.category.toLowerCase().includes(activeReconciliationSearch)
        );
    }

    const tableContainer = document.getElementById('reconciliation-table-container');
    if (!tableContainer) return;

    if (displayList.length === 0) {
        tableContainer.innerHTML = `
            <div class="text-center py-12 text-gray-500 dark:text-gray-400">
                <i class="fas fa-check-circle text-4xl mb-3 text-green-500"></i>
                <p class="text-sm font-semibold">${activeReconciliationFilter === 'mismatch' ? 'No stock mismatches found! All items match their movement ledger.' : 'No inventory items found matching current filters.'}</p>
            </div>
        `;
        return;
    }

    const rowsHtml = displayList.map(r => {
        const diffDisplay = r.difference > 0 ? `+${r.difference}` : `${r.difference}`;
        const diffColor = r.isMatch
            ? 'text-gray-500 dark:text-gray-400 font-medium'
            : (r.difference > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-red-600 dark:text-red-400 font-bold');

        let badgeHtml;
        if (r.isMatch) {
            badgeHtml = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-200 border border-green-200 dark:border-green-800"><i class="fas fa-check mr-1 text-[10px]"></i> Balanced</span>`;
        } else if (r.movementCount === 0 && r.systemStock > 0) {
            badgeHtml = `
                <div class="inline-flex items-center gap-1.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border border-amber-200 dark:border-amber-800" title="Item has physical stock but no opening movement records">
                        <i class="fas fa-history mr-1 text-[10px]"></i> Needs Baseline
                    </span>
                    <button data-id="${r.id}" class="set-single-baseline-btn px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-bold transition-colors shadow-sm" title="Create opening balance movement of +${r.systemStock}">
                        Set Baseline
                    </button>
                </div>
            `;
        } else {
            const actionTitle = r.difference > 0
                ? `Record missing IN / opening adjustment (+${r.difference})`
                : `Record OUT reconciliation adjustment (${r.difference})`;
            badgeHtml = `
                <div class="inline-flex items-center gap-1.5">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 border border-red-200 dark:border-red-800">
                        <i class="fas fa-exclamation-triangle mr-1 text-[10px]"></i> Mismatch (${diffDisplay})
                    </span>
                    <button data-id="${r.id}" class="set-single-baseline-btn px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-bold transition-colors shadow-sm" title="${actionTitle}">
                        Reconcile
                    </button>
                </div>
            `;
        }

        const rowBg = !r.isMatch ? 'bg-red-50/40 dark:bg-red-950/10' : '';

        return `
            <tr class="border-b border-gray-150 dark:border-gray-700/60 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${rowBg} text-xs">
                <td class="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">
                    <div>${r.name}</div>
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 font-normal">Category: ${r.category}</span>
                </td>
                <td class="px-4 py-3 text-center font-bold text-gray-800 dark:text-gray-200 bg-gray-50/50 dark:bg-gray-800/50">
                    ${r.systemStock}
                </td>
                <td class="px-4 py-3 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
                    +${r.totalIn}
                </td>
                <td class="px-4 py-3 text-center text-rose-600 dark:text-rose-400 font-semibold">
                    -${r.totalOut}
                </td>
                <td class="px-4 py-3 text-center font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/30 dark:bg-indigo-950/20">
                    ${r.computedStock}
                </td>
                <td class="px-4 py-3 text-center ${diffColor}">
                    ${diffDisplay}
                </td>
                <td class="px-4 py-3 text-center whitespace-nowrap">
                    ${badgeHtml}
                </td>
            </tr>
        `;
    }).join('');

    tableContainer.innerHTML = `
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs">
            <thead class="bg-gray-50 dark:bg-gray-750 text-gray-600 dark:text-gray-300">
                <tr>
                    <th class="px-4 py-2.5 text-left font-semibold uppercase tracking-wider">Item & Category</th>
                    <th class="px-4 py-2.5 text-center font-semibold uppercase tracking-wider bg-gray-100/60 dark:bg-gray-700/40" title="Recorded stock value on inventory document">System Stock</th>
                    <th class="px-4 py-2.5 text-center font-semibold uppercase tracking-wider" title="Total received from POs / Vendor Delivery">Total IN</th>
                    <th class="px-4 py-2.5 text-center font-semibold uppercase tracking-wider" title="Total issued to hotel departments">Total OUT</th>
                    <th class="px-4 py-2.5 text-center font-semibold uppercase tracking-wider bg-indigo-50/60 dark:bg-indigo-950/30" title="Expected stock = Total IN minus Total OUT">Computed Stock</th>
                    <th class="px-4 py-2.5 text-center font-semibold uppercase tracking-wider" title="Variance = System Stock minus Computed Stock">Variance</th>
                    <th class="px-4 py-2.5 text-center font-semibold uppercase tracking-wider">Audit Status</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-150 dark:divide-gray-700/60 bg-white dark:bg-gray-800">
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

export function downloadStockReconciliationCsv() {
    try {
        const results = computeStockReconciliation();
        if (results.length === 0) {
            showNotification("No inventory items found to export.", true);
            return;
        }

        const headers = ['Item Name', 'Category', 'System Stock', 'Total IN (Received)', 'Total OUT (Issued)', 'Computed Stock (IN-OUT)', 'Variance', 'Status'];

        const escCsv = (val) => {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const rows = results.map(r => [
            r.name,
            r.category,
            r.systemStock,
            r.totalIn,
            r.totalOut,
            r.computedStock,
            r.difference > 0 ? `+${r.difference}` : r.difference,
            r.isMatch ? 'Balanced' : 'Mismatch'
        ].map(escCsv).join(','));

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Stock_Reconciliation_Report_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showNotification("Stock reconciliation report downloaded successfully!");
    } catch (err) {
        console.error('Reconciliation export failed:', err);
        showNotification("Failed to export reconciliation report.", true);
    }
}

// ============================================================================
// Notification Rendering
// ============================================================================

export function toggleNotificationDropdown(forceOpen = null) {
    const dropdown = document.getElementById('notification-dropdown');
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains('hidden');
    const shouldOpen = forceOpen !== null ? forceOpen : isHidden;

    if (shouldOpen) {
        dropdown.classList.remove('hidden');
        setTimeout(() => {
            dropdown.classList.remove('opacity-0', 'scale-95');
            dropdown.classList.add('opacity-100', 'scale-100');
        }, 10);
    } else {
        dropdown.classList.remove('opacity-100', 'scale-100');
        dropdown.classList.add('opacity-0', 'scale-95');
        setTimeout(() => {
            dropdown.classList.add('hidden');
        }, 200);
    }
}

export function renderNotificationBell() {
    const badge = document.getElementById('notification-badge');
    const list = document.getElementById('notifications-list');
    if (!list) return;

    const myNotifications = (state.notificationsCache || []).filter(n => {
        if (!state.userId) return false;
        if (n.recipientUserId && n.recipientUserId === state.userId) return true;
        if (n.recipientRole === 'All') return true;
        if (n.recipientRole && normalizeRole(n.recipientRole) === normalizeRole(state.userRole)) return true;
        if (state.userRole === 'System Administrator') return true;
        return false;
    });

    const unreadCount = myNotifications.filter(n => !Array.isArray(n.readBy) || !n.readBy.includes(state.userId)).length;

    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    if (myNotifications.length === 0) {
        list.innerHTML = `<div class="p-6 text-center text-xs text-gray-400">No new notifications.</div>`;
        return;
    }

    list.innerHTML = myNotifications.slice(0, 30).map(n => {
        const isRead = Array.isArray(n.readBy) && n.readBy.includes(state.userId);
        let iconHtml = '<i class="fas fa-bell text-amber-500"></i>';
        if (n.type === 'new_request') iconHtml = '<i class="fas fa-file-invoice text-blue-500"></i>';
        else if (n.type === 'approved') iconHtml = '<i class="fas fa-check-circle text-emerald-500"></i>';
        else if (n.type === 'rejected') iconHtml = '<i class="fas fa-times-circle text-rose-500"></i>';
        else if (n.type === 'ordered') iconHtml = '<i class="fas fa-truck text-indigo-500"></i>';
        else if (n.type === 'issued') iconHtml = '<i class="fas fa-dolly text-purple-500"></i>';
        else if (n.type === 'received') iconHtml = '<i class="fas fa-boxes text-emerald-600"></i>';

        const timeStr = n.createdAt?.toDate ? n.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';

        return `
            <div class="notification-item p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors flex items-start space-x-3 ${isRead ? 'opacity-70' : 'bg-blue-50/40 dark:bg-blue-950/20 font-medium'}" data-id="${n.id}" data-request-id="${n.requestId || ''}">
                <div class="text-base mt-0.5 flex-shrink-0">${iconHtml}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-baseline mb-0.5">
                        <span class="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">${n.title || 'Notification'}</span>
                        <span class="text-[10px] text-gray-400 ml-2 whitespace-nowrap">${timeStr}</span>
                    </div>
                    <p class="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">${n.message || ''}</p>
                </div>
                ${!isRead ? '<span class="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" title="Unread"></span>' : ''}
            </div>
        `;
    }).join('');
}

export function updateSidebarBadges() {
    const approvalsBadge = document.getElementById('sidebar-approvals-badge');
    const storeBadge = document.getElementById('sidebar-store-badge');
    const requests = state.allRequestsCache || [];

    if (approvalsBadge) {
        if (state.userRole === 'General Manager' || state.userRole === 'System Administrator') {
            const pendingApprovals = requests.filter(r => r.status === 'Pending').length;
            if (pendingApprovals > 0) {
                approvalsBadge.textContent = pendingApprovals;
                approvalsBadge.classList.remove('hidden');
            } else {
                approvalsBadge.classList.add('hidden');
            }
        } else {
            approvalsBadge.classList.add('hidden');
        }
    }

    if (storeBadge) {
        if (state.userRole === 'Storekeeper' || state.userRole === 'Store Keeper' || state.userRole === 'System Administrator') {
            const pendingStore = requests.filter(r =>
                (r.status === 'Approved' && (r.requestType === 'Requisition' || r.requestType === 'requisition')) ||
                (r.status === 'Ordered')
            ).length;
            if (pendingStore > 0) {
                storeBadge.textContent = pendingStore;
                storeBadge.classList.remove('hidden');
            } else {
                storeBadge.classList.add('hidden');
            }
        } else {
            storeBadge.classList.add('hidden');
        }
    }
}

/**
 * Renders the Storekeeper Action Center directly above the inventory table.
 * Shows pending requisitions to issue and POs to receive, matching the sidebar badge.
 */
export function renderStoreOperations() {
    const container = document.getElementById('store-operations-action-center');
    if (!container) return;

    const isStoreStaff = state.userRole === 'Storekeeper' || state.userRole === 'Store Keeper' || state.userRole === 'System Administrator';
    if (!isStoreStaff) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    const requests = state.allRequestsCache || [];
    const requisitionsToIssue = requests.filter(r =>
        (r.status === 'Approved' || r.status === 'Partially Issued') &&
        (r.requestType === 'requisition' || r.requestType === 'Requisition' || !isPurchaseRequest(r))
    );
    const posToReceive = requests.filter(r =>
        (r.status === 'Ordered' || r.status === 'Partially Received')
    );

    const totalCount = requisitionsToIssue.length + posToReceive.length;
    if (totalCount === 0) {
        container.classList.add('hidden');
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = `
        <div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-gray-800 dark:to-gray-800/95 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-amber-200/80 dark:border-gray-700 gap-2">
                <div class="flex items-center space-x-2.5">
                    <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500 text-white shadow-sm">
                        <i class="fas fa-bell mr-1.5 animate-pulse"></i> ${totalCount} Action${totalCount === 1 ? '' : 's'} Required
                    </span>
                    <h3 class="font-bold text-gray-900 dark:text-gray-100 text-sm md:text-base">Store Operations Queue</h3>
                </div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                    Requests waiting for warehouse issuance or vendor receipt (matches your sidebar badge: <strong>${totalCount}</strong>)
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3.5">
                <!-- Requisitions to Issue (Stock Down) -->
                <div class="bg-white dark:bg-gray-750/70 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800/40">
                    <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-150 dark:border-gray-700">
                        <div class="flex items-center space-x-2">
                            <span class="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-bold">
                                <i class="fas fa-dolly"></i>
                            </span>
                            <span class="text-xs font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide">Approved Requisitions to Issue (${requisitionsToIssue.length})</span>
                        </div>
                    </div>
                    ${requisitionsToIssue.length === 0 ? `
                        <p class="text-xs text-gray-400 py-3 text-center">No requisitions currently waiting for issue.</p>
                    ` : `
                        <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                            ${requisitionsToIssue.map(r => {
                                const itemCount = (r.items || []).length;
                                const itemsSummary = (r.items || []).slice(0, 2).map(it => `${it.quantity}x ${it.name}`).join(', ') + (itemCount > 2 ? ` +${itemCount - 2} more` : '');
                                return `
                                    <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600 flex items-center justify-between text-xs gap-2">
                                        <div class="min-w-0 flex-1">
                                            <div class="flex items-center space-x-1.5 font-semibold text-gray-900 dark:text-gray-100">
                                                <span>#${r.id.slice(-6).toUpperCase()}</span>
                                                <span class="text-gray-400">•</span>
                                                <span class="text-emerald-700 dark:text-emerald-300 font-bold">${r.department || 'Hotel'}</span>
                                            </div>
                                            <div class="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5" title="${itemsSummary}">${itemsSummary}</div>
                                        </div>
                                        <button data-id="${r.id}" class="issue-req-btn shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold flex items-center transition-colors shadow-sm" title="Issue items to department">
                                            <i class="fas fa-dolly mr-1"></i> Issue Items
                                        </button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>

                <!-- Purchase Orders to Receive (Stock Up) -->
                <div class="bg-white dark:bg-gray-750/70 rounded-lg p-3 border border-blue-200 dark:border-blue-800/40">
                    <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-150 dark:border-gray-700">
                        <div class="flex items-center space-x-2">
                            <span class="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center text-xs font-bold">
                                <i class="fas fa-truck-loading"></i>
                            </span>
                            <span class="text-xs font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide">Ordered POs to Receive (${posToReceive.length})</span>
                        </div>
                    </div>
                    ${posToReceive.length === 0 ? `
                        <p class="text-xs text-gray-400 py-3 text-center">No purchase orders currently awaiting receipt.</p>
                    ` : `
                        <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                            ${posToReceive.map(r => {
                                const itemCount = (r.items || []).length;
                                const itemsSummary = (r.items || []).slice(0, 2).map(it => `${it.quantity}x ${it.name}`).join(', ') + (itemCount > 2 ? ` +${itemCount - 2} more` : '');
                                return `
                                    <div class="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600 flex items-center justify-between text-xs gap-2">
                                        <div class="min-w-0 flex-1">
                                            <div class="flex items-center space-x-1.5 font-semibold text-gray-900 dark:text-gray-100">
                                                <span>#${r.id.slice(-6).toUpperCase()}</span>
                                                <span class="text-gray-400">•</span>
                                                <span class="text-blue-700 dark:text-blue-300 font-bold">${r.supplier || 'Vendor'}</span>
                                            </div>
                                            <div class="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5" title="${itemsSummary}">${itemsSummary}</div>
                                        </div>
                                        <button data-id="${r.id}" class="receive-po-goods-btn shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold flex items-center transition-colors shadow-sm" title="Receive delivered goods into store">
                                            <i class="fas fa-truck-loading mr-1"></i> Receive Goods
                                        </button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
}

