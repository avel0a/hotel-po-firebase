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
    renderDashboard, renderInventory, renderMyRequests,
    applyReportFilters
} from './ui.js';
import {
    handleLogin, handleLogout, handleCreateUser,
    handleRequestFormSubmit, updateRequestStatus, markRequestAsReceived,
    handleItemFormSubmit, deleteInventoryItem,
    handleSetBudget, downloadReportPdf
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

    // Patch department select with full list
    const departmentSelect = document.getElementById('req-department');
    if (departmentSelect) {
        departmentSelect.innerHTML = DEPARTMENTS.map(d => `<option>${d}</option>`).join('');
    }

    // --- Form Submissions ---
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('create-user-form').addEventListener('submit', handleCreateUser);
    document.getElementById('purchase-request-form').addEventListener('submit', handleRequestFormSubmit);
    document.getElementById('set-budget-btn').addEventListener('click', handleSetBudget);

    // Item form submit (dynamic — handled via event delegation)
    document.addEventListener('submit', (e) => {
        if (e.target.id === 'item-form') {
            handleItemFormSubmit(e);
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

    document.addEventListener('click', (e) => {
        if (!profileMenu.classList.contains('hidden') && !profileMenuButton.contains(e.target) && !profileMenu.contains(e.target)) {
            profileMenu.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { profileMenu.classList.add('hidden'); }, 200);
        }
    });

    // --- Report Controls ---
    document.getElementById('apply-report-filters-btn').addEventListener('click', applyReportFilters);
    document.getElementById('download-pdf-btn').addEventListener('click', downloadReportPdf);

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

    // --- Search (live) ---
    document.getElementById('my-requests-search').addEventListener('input', (e) => {
        renderMyRequests(state.allRequestsCache, e.target.value);
    });

    document.getElementById('inventory-search').addEventListener('input', (e) => {
        renderInventory(state.inventoryItemsCache, e.target.value);
    });

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

    // --- Item Cost Calculation (event delegation) ---
    document.getElementById('items-container').addEventListener('input', e => {
        const itemNameInput = e.target.closest('.item-name');
        if (itemNameInput) {
            const row = itemNameInput.closest('.item-row');
            const priceInput = row.querySelector('.item-price');
            const selectedItem = state.inventoryItemsCache.find(item => item.name.toLowerCase() === itemNameInput.value.toLowerCase());
            priceInput.value = selectedItem ? (selectedItem.price || 0) : 0;
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

    // --- Centralized Click Delegation (dynamic buttons) ---
    document.body.addEventListener('click', e => {
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

        // Approve / Reject
        const approveBtn = e.target.closest('.approve-btn');
        if (approveBtn) { updateRequestStatus(approveBtn.dataset.id, 'Approved'); return; }
        const rejectBtn = e.target.closest('.reject-btn');
        if (rejectBtn) { updateRequestStatus(rejectBtn.dataset.id, 'Rejected'); return; }

        // Show add inventory item modal
        if (e.target.closest('#show-add-item-modal-btn')) { showItemModal(); return; }

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

        // Close modals
        if (e.target.closest('#close-item-modal-btn') || e.target.closest('#cancel-item-modal-btn')) {
            hideItemModal();
            return;
        }
        if (e.target.closest('#close-request-details-modal-btn')) {
            hideRequestDetailsModal();
            return;
        }
    });
});
