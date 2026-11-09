/**
 * Actions module — all data mutations (form submissions, CRUD, approve/reject).
 * Imports UI helpers for notifications/overlays but never does rendering.
 */

import state from './state.js';
import { firebaseConfig } from './config.js';
import {
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    sendPasswordResetEmail, initializeApp, deleteApp, getAuth,
    doc, collection, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, serverTimestamp, getDoc, getDocs
} from './firebase.js';
import {
    showLoadingOverlay, hideLoadingOverlay, showNotification,
    showSection, showConfirmModal, addRequestItemRow, updateTotalCost,
    hideItemModal, showUserModal, hideUserModal
} from './ui.js';

// ============================================================================
// Authentication Actions
// ============================================================================

/**
 * Handles login form submission.
 */
export async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    showLoadingOverlay();
    try {
        await signInWithEmailAndPassword(state.auth, email, password);
    } catch (error) {
        showNotification(error.message, true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Handles logout.
 */
export async function handleLogout() {
    showLoadingOverlay();
    try {
        await signOut(state.auth);
        showNotification("Logged out successfully.");
    } catch (error) {
        console.error("Error logging out:", error);
        showNotification("Failed to log out.", true);
    } finally {
        hideLoadingOverlay();
    }
}

// ============================================================================
// User Management Actions
// ============================================================================

/**
 * Handles creation of a new user using a temporary secondary Firebase App.
 * This guarantees the current admin session is completely preserved with no prompts.
 */
export async function handleCreateUser(e) {
    e.preventDefault();
    if (state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to create users.", true);
        return;
    }
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    const department = document.getElementById('new-user-department').value;

    if (!email || !password || !role || !department) {
        showNotification("Please fill in all fields.", true);
        return;
    }
    if (password.length < 6) {
        showNotification("Password must be at least 6 characters long.", true);
        return;
    }

    showLoadingOverlay();
    let secondaryApp = null;
    try {
        const tempName = `SecondaryUserCreation_${Date.now()}`;
        secondaryApp = initializeApp(firebaseConfig, tempName);
        const secondaryAuth = getAuth(secondaryApp);
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUser = userCredential.user;

        await setDoc(doc(state.db, 'users', newUser.uid), {
            email: newUser.email,
            role: role,
            department: department,
            status: 'Active',
            createdAt: serverTimestamp()
        });

        await signOut(secondaryAuth);
        showNotification(`User ${email} created successfully!`, false);
        e.target.reset();
    } catch (error) {
        console.error("Error creating user:", error);
        showNotification(error.message || "Failed to create user.", true);
    } finally {
        if (secondaryApp) {
            try { await deleteApp(secondaryApp); } catch (_) {}
        }
        hideLoadingOverlay();
    }
}

/**
 * Opens edit modal for a user.
 */
export function handleEditUser(userId) {
    if (state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to edit users.", true);
        return;
    }
    const user = state.allUsersCache.find(u => u.id === userId);
    if (!user) {
        showNotification("User not found.", true);
        return;
    }
    showUserModal(user);
}

/**
 * Saves edits to user's role, department, and status.
 */
export async function handleSaveUserEdit(e) {
    e.preventDefault();
    if (state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to edit users.", true);
        return;
    }
    const userId = document.getElementById('edit-user-id').value;
    const newRole = document.getElementById('edit-user-role').value;
    const newDept = document.getElementById('edit-user-department').value;
    const newStatus = document.getElementById('edit-user-status').value;

    if (!userId || !newRole || !newDept) {
        showNotification("All fields are required.", true);
        return;
    }

    showLoadingOverlay();
    try {
        await updateDoc(doc(state.db, 'users', userId), {
            role: newRole,
            department: newDept,
            status: newStatus
        });
        showNotification("User updated successfully!");
        hideUserModal();
    } catch (error) {
        console.error("Error updating user:", error);
        showNotification("Failed to update user.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Sends a password reset email to the specified user.
 */
export function handleResetUserPassword(userId, userEmail) {
    if (state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to reset user passwords.", true);
        return;
    }
    showConfirmModal(`Send password reset email to ${userEmail}?`, async () => {
        showLoadingOverlay();
        try {
            await sendPasswordResetEmail(state.auth, userEmail);
            showNotification(`Password reset email sent to ${userEmail}`);
        } catch (error) {
            console.error("Error sending reset email:", error);
            showNotification(error.message || "Failed to send reset email.", true);
        } finally {
            hideLoadingOverlay();
        }
    });
}

/**
 * Deletes a user document from Firestore.
 */
export function handleDeleteUser(userId, userEmail) {
    if (state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to delete users.", true);
        return;
    }
    if (userId === state.userId) {
        showNotification("You cannot delete your own administrator account.", true);
        return;
    }

    showConfirmModal(`Are you sure you want to delete user ${userEmail}? This will revoke their access.`, async () => {
        showLoadingOverlay();
        try {
            await deleteDoc(doc(state.db, 'users', userId));
            showNotification(`User ${userEmail} has been deleted.`);
        } catch (error) {
            console.error("Error deleting user:", error);
            showNotification("Failed to delete user.", true);
        } finally {
            hideLoadingOverlay();
        }
    });
}

// ============================================================================
// Purchase Request Actions
// ============================================================================

/**
 * Handles submission of a new purchase request.
 */
export async function handleRequestFormSubmit(e) {
    e.preventDefault();
    const items = Array.from(document.querySelectorAll('#items-container .item-row')).map(row => ({
        name: row.querySelector('.item-name').value.trim(),
        quantity: Number(row.querySelector('.item-quantity').value),
        unit: row.querySelector('.item-unit').value,
        price: Number(row.querySelector('.item-price').value) || 0
    })).filter(item => item.name && item.quantity > 0);

    if (items.length === 0) {
        showNotification("Please add at least one item with a valid name and quantity.", true);
        return;
    }

    // Read auto-assigned department (with fallback to user profile)
    let department = document.getElementById('req-department').value;
    if (!department) {
        department = state.userDepartment || 'Other';
    }

    const priority = document.getElementById('req-priority').value;
    const requiredBy = document.getElementById('req-date').value;
    const notes = document.getElementById('req-notes').value.trim();
    const totalCost = items.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    if (!department || !priority || !requiredBy) {
        showNotification("Please fill in all required request details.", true);
        return;
    }

    const newRequest = {
        department, priority, requiredBy, notes, items, totalCost,
        status: 'Pending',
        createdAt: serverTimestamp(),
        createdBy: state.userId,
        createdByEmail: state.auth.currentUser.email
    };

    showLoadingOverlay();
    try {
        await addDoc(collection(state.db, 'requests'), newRequest);
        showNotification("Request submitted successfully!");
        showSection('dashboard');
        e.target.reset();
        document.getElementById('items-container').innerHTML = '';
        addRequestItemRow();
        updateTotalCost();
    } catch (error) {
        console.error("Error adding request: ", error);
        showNotification("Failed to submit request.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Updates request status (Approve / Reject) with optional approval notes.
 */
export async function updateRequestStatus(id, newStatus, approvalNotes = '') {
    if (state.userRole !== 'General Manager' && state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to do this.", true);
        return;
    }
    showLoadingOverlay();
    try {
        const updateData = { status: newStatus, processedAt: serverTimestamp() };
        if (approvalNotes && approvalNotes.trim()) {
            updateData.approvalNotes = approvalNotes.trim();
        }
        await setDoc(doc(state.db, 'requests', id), updateData, { merge: true });
        showNotification(`Request has been ${newStatus.toLowerCase()}.`);
    } catch (error) {
        console.error(`Error updating request to ${newStatus}:`, error);
        showNotification("Failed to update status.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Marks a request as received and updates inventory stock.
 */
export async function markRequestAsReceived(requestId) {
    showLoadingOverlay();
    try {
        const requestDocRef = doc(state.db, 'requests', requestId);
        const requestDoc = await getDoc(requestDocRef);
        if (!requestDoc.exists()) {
            showNotification("Request not found.", true);
            return;
        }
        const requestData = requestDoc.data();

        if (requestData.createdBy !== state.userId) {
            showNotification("You can only mark your own approved requests as received.", true);
            return;
        }
        if (requestData.received) {
            showNotification("This request has already been marked as received.", true);
            return;
        }

        await setDoc(requestDocRef, { received: true, receivedAt: serverTimestamp() }, { merge: true });

        // RESTOCK: Increase inventory stock for each received item
        if (requestData.items && requestData.items.length > 0) {
            for (const item of requestData.items) {
                const itemName = item.name;
                const quantityReceived = Number(item.quantity);
                const inventoryItemQuery = query(collection(state.db, 'inventory'), where("name", "==", itemName));
                const inventorySnapshot = await getDocs(inventoryItemQuery);

                if (!inventorySnapshot.empty) {
                    const inventoryDoc = inventorySnapshot.docs[0];
                    const currentStock = inventoryDoc.data().stock;
                    const newStock = currentStock + quantityReceived;
                    await setDoc(doc(state.db, 'inventory', inventoryDoc.id), { stock: newStock }, { merge: true });
                    console.log(`Restocked ${itemName}: +${quantityReceived} units. New stock: ${newStock}`);
                } else {
                    console.warn(`Inventory item "${itemName}" not found for restocking.`);
                    showNotification(`Note: "${itemName}" is not in inventory. Stock was not updated.`, true);
                }
            }
        }
        showNotification("Marked as received and inventory updated.");
    } catch (error) {
        console.error("Error marking as received or updating inventory:", error);
        showNotification("Failed to mark as received and update inventory.", true);
    } finally {
        hideLoadingOverlay();
    }
}

// ============================================================================
// Inventory Actions
// ============================================================================

/**
 * Handles inventory item form submission (add or edit).
 */
export async function handleItemFormSubmit(e) {
    e.preventDefault();
    if (state.userRole !== 'System Administrator' && state.userRole !== 'Purchasing') {
        showNotification("You don't have permission to do this.", true);
        return;
    }
    const itemId = document.getElementById('item-id').value;
    const itemName = document.querySelector('#item-modal #item-name').value.trim();
    const itemCategory = document.getElementById('item-category').value;
    const itemStock = Number(document.getElementById('item-stock').value);
    const itemMin = Number(document.getElementById('item-min').value);
    const itemPrice = Number(document.getElementById('item-price').value);

    if (!itemName || itemStock < 0 || itemMin < 0 || itemPrice < 0) {
        showNotification("Please ensure all fields are valid (name not empty, stock/min/price non-negative).", true);
        return;
    }

    const itemData = { name: itemName, category: itemCategory, stock: itemStock, min: itemMin, price: itemPrice };

    showLoadingOverlay();
    try {
        const collectionRef = collection(state.db, 'inventory');
        if (itemId) {
            await setDoc(doc(collectionRef, itemId), itemData, { merge: true });
            showNotification("Item updated successfully!");
        } else {
            const q = query(collectionRef, where("name", "==", itemName));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                showNotification(`An inventory item with the name "${itemName}" already exists.`, true);
                hideLoadingOverlay();
                return;
            }
            await addDoc(collectionRef, itemData);
            showNotification("Item added successfully!");
        }
        hideItemModal();
    } catch (error) {
        console.error("Error saving inventory item: ", error);
        showNotification("Failed to save item.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Deletes an inventory item after confirmation.
 */
export async function deleteInventoryItem(id) {
    if (state.userRole !== 'System Administrator' && state.userRole !== 'Purchasing') {
        showNotification("You don't have permission to do this.", true);
        return;
    }
    showConfirmModal("Are you sure you want to delete this item? This action cannot be undone.", async () => {
        showLoadingOverlay();
        try {
            await deleteDoc(doc(state.db, 'inventory', id));
            showNotification("Item deleted.");
        } catch (error) {
            console.error("Error deleting item:", error);
            showNotification("Failed to delete item.", true);
        } finally {
            hideLoadingOverlay();
        }
    });
}

// ============================================================================
// Budget Actions
// ============================================================================

/**
 * Handles setting a department budget.
 */
export async function handleSetBudget() {
    if (state.userRole !== 'General Manager' && state.userRole !== 'System Administrator') {
        showNotification("You don't have permission to set budgets.", true);
        return;
    }
    const department = document.getElementById('budget-department').value;
    const monthInput = document.getElementById('budget-month').value;
    const amount = Number(document.getElementById('budget-amount').value);

    if (!department || !monthInput || amount <= 0) {
        showNotification("Please select a department, a valid month, and a positive budget amount.", true);
        return;
    }

    const budgetId = `${monthInput}_${department.replace(/\s+/g, '-')}`;

    showLoadingOverlay();
    try {
        await setDoc(doc(state.db, 'budgets', budgetId), {
            department, month: monthInput, amount,
            year: monthInput.split('-')[0],
            month_num: monthInput.split('-')[1]
        });
        showNotification(`Budget for ${department} for ${monthInput} set to $${amount.toFixed(2)}.`, false);
    } catch (error) {
        console.error("Error setting budget:", error);
        showNotification("Failed to set budget.", true);
    } finally {
        hideLoadingOverlay();
    }
}

// ============================================================================
// PDF Report Download
// ============================================================================

/**
 * Generates and downloads a PDF report.
 */
export async function downloadReportPdf() {
    try {
        showNotification("Generating PDF...", false);
        if (window.jspdf && window.jspdf.jsPDF && window.jspdf_autotable && !window.jspdf.jsPDF.API.autoTable) {
            window.jspdf.jsPDF.API.autoTable = window.jspdf_autotable;
        }
        if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable) {
            console.error("jsPDF or autotable not loaded", window.jspdf);
            showNotification("PDF generation libraries not loaded. Please refresh the page.", true);
            return;
        }

        const jsPDF = window.jspdf.jsPDF;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const margin = 15;
        const headerHeight = 25;
        const pageWidth = pdf.internal.pageSize.getWidth();
        let lastY = headerHeight;

        // Header
        pdf.setFillColor(26, 54, 93);
        pdf.rect(0, 0, pageWidth, headerHeight, 'F');
        pdf.setFontSize(16);
        pdf.setTextColor(255, 255, 255);
        pdf.text("Hotel Purchase Order System Report", margin, 15);
        pdf.setFontSize(9);
        pdf.text(`Generated on: ${new Date().toLocaleString()}`, margin, 21);

        // Summary Table
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        pdf.text("Request Summary", margin, lastY + 12);

        const summaryTable = document.querySelector('#report-summary table');
        if (summaryTable) {
            pdf.autoTable({
                html: summaryTable,
                startY: lastY + 15,
                headStyles: { fillColor: [44, 82, 130] },
                margin: { left: margin, right: margin }
            });
            lastY = pdf.lastAutoTable.finalY;
        } else {
            lastY += 30;
        }

        // Detailed Report Table
        pdf.text("Detailed Requests Log", margin, lastY + 15);

        if (!Array.isArray(state.currentFilteredRequests) || state.currentFilteredRequests.length === 0) {
            pdf.setFontSize(11);
            pdf.setTextColor(150, 0, 0);
            pdf.text("No requests found with current filters.", margin, lastY + 25);
        } else {
            const head = [['Date', 'Department', 'Total Cost', 'Requested By', 'Status']];
            const body = state.currentFilteredRequests.map(req => {
                const date = req.createdAt?.toDate().toLocaleDateString() || 'N/A';
                const requestedBy = state.allUsersCache.find(u => u.id === req.createdBy)?.email || 'N/A';
                return [date, req.department, `$${(req.totalCost || 0).toFixed(2)}`, requestedBy, req.status];
            });
            pdf.autoTable({
                head, body,
                startY: lastY + 18,
                headStyles: { fillColor: [44, 82, 130] },
                margin: { left: margin, right: margin },
                didDrawPage: (data) => {
                    pdf.setFontSize(10);
                    pdf.setTextColor(150);
                    pdf.text(`Page ${data.pageNumber}`, pageWidth / 2, pdf.internal.pageSize.getHeight() - 10, { align: 'center' });
                }
            });
        }

        pdf.save(`Hotel_PO_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        showNotification("PDF downloaded successfully!");
    } catch (err) {
        console.error('PDF generation or save failed:', err);
        showNotification("PDF could not be downloaded. See console for details.", true);
    }
}

// ============================================================================
// CSV Report Download
// ============================================================================

/**
 * Generates and downloads a CSV report from the currently filtered requests.
 */
export function downloadReportCsv() {
    try {
        if (!Array.isArray(state.currentFilteredRequests) || state.currentFilteredRequests.length === 0) {
            showNotification("No requests found with current filters. Nothing to export.", true);
            return;
        }

        const headers = ['Date', 'Department', 'Total Cost', 'Requested By', 'Status', 'Items', 'Priority', 'Notes', 'Approval Notes'];

        const escCsv = (val) => {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const rows = state.currentFilteredRequests.map(req => {
            const date = req.createdAt?.toDate().toLocaleDateString() || 'N/A';
            const requestedBy = state.allUsersCache.find(u => u.id === req.createdBy)?.email || 'N/A';
            const itemsSummary = req.items.map(i => `${i.name} x${i.quantity}`).join('; ');
            return [
                date,
                req.department,
                `$${(req.totalCost || 0).toFixed(2)}`,
                requestedBy,
                req.status,
                itemsSummary,
                req.priority || 'N/A',
                req.notes || '',
                req.approvalNotes || ''
            ].map(escCsv).join(',');
        });

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Hotel_PO_Report_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showNotification("CSV report downloaded successfully!");
    } catch (err) {
        console.error('CSV generation failed:', err);
        showNotification("CSV could not be downloaded. See console for details.", true);
    }
}

// ============================================================================
// Low-Stock Quick Order
// ============================================================================

/**
 * Finds all inventory items below minimum stock level and auto-populates
 * a new purchase request with those items and quantities to restore stock.
 */
export function handleQuickOrderLowStock() {
    const lowStockItems = state.inventoryItemsCache.filter(item => item.stock < item.min);

    if (lowStockItems.length === 0) {
        showNotification("No low-stock items to reorder. All inventory levels are healthy!", false);
        return;
    }

    // Navigate to the new-request section
    showSection('new-request');

    // Clear existing item rows
    const container = document.getElementById('items-container');
    if (!container) return;
    container.innerHTML = '';

    // Add a row for each low-stock item and pre-fill
    lowStockItems.forEach(item => {
        addRequestItemRow();
        const rows = container.querySelectorAll('.item-row');
        const lastRow = rows[rows.length - 1];

        const nameInput = lastRow.querySelector('.item-name');
        const quantityInput = lastRow.querySelector('.item-quantity');
        const priceInput = lastRow.querySelector('.item-price');
        const subtotalSpan = lastRow.querySelector('.item-subtotal');

        const deficit = item.min - item.stock;
        const qty = Math.max(deficit, 1);

        if (nameInput) nameInput.value = item.name;
        if (quantityInput) quantityInput.value = qty;
        if (priceInput) priceInput.value = item.price || 0;
        if (subtotalSpan) subtotalSpan.textContent = `$${((item.price || 0) * qty).toFixed(2)}`;
    });

    updateTotalCost();

    // Set notes to indicate this was auto-generated
    const notesField = document.getElementById('req-notes');
    if (notesField) {
        notesField.value = `Auto-generated restock order for ${lowStockItems.length} low-stock item(s).`;
    }

    showNotification(`${lowStockItems.length} low-stock item(s) added to new request. Review and submit.`, false);
}
