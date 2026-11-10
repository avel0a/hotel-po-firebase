/**
 * Application entry point — initialization and event listener wiring.
 * All event handlers are registered here using event delegation where appropriate.
 */

import state from './state.js';
import { doc, getDoc } from './firebase.js';
import { DEPARTMENTS } from './config.js';
import {
    loadTheme, showSection, showNotification, toggleTheme,
    addRequestItemRow, updateTotalCost, updateItemSubtotal,
    populateItemNameDatalist, showItemModal, hideItemModal,
    hideRequestDetailsModal, showRequestDetailsModal,
    showUserModal, hideUserModal, renderUsersTable,
    renderDashboard, renderInventory, renderMyRequests,
    applyReportFilters, showIssueModal, hideIssueModal,
    showReceiveModal, hideReceiveModal,
    showIssueRequisitionModal, hideIssueRequisitionModal,
    showOrderPOModal, hideOrderPOModal,
    showReceiveGoodsModal, hideReceiveGoodsModal,
    showStockLogModal, hideStockLogModal,
    showStockReconciliationModal, hideStockReconciliationModal,
    refreshDepartmentSelects, renderDepartmentsList, renderPermissionsMatrix,
    handleItemRowUnitChange, renderNotificationBell, updateSidebarBadges, toggleNotificationDropdown,
    renderStoreOperations
} from './ui.js';
import {
    handleLogin, handleLogout, handleCreateUser,
    handleEditUser, handleSaveUserEdit, handleResetUserPassword, handleDeleteUser,
    handleRequestFormSubmit, updateRequestStatus, markRequestAsReceived,
    handleItemFormSubmit, deleteInventoryItem, handleIssueStock, handleReceiveStock,
    handleMarkAsOrdered, handleIssueRequisitionSubmit, handleReceiveGoodsSubmit,
    handleSetBudget, downloadReportPdf, downloadReportCsv, handleQuickOrderLowStock,
    handleAddDepartment, handleDeleteDepartment, handleSaveRolePermissions, handleResetRolePermissions,
    runOneTimeRequestAudit, handleMarkAllNotificationsRead, handleNotificationClick,
    handleBaselineOpeningStock
} from './actions.js';
import { initializeFirebase } from './auth.js';

// ============================================================================
// DOM Content Loaded — Wire everything up
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    initializeFirebase();
    showSection('dashboard');
    addRequestItemRow();

    // Populate department selects across the app
    refreshDepartmentSelects();

    // Background normalization for Flow A / Flow B data model
    runOneTimeRequestAudit();

    // --- Form Submissions ---
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);
    document.getElementById('purchase-request-form').addEventListener('submit', handleRequestFormSubmit);
    document.getElementById('set-budget-btn').addEventListener('click', handleSetBudget);

    // Hotel Settings & Role Permissions Forms
    const addDeptForm = document.getElementById('add-dept-form');
    if (addDeptForm) addDeptForm.addEventListener('submit', handleAddDepartment);

    const permissionsForm = document.getElementById('permissions-matrix-form');
    if (permissionsForm) permissionsForm.addEventListener('submit', handleSaveRolePermissions);

    const resetPermsBtn = document.getElementById('reset-default-permissions-btn');
    if (resetPermsBtn) resetPermsBtn.addEventListener('click', handleResetRolePermissions);

    // Modal form submits (dynamic — handled via event delegation)
    document.addEventListener('submit', (e) => {
        if (e.target.id === 'item-form') {
            handleItemFormSubmit(e);
        } else if (e.target.id === 'edit-user-form') {
            handleSaveUserEdit(e);
        } else if (e.target.id === 'issue-stock-form') {
            handleIssueStock(e);
        } else if (e.target.id === 'receive-stock-form') {
            handleReceiveStock(e);
        } else if (e.target.id === 'issue-requisition-form') {
            handleIssueRequisitionSubmit(e);
        } else if (e.target.id === 'order-po-form') {
            handleMarkAsOrdered(e);
        } else if (e.target.id === 'receive-goods-form') {
            handleReceiveGoodsSubmit(e);
        }
    });

    // --- Profile Menu ---
    const profileMenuButton = document.getElementById('profile-menu-button');
    const profileMenu = document.getElementById('profile-menu');

    profileMenuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = profileMenu.classList.contains('hidden');
        if (isHidden) {
            profileMenu.classList.remove('hidden');
            setTimeout(() => { profileMenu.classList.remove('opacity-0', 'scale-95'); }, 10);
        } else {
            profileMenu.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { profileMenu.classList.add('hidden'); }, 200);
        }
    });

    document.getElementById('profile-logout-btn').addEventListener('click', handleLogout);

    // --- Notification Bell & Dropdown ---
    const bellBtn = document.getElementById('notification-bell-btn');
    if (bellBtn) {
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotificationDropdown();
        });
    }

    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleMarkAllNotificationsRead();
        });
    }

    document.addEventListener('click', (e) => {
        if (!profileMenu.classList.contains('hidden') && !profileMenuButton.contains(e.target) && !profileMenu.contains(e.target)) {
            profileMenu.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { profileMenu.classList.add('hidden'); }, 200);
        }
        const notifDropdown = document.getElementById('notification-dropdown');
        const notifBell = document.getElementById('notification-bell-btn');
        if (notifDropdown && !notifDropdown.classList.contains('hidden')) {
            if (!notifDropdown.contains(e.target) && !notifBell?.contains(e.target)) {
                toggleNotificationDropdown(false);
            }
        }
    });

    // --- Report Controls ---
    document.getElementById('apply-report-filters-btn').addEventListener('click', applyReportFilters);
    document.getElementById('download-pdf-btn').addEventListener('click', downloadReportPdf);

    // Stock log modal
    const stockLogBtn = document.getElementById('view-stock-log-btn');
    if (stockLogBtn) stockLogBtn.addEventListener('click', showStockLogModal);

    // Stock reconciliation modal
    const stockReconBtn = document.getElementById('view-stock-reconciliation-btn');
    if (stockReconBtn) stockReconBtn.addEventListener('click', showStockReconciliationModal);

    const reportStockReconBtn = document.getElementById('report-stock-reconciliation-btn');
    if (reportStockReconBtn) reportStockReconBtn.addEventListener('click', showStockReconciliationModal);

    // CSV download
    const csvBtn = document.getElementById('download-csv-btn');
    if (csvBtn) csvBtn.addEventListener('click', downloadReportCsv);

    // Low-stock quick order
    const quickOrderBtn = document.getElementById('quick-order-low-stock-btn');
    if (quickOrderBtn) quickOrderBtn.addEventListener('click', handleQuickOrderLowStock);

    // --- Theme Toggle ---
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // --- Dashboard Stat Cards (filter on click) ---
    document.querySelectorAll('.dashboard-stat-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const status = e.currentTarget.dataset.filterStatus;
            renderDashboard(state.allRequestsCache, status);
        });
    });

    document.getElementById('clear-dashboard-filter-btn').addEventListener('click', () => {
        renderDashboard(state.allRequestsCache);
    });

    // --- Department Override Controls (Admin / GM) ---
    const overrideCheck = document.getElementById('req-dept-override-check');
    const overrideSelect = document.getElementById('req-department-override');
    const selectWrapper = document.getElementById('req-dept-select-wrapper');
    const reqDeptHidden = document.getElementById('req-department');
    const reqDeptDisplay = document.getElementById('req-dept-display');

    if (overrideCheck && overrideSelect) {
        overrideCheck.addEventListener('change', () => {
            if (overrideCheck.checked) {
                if (selectWrapper) selectWrapper.classList.remove('hidden');
                if (reqDeptHidden) reqDeptHidden.value = overrideSelect.value;
                if (reqDeptDisplay) reqDeptDisplay.textContent = overrideSelect.value + ' (Overridden)';
            } else {
                if (selectWrapper) selectWrapper.classList.add('hidden');
                const defaultDept = state.userDepartment || 'Other';
                if (reqDeptHidden) reqDeptHidden.value = defaultDept;
                if (reqDeptDisplay) reqDeptDisplay.textContent = defaultDept;
            }
        });

        overrideSelect.addEventListener('change', () => {
            if (overrideCheck.checked) {
                if (reqDeptHidden) reqDeptHidden.value = overrideSelect.value;
                if (reqDeptDisplay) reqDeptDisplay.textContent = overrideSelect.value + ' (Overridden)';
            }
        });
    }

    // --- Order / Request Type Radio Selector ---
    document.querySelectorAll('input[name="req-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const reqLabel = document.getElementById('req-type-requisition-label');
            const poLabel = document.getElementById('req-type-po-label');
            if (radio.value === 'Requisition') {
                if (reqLabel) reqLabel.className = 'flex items-start p-3 border rounded-lg cursor-pointer transition-colors bg-white dark:bg-gray-800 border-hotel-accent/60 shadow-sm';
                if (poLabel) poLabel.className = 'flex items-start p-3 border rounded-lg cursor-pointer transition-colors bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-75';
            } else {
                if (poLabel) poLabel.className = 'flex items-start p-3 border rounded-lg cursor-pointer transition-colors bg-white dark:bg-gray-800 border-emerald-500/60 shadow-sm';
                if (reqLabel) reqLabel.className = 'flex items-start p-3 border rounded-lg cursor-pointer transition-colors bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-75';
            }
        });
    });

    // --- Search (live) ---
    document.getElementById('my-requests-search').addEventListener('input', (e) => {
        renderMyRequests(state.allRequestsCache, e.target.value);
    });

    document.getElementById('inventory-search').addEventListener('input', (e) => {
        renderInventory(state.inventoryItemsCache, e.target.value);
    });

    const usersSearch = document.getElementById('users-search');
    if (usersSearch) {
        usersSearch.addEventListener('input', (e) => {
            renderUsersTable(state.allUsersCache, e.target.value);
        });
    }

    // --- Inventory Table Sorting ---
    document.getElementById('inventory-table-element').addEventListener('click', (e) => {
        const header = e.target.closest('th[data-sort]');
        if (header) {
            const column = header.dataset.sort;
            if (state.inventorySortColumn === column) {
                state.inventorySortDirection = state.inventorySortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                state.inventorySortColumn = column;
                state.inventorySortDirection = 'asc';
            }
            renderInventory(state.inventoryItemsCache, document.getElementById('inventory-search').value);
        }
    });

    // --- Item Cost Calculation & Dynamic Unit Scaling (event delegation) ---
    const itemsContainer = document.getElementById('items-container');
    if (itemsContainer) {
        itemsContainer.addEventListener('input', e => {
            const itemNameInput = e.target.closest('.item-name');
            if (itemNameInput) {
                const row = itemNameInput.closest('.item-row');
                const priceInput = row.querySelector('.item-price');
                const unitSelect = row.querySelector('.item-unit');
                const selectedItem = state.inventoryItemsCache.find(item => item.name.toLowerCase() === itemNameInput.value.toLowerCase());
                if (selectedItem) {
                    row.dataset.basePrice = selectedItem.price || 0;
                    row.dataset.baseUnit = selectedItem.unit || 'Each';
                    row.dataset.packageSize = selectedItem.packageSize || 1;
                    if (unitSelect && selectedItem.unit) {
                        unitSelect.value = selectedItem.unit;
                    }
                    if (priceInput) {
                        priceInput.value = Number(selectedItem.price || 0).toFixed(2);
                    }
                } else {
                    row.dataset.basePrice = 0;
                    row.dataset.baseUnit = 'Each';
                    row.dataset.packageSize = 1;
                }
                updateItemSubtotal(row);
                return;
            }

            const itemPriceInput = e.target.closest('.item-price');
            if (itemPriceInput) {
                const row = itemPriceInput.closest('.item-row');
                updateItemSubtotal(row);
                return;
            }

            const itemQuantityInput = e.target.closest('.item-quantity');
            if (itemQuantityInput) {
                const row = itemQuantityInput.closest('.item-row');
                updateItemSubtotal(row);
                return;
            }
        });

        itemsContainer.addEventListener('change', e => {
            const unitSelect = e.target.closest('.item-unit');
            if (unitSelect) {
                const row = unitSelect.closest('.item-row');
                handleItemRowUnitChange(row);
                return;
            }
        });
    }

    // --- Centralized Click Delegation (dynamic buttons) ---
    document.body.addEventListener('click', e => {
        // Notification item click (mark as read & view request)
        const notifItem = e.target.closest('.notification-item');
        if (notifItem) {
            const notifId = notifItem.dataset.id;
            const reqId = notifItem.dataset.requestId;
            toggleNotificationDropdown(false);
            handleNotificationClick(notifId, reqId);
            return;
        }

        // Navigation links
        const navLink = e.target.closest('.nav-link');
        if (navLink && navLink.dataset.section) {
            e.preventDefault();
            showSection(navLink.dataset.section);
            return;
        }

        // Mobile menu
        if (e.target.closest('#mobile-menu-open')) {
            document.querySelector('.sidebar').classList.add('open');
            return;
        }
        if (e.target.closest('#mobile-menu-close')) {
            document.querySelector('.sidebar').classList.remove('open');
            return;
        }

        // Add item row
        if (e.target.closest('#add-item-btn')) {
            addRequestItemRow();
            return;
        }

        // Remove item row
        const removeItemBtn = e.target.closest('.remove-item-btn');
        if (removeItemBtn) {
            if (document.querySelectorAll('#items-container .item-row').length > 1) {
                removeItemBtn.closest('.item-row').remove();
                updateTotalCost();
            } else {
                showNotification("You must have at least one item.", true);
            }
            return;
        }

        // Approve / Reject (with approval notes)
        const approveBtn = e.target.closest('.approve-btn');
        if (approveBtn) {
            const reqId = approveBtn.dataset.id;
            const card = approveBtn.closest('.approval-card');
            const notesInput = card ? card.querySelector(`.approval-notes-input[data-id="${reqId}"]`) : null;
            const notes = notesInput ? notesInput.value : '';
            updateRequestStatus(reqId, 'Approved', notes);
            return;
        }
        const rejectBtn = e.target.closest('.reject-btn');
        if (rejectBtn) {
            const reqId = rejectBtn.dataset.id;
            const card = rejectBtn.closest('.approval-card');
            const notesInput = card ? card.querySelector(`.approval-notes-input[data-id="${reqId}"]`) : null;
            const notes = notesInput ? notesInput.value : '';
            updateRequestStatus(reqId, 'Rejected', notes);
            return;
        }

        // Show add inventory item modal
        if (e.target.closest('#show-add-item-modal-btn')) { showItemModal(); return; }

        // Show receive goods / fill store modal
        if (e.target.closest('#show-receive-modal-btn')) { showReceiveModal(); return; }

        // Receive specific inventory item
        const receiveItemBtn = e.target.closest('.receive-item-btn');
        if (receiveItemBtn) {
            const itemId = receiveItemBtn.dataset.id;
            const item = state.inventoryItemsCache.find(i => i.id === itemId);
            showReceiveModal(item);
            return;
        }

        // Issue inventory item
        const issueItemBtn = e.target.closest('.issue-item-btn');
        if (issueItemBtn) {
            const itemId = issueItemBtn.dataset.id;
            const item = state.inventoryItemsCache.find(i => i.id === itemId);
            if (item) {
                if (item.stock <= 0) {
                    showNotification(`${item.name} is completely out of stock. Cannot issue!`, true);
                    return;
                }
                showIssueModal(item);
            } else {
                showNotification("Item details not found.", true);
            }
            return;
        }

        // View item audit trail & movement history
        const viewHistoryBtn = e.target.closest('.view-item-history-btn');
        if (viewHistoryBtn) {
            const itemId = viewHistoryBtn.dataset.id;
            const item = (state.inventoryItemsCache || []).find(i => i.id === itemId);
            showStockLogModal(item || null);
            return;
        }

        // Auto-baseline opening stock (all items)
        if (e.target.closest('#recon-auto-baseline-btn')) {
            handleBaselineOpeningStock();
            return;
        }

        // Baseline opening stock (single item)
        const setSingleBaselineBtn = e.target.closest('.set-single-baseline-btn');
        if (setSingleBaselineBtn) {
            handleBaselineOpeningStock(setSingleBaselineBtn.dataset.id);
            return;
        }

        // Edit inventory item
        const editItemBtn = e.target.closest('.edit-item-btn');
        if (editItemBtn) {
            getDoc(doc(state.db, 'inventory', editItemBtn.dataset.id)).then(docSnap => {
                if (docSnap.exists()) showItemModal({ id: docSnap.id, ...docSnap.data() });
            }).catch(error => {
                console.error("Error fetching item for edit:", error);
                showNotification("Failed to load item for editing.", true);
            });
            return;
        }

        // Delete inventory item
        const deleteItemBtn = e.target.closest('.delete-item-btn');
        if (deleteItemBtn) { deleteInventoryItem(deleteItemBtn.dataset.id); return; }

        // Mark request as received
        const markReceivedBtn = e.target.closest('.mark-received-btn');
        if (markReceivedBtn) { markRequestAsReceived(markReceivedBtn.dataset.id); return; }

        // View request details
        const viewRequestBtn = e.target.closest('.view-request-btn');
        if (viewRequestBtn) {
            const reqId = viewRequestBtn.dataset.id;
            const req = state.allRequestsCache.find(r => r.id === reqId);
            if (req) { showRequestDetailsModal(req); }
            else { showNotification("Request details not found.", true); }
            return;
        }

        // User Management actions
        const editUserBtn = e.target.closest('.edit-user-btn');
        if (editUserBtn) {
            handleEditUser(editUserBtn.dataset.id);
            return;
        }

        const resetPwdBtn = e.target.closest('.reset-pwd-user-btn');
        if (resetPwdBtn) {
            handleResetUserPassword(resetPwdBtn.dataset.id, resetPwdBtn.dataset.email);
            return;
        }

        const deleteUserBtn = e.target.closest('.delete-user-btn');
        if (deleteUserBtn) {
            handleDeleteUser(deleteUserBtn.dataset.id, deleteUserBtn.dataset.email);
            return;
        }

        // Settings actions (delete department)
        const deleteDeptBtn = e.target.closest('.delete-dept-btn');
        if (deleteDeptBtn) {
            handleDeleteDepartment(deleteDeptBtn.dataset.department);
            return;
        }

        // Flow filter buttons (All, Dept Requisitions, Purchase Orders)
        const flowBtn = e.target.closest('.flow-filter-btn');
        if (flowBtn) {
            const flow = flowBtn.dataset.flow;
            state.requestFlowFilter = flow;
            document.querySelectorAll('.flow-filter-btn').forEach(btn => {
                if (btn.dataset.flow === flow) {
                    btn.className = 'flow-filter-btn px-3 py-1.5 text-xs font-semibold rounded-md transition-colors bg-white dark:bg-gray-700 text-hotel-primary dark:text-white shadow-sm';
                } else {
                    btn.className = 'flow-filter-btn px-3 py-1.5 text-xs font-semibold rounded-md transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white';
                }
            });
            renderMyRequests(state.allRequestsCache);
            return;
        }

        // Flow A: Issue Requisition (Storekeeper action)
        const issueReqBtn = e.target.closest('.issue-req-btn');
        if (issueReqBtn) {
            const req = (state.allRequestsCache || []).find(r => r.id === issueReqBtn.dataset.id);
            if (req) { showIssueRequisitionModal(req); }
            else { showNotification("Requisition details not found.", true); }
            return;
        }

        // Flow B: Place Purchase Order with Vendor (Purchasing action)
        const orderPoBtn = e.target.closest('.order-po-btn');
        if (orderPoBtn) {
            const req = (state.allRequestsCache || []).find(r => r.id === orderPoBtn.dataset.id);
            if (req) { showOrderPOModal(req); }
            else { showNotification("Purchase order details not found.", true); }
            return;
        }

        // Flow B: Receive PO Goods into Store (Storekeeper action)
        const receivePoGoodsBtn = e.target.closest('.receive-po-goods-btn');
        if (receivePoGoodsBtn) {
            const req = (state.allRequestsCache || []).find(r => r.id === receivePoGoodsBtn.dataset.id);
            if (req) { showReceiveGoodsModal(req); }
            else { showNotification("Purchase order details not found.", true); }
            return;
        }

        // Close modals
        if (e.target.closest('#close-item-modal-btn') || e.target.closest('#cancel-item-modal-btn')) {
            hideItemModal();
            return;
        }
        if (e.target.closest('#close-receive-modal-btn') || e.target.closest('#cancel-receive-modal-btn')) {
            hideReceiveModal();
            return;
        }
        if (e.target.closest('#close-issue-modal-btn') || e.target.closest('#cancel-issue-modal-btn')) {
            hideIssueModal();
            return;
        }
        if (e.target.closest('#close-issue-requisition-modal-btn') || e.target.closest('#cancel-issue-requisition-modal-btn')) {
            hideIssueRequisitionModal();
            return;
        }
        if (e.target.closest('#close-order-po-modal-btn') || e.target.closest('#cancel-order-po-modal-btn')) {
            hideOrderPOModal();
            return;
        }
        if (e.target.closest('#close-receive-goods-modal-btn') || e.target.closest('#cancel-receive-goods-modal-btn')) {
            hideReceiveGoodsModal();
            return;
        }
        if (e.target.closest('#close-stock-log-btn') || e.target.closest('#close-stock-log-btn-bottom')) {
            hideStockLogModal();
            return;
        }
        if (e.target.closest('#close-user-modal-btn') || e.target.closest('#cancel-user-modal-btn')) {
            hideUserModal();
            return;
        }
        if (e.target.closest('#close-request-details-modal-btn')) {
            hideRequestDetailsModal();
            return;
        }
    });
});
