/**
 * Actions module — all data mutations (form submissions, CRUD, approve/reject).
 * Imports UI helpers for notifications/overlays but never does rendering.
 */

import state from './state.js';
import { firebaseConfig, ROLES, AVAILABLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from './config.js';
import {
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    sendPasswordResetEmail, initializeApp, deleteApp, getAuth,
    doc, collection, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, serverTimestamp, getDoc, getDocs
} from './firebase.js';
import {
    showLoadingOverlay, hideLoadingOverlay, showNotification,
    showSection, showConfirmModal, addRequestItemRow, updateTotalCost,
    hideItemModal, showUserModal, hideUserModal, hideIssueModal, hideReceiveModal,
    hideIssueRequisitionModal, hideOrderPOModal, hideReceiveGoodsModal,
    hasPermission, getActiveDepartments, renderPermissionsMatrix, updateUIVisibility
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
    if (!hasPermission(state.userRole, 'manage_users')) {
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
    if (!hasPermission(state.userRole, 'manage_users')) {
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
    if (!hasPermission(state.userRole, 'manage_users')) {
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
    if (!hasPermission(state.userRole, 'manage_users')) {
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
    if (!hasPermission(state.userRole, 'manage_users')) {
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
    if (!hasPermission(state.userRole, 'create_request')) {
        showNotification("You don't have permission to submit purchase requests.", true);
        return;
    }
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

    const reqTypeInput = document.querySelector('input[name="req-type"]:checked');
    const requestType = reqTypeInput ? reqTypeInput.value : (department === 'Store' || department === 'Purchasing' ? 'Purchase Order' : 'Requisition');

    if (!department || !priority || !requiredBy) {
        showNotification("Please fill in all required request details.", true);
        return;
    }

    const newRequest = {
        requestType,
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
    if (!hasPermission(state.userRole, 'approve_requests')) {
        showNotification("You don't have permission to approve or reject requests.", true);
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

        const isRestockPO = requestData.requestType === 'Purchase Order' ||
                            requestData.department === 'Store' ||
                            requestData.isRestockOrder === true;

        // Permissions:
        // - For Restock PO: Storekeeper, Admin, or the requester (Purchasing)
        // - For Department Requisition: The department requester, or Storekeeper/Admin dispensing the items
        const canFulfill = requestData.createdBy === state.userId ||
                           hasPermission(state.userRole, 'manage_inventory') ||
                           state.userRole === 'System Administrator';

        if (!canFulfill) {
            showNotification("You do not have permission to confirm receipt for this request.", true);
            return;
        }
        if (requestData.received) {
            showNotification("This request has already been marked as received.", true);
            return;
        }

        await setDoc(requestDocRef, {
            received: true,
            receivedAt: serverTimestamp(),
            receivedBy: state.userId,
            receivedByEmail: state.auth?.currentUser?.email || 'N/A'
        }, { merge: true });

        // Update inventory stock for each item
        if (requestData.items && requestData.items.length > 0) {
            for (const item of requestData.items) {
                const itemName = item.name;
                const quantity = Number(item.quantity);
                const inventoryItemQuery = query(collection(state.db, 'inventory'), where("name", "==", itemName));
                const inventorySnapshot = await getDocs(inventoryItemQuery);

                if (!inventorySnapshot.empty) {
                    const inventoryDoc = inventorySnapshot.docs[0];
                    const currentStock = Number(inventoryDoc.data().stock || 0);

                    let newStock;
                    let movementType;
                    let movementReason;

                    if (isRestockPO) {
                        // RESTOCK PO: Purchased from outside vendor -> INCREASES hotel store stock
                        newStock = currentStock + quantity;
                        movementType = 'IN';
                        movementReason = `Vendor PO Delivery Received (PO: #${requestId.substring(0, 8)})`;
                    } else {
                        // DEPARTMENT REQUISITION: Taken from store for department consumption -> DECREASES store stock
                        newStock = Math.max(0, currentStock - quantity);
                        movementType = 'OUT';
                        movementReason = `Issued to ${requestData.department || 'Department'} (Req: #${requestId.substring(0, 8)})`;
                    }

                    await setDoc(doc(state.db, 'inventory', inventoryDoc.id), { stock: newStock }, { merge: true });

                    // Log Stock movement in audit trail
                    await addDoc(collection(state.db, 'stock_movements'), {
                        itemId: inventoryDoc.id,
                        itemName: itemName,
                        category: inventoryDoc.data().category || 'General',
                        type: movementType,
                        quantity: quantity,
                        previousStock: currentStock,
                        newStock: newStock,
                        department: requestData.department || 'Store',
                        recipient: requestData.createdByEmail || state.auth?.currentUser?.email || 'Staff',
                        reason: movementReason,
                        issuedBy: state.userId,
                        issuedByEmail: state.auth?.currentUser?.email || 'N/A',
                        timestamp: serverTimestamp()
                    });

                    console.log(`Updated ${itemName}: ${movementType} ${quantity} units. New stock: ${newStock}`);
                } else {
                    console.warn(`Inventory item "${itemName}" not found in database.`);
                    showNotification(`Note: "${itemName}" is not registered in inventory.`, true);
                }
            }
        }

        if (isRestockPO) {
            showNotification("PO items received into Store! Store stock levels increased.");
        } else {
            showNotification(`Requisition fulfilled! Items issued to ${requestData.department} (store stock decreased).`);
        }
    } catch (error) {
        console.error("Error marking as received or updating inventory:", error);
        showNotification("Failed to update inventory status.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Flow B: Purchasing marks an approved PO as Ordered with supplier.
 * Separation of Duties: Purchasing NEVER edits inventory stock quantities!
 */
export async function handleMarkAsOrdered(e) {
    e.preventDefault();
    const canOrder = state.userRole === 'Purchasing' || state.userRole === 'System Administrator' || hasPermission(state.userRole, 'create_request');
    if (!canOrder) {
        showNotification("You do not have permission to place purchase orders.", true);
        return;
    }

    const reqId = document.getElementById('order-po-id').value;
    const supplier = document.getElementById('order-po-supplier').value.trim();
    const orderRef = document.getElementById('order-po-ref').value.trim();
    const deliveryDate = document.getElementById('order-po-delivery-date').value;
    const notes = document.getElementById('order-po-notes').value.trim();

    if (!reqId || !supplier || !deliveryDate) {
        showNotification("Please provide both supplier name and expected delivery date.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const updateData = {
            status: 'Ordered',
            supplier: supplier,
            orderRef: orderRef || '',
            expectedDeliveryDate: deliveryDate,
            purchasingNotes: notes || '',
            orderedAt: serverTimestamp(),
            orderedBy: state.userId,
            orderedByEmail: state.auth?.currentUser?.email || 'Purchasing Team'
        };

        await setDoc(doc(state.db, 'requests', reqId), updateData, { merge: true });
        hideOrderPOModal();
        showNotification(`Order placed with ${supplier}! Request is now Ordered. Storekeeper will receive goods upon delivery.`);
    } catch (error) {
        console.error("Error marking PO as ordered:", error);
        showNotification("Failed to update purchase order.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Flow A: Storekeeper issues items from hotel store to department.
 * Decrements inventory stock and logs an immutable audit trail entry.
 */
export async function handleIssueRequisitionSubmit(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("Only Storekeepers or Administrators can issue items from the store.", true);
        return;
    }

    const reqId = document.getElementById('issue-req-id').value;
    const recipient = document.getElementById('issue-req-recipient').value.trim();
    const issueNotes = document.getElementById('issue-req-notes').value.trim();

    if (!reqId || !recipient) {
        showNotification("Please provide the staff member / recipient name.", true);
        return;
    }

    const reqDocRef = doc(state.db, 'requests', reqId);
    showLoadingOverlay();
    try {
        const reqSnap = await getDoc(reqDocRef);
        if (!reqSnap.exists()) {
            showNotification("Requisition record not found.", true);
            return;
        }
        const reqData = reqSnap.data();
        const items = reqData.items || [];

        // Read all inputs for issued quantities
        const qtyInputs = document.querySelectorAll('#issue-requisition-form .issue-qty-input');
        const issueMap = {};
        let totalIssuedThisTime = 0;

        qtyInputs.forEach(input => {
            const idx = parseInt(input.dataset.index, 10);
            const qty = Math.max(0, parseInt(input.value, 10) || 0);
            issueMap[idx] = qty;
            totalIssuedThisTime += qty;
        });

        if (totalIssuedThisTime <= 0) {
            showNotification("Please enter at least 1 unit to issue.", true);
            return;
        }

        const updatedItems = [...items];
        const stockMovementsToLog = [];
        const inventoryUpdates = [];

        for (let i = 0; i < updatedItems.length; i++) {
            const toIssue = issueMap[i] || 0;
            if (toIssue <= 0) continue;

            const item = updatedItems[i];
            const remainingNeeded = item.quantity - (item.issuedQuantity || 0);
            if (toIssue > remainingNeeded) {
                showNotification(`Cannot issue ${toIssue} for ${item.name}; only ${remainingNeeded} remaining requested.`, true);
                return;
            }

            // Find item in inventory
            const invQuery = query(collection(state.db, 'inventory'), where("name", "==", item.name));
            const invSnap = await getDocs(invQuery);
            if (invSnap.empty) {
                showNotification(`Item "${item.name}" is not registered in hotel inventory database.`, true);
                return;
            }

            const invDoc = invSnap.docs[0];
            const invData = invDoc.data();
            const currentStock = Number(invData.stock || 0);

            if (currentStock < toIssue) {
                showNotification(`Insufficient store stock for "${item.name}". In store: ${currentStock}, attempting to issue: ${toIssue}.`, true);
                return;
            }

            const newStock = currentStock - toIssue;
            inventoryUpdates.push({
                docRef: doc(state.db, 'inventory', invDoc.id),
                newStock: newStock
            });

            stockMovementsToLog.push({
                itemId: invDoc.id,
                itemName: item.name,
                category: invData.category || reqData.department || 'General',
                type: 'OUT',
                quantity: toIssue,
                previousStock: currentStock,
                newStock: newStock,
                department: reqData.department || 'Store',
                recipient: recipient,
                reason: `Issued for Requisition #${reqId.substring(0, 8)}${issueNotes ? ' - ' + issueNotes : ''}`,
                issuedBy: state.userId,
                issuedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
                timestamp: serverTimestamp()
            });

            updatedItems[i] = {
                ...item,
                issuedQuantity: (item.issuedQuantity || 0) + toIssue
            };
        }

        // Execute inventory updates
        for (const update of inventoryUpdates) {
            await setDoc(update.docRef, { stock: update.newStock }, { merge: true });
        }

        // Execute stock movements logging
        for (const movement of stockMovementsToLog) {
            await addDoc(collection(state.db, 'stock_movements'), movement);
        }

        const allFulfilled = updatedItems.every(it => (it.issuedQuantity || 0) >= it.quantity);
        const newStatus = allFulfilled ? 'Issued' : 'Partially Issued';

        await setDoc(reqDocRef, {
            status: newStatus,
            items: updatedItems,
            lastIssuedAt: serverTimestamp(),
            lastIssuedBy: state.userId,
            lastIssuedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
            lastIssuedRecipient: recipient,
            issueNotes: issueNotes || '',
            received: allFulfilled
        }, { merge: true });

        hideIssueRequisitionModal();
        showNotification(allFulfilled
            ? `Requisition #${reqId.substring(0, 8)} fully issued to ${recipient}! Store stock decreased.`
            : `Requisition #${reqId.substring(0, 8)} partially issued (${totalIssuedThisTime} units). Store stock decreased.`
        );
    } catch (error) {
        console.error("Error issuing requisition:", error);
        showNotification("Failed to issue requisition items. Check console for details.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Flow B: Storekeeper receives PO goods from supplier into hotel store.
 * Increments inventory stock, recalculates weighted average unit cost,
 * and logs an immutable audit trail entry.
 */
export async function handleReceiveGoodsSubmit(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("Only Storekeepers or Administrators can receive goods into the store.", true);
        return;
    }

    const reqId = document.getElementById('receive-goods-po-id').value;
    const invoice = document.getElementById('receive-goods-invoice').value.trim();
    const receiveNotes = document.getElementById('receive-goods-notes').value.trim();

    if (!reqId) {
        showNotification("Invalid Purchase Order reference.", true);
        return;
    }

    const reqDocRef = doc(state.db, 'requests', reqId);
    showLoadingOverlay();
    try {
        const reqSnap = await getDoc(reqDocRef);
        if (!reqSnap.exists()) {
            showNotification("Purchase order record not found.", true);
            return;
        }
        const reqData = reqSnap.data();
        const items = reqData.items || [];

        // Read all inputs for received quantities and actual unit prices
        const qtyInputs = document.querySelectorAll('#receive-goods-form .receive-goods-qty-input');
        const priceInputs = document.querySelectorAll('#receive-goods-form .receive-goods-price-input');

        const receiveMap = {};
        let totalReceivedThisTime = 0;

        qtyInputs.forEach(input => {
            const idx = parseInt(input.dataset.index, 10);
            const qty = Math.max(0, parseInt(input.value, 10) || 0);
            receiveMap[idx] = { qty: qty };
            totalReceivedThisTime += qty;
        });

        priceInputs.forEach(input => {
            const idx = parseInt(input.dataset.index, 10);
            const price = Math.max(0, parseFloat(input.value) || 0);
            if (receiveMap[idx]) {
                receiveMap[idx].price = price;
            }
        });

        if (totalReceivedThisTime <= 0) {
            showNotification("Please specify at least 1 unit received from supplier.", true);
            return;
        }

        const updatedItems = [...items];
        const stockMovementsToLog = [];

        for (let i = 0; i < updatedItems.length; i++) {
            const entry = receiveMap[i];
            if (!entry || entry.qty <= 0) continue;

            const toReceive = entry.qty;
            const actualUnitPrice = entry.price;
            const item = updatedItems[i];

            // Look up inventory item
            const invQuery = query(collection(state.db, 'inventory'), where("name", "==", item.name));
            const invSnap = await getDocs(invQuery);

            let invDocId;
            let currentStock = 0;
            let currentPrice = 0;
            let category = reqData.department || 'Store';

            if (!invSnap.empty) {
                const invDoc = invSnap.docs[0];
                invDocId = invDoc.id;
                const invData = invDoc.data();
                currentStock = Number(invData.stock || 0);
                currentPrice = Number(invData.price || 0);
                category = invData.category || category;

                const newStock = currentStock + toReceive;
                // Weighted average unit cost calculation:
                const newPrice = currentStock > 0 && actualUnitPrice > 0
                    ? Number((((currentStock * currentPrice) + (toReceive * actualUnitPrice)) / newStock).toFixed(2))
                    : (actualUnitPrice > 0 ? actualUnitPrice : currentPrice);

                await setDoc(doc(state.db, 'inventory', invDocId), {
                    stock: newStock,
                    price: newPrice
                }, { merge: true });

                stockMovementsToLog.push({
                    itemId: invDocId,
                    itemName: item.name,
                    category: category,
                    type: 'IN',
                    quantity: toReceive,
                    previousStock: currentStock,
                    newStock: newStock,
                    unitPrice: actualUnitPrice,
                    department: 'Store',
                    supplier: reqData.supplier || 'Vendor',
                    deliveryNote: invoice || '',
                    recipient: 'Store / Warehouse',
                    reason: `PO Delivery Received (PO #${reqId.substring(0, 8)})${invoice ? ' Inv: ' + invoice : ''}${receiveNotes ? ' - ' + receiveNotes : ''}`,
                    issuedBy: state.userId,
                    issuedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
                    timestamp: serverTimestamp()
                });
            } else {
                // Create item in inventory if newly introduced
                const newStock = toReceive;
                const newPrice = actualUnitPrice > 0 ? actualUnitPrice : (item.price || 0);
                const newInvDoc = await addDoc(collection(state.db, 'inventory'), {
                    name: item.name,
                    category: category,
                    stock: newStock,
                    min: 5,
                    price: newPrice
                });
                invDocId = newInvDoc.id;

                stockMovementsToLog.push({
                    itemId: invDocId,
                    itemName: item.name,
                    category: category,
                    type: 'IN',
                    quantity: toReceive,
                    previousStock: 0,
                    newStock: newStock,
                    unitPrice: actualUnitPrice,
                    department: 'Store',
                    supplier: reqData.supplier || 'Vendor',
                    deliveryNote: invoice || '',
                    recipient: 'Store / Warehouse',
                    reason: `New Item PO Delivery (PO #${reqId.substring(0, 8)})${invoice ? ' Inv: ' + invoice : ''}`,
                    issuedBy: state.userId,
                    issuedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
                    timestamp: serverTimestamp()
                });
            }

            updatedItems[i] = {
                ...item,
                receivedQuantity: (item.receivedQuantity || 0) + toReceive,
                actualPrice: actualUnitPrice > 0 ? actualUnitPrice : item.price
            };
        }

        // Execute stock movements logging
        for (const movement of stockMovementsToLog) {
            await addDoc(collection(state.db, 'stock_movements'), movement);
        }

        const allFulfilled = updatedItems.every(it => (it.receivedQuantity || 0) >= it.quantity);
        const newStatus = allFulfilled ? 'Received' : 'Partially Received';

        await setDoc(reqDocRef, {
            status: newStatus,
            items: updatedItems,
            lastReceivedAt: serverTimestamp(),
            lastReceivedBy: state.userId,
            lastReceivedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
            deliveryNote: invoice || '',
            receiveNotes: receiveNotes || '',
            received: allFulfilled
        }, { merge: true });

        hideReceiveGoodsModal();
        showNotification(allFulfilled
            ? `PO #${reqId.substring(0, 8)} fully received into Store! Stock increased.`
            : `PO #${reqId.substring(0, 8)} partially received (${totalReceivedThisTime} units). Stock increased.`
        );
    } catch (error) {
        console.error("Error receiving goods into store:", error);
        showNotification("Failed to receive goods. Check console for details.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Normalizes existing requests in the database to adhere to Flow A / Flow B data model.
 */
export async function runOneTimeRequestAudit() {
    try {
        const snap = await getDocs(collection(state.db, 'requests'));
        let migratedCount = 0;
        for (const d of snap.docs) {
            const data = d.data();
            let needsUpdate = false;
            const update = {};

            if (!data.requestType) {
                const isPO = data.department === 'Store' || data.department === 'Purchasing' || data.isRestockOrder === true;
                update.requestType = isPO ? 'Purchase Order' : 'Requisition';
                needsUpdate = true;
            }

            if (Array.isArray(data.items)) {
                let itemsModified = false;
                const newItems = data.items.map(item => {
                    let changed = false;
                    const it = { ...item };
                    if (it.issuedQuantity === undefined) {
                        it.issuedQuantity = (data.status === 'Issued' || data.received) ? it.quantity : 0;
                        changed = true;
                    }
                    if (it.receivedQuantity === undefined) {
                        it.receivedQuantity = (data.status === 'Received' || data.received) ? it.quantity : 0;
                        changed = true;
                    }
                    if (changed) itemsModified = true;
                    return it;
                });
                if (itemsModified) {
                    update.items = newItems;
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                await setDoc(d.ref, update, { merge: true });
                migratedCount++;
            }
        }
        if (migratedCount > 0) {
            console.log(`[Audit] Checked ${snap.docs.length} requests, normalized ${migratedCount}.`);
        }
    } catch (err) {
        console.warn("[Audit] Notice:", err);
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
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to manage inventory items.", true);
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
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to delete inventory items.", true);
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

/**
 * Handles issuing stock out of the store to a department/staff member.
 * Deducts stock from inventory and logs an immutable audit trail entry.
 */
export async function handleIssueStock(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to issue inventory items.", true);
        return;
    }

    const itemId = document.getElementById('issue-item-id').value;
    const itemName = document.getElementById('issue-item-name').value;
    const itemCategory = document.getElementById('issue-item-category').value;
    const currentStock = Number(document.getElementById('issue-current-stock').value);
    const quantity = Number(document.getElementById('issue-quantity').value);
    const department = document.getElementById('issue-department').value;
    const recipient = document.getElementById('issue-recipient').value.trim();
    const reason = document.getElementById('issue-reason').value.trim();

    if (!itemId || isNaN(quantity) || quantity <= 0) {
        showNotification("Please specify a valid quantity to issue.", true);
        return;
    }

    if (quantity > currentStock) {
        showNotification(`Cannot issue ${quantity} units. Only ${currentStock} currently in store!`, true);
        return;
    }

    if (!department || !recipient) {
        showNotification("Please provide both the receiving department and staff member name.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const newStock = currentStock - quantity;

        // 1. Deduct stock from inventory
        await setDoc(doc(state.db, 'inventory', itemId), { stock: newStock }, { merge: true });

        // 2. Record Stock Out movement in audit log
        await addDoc(collection(state.db, 'stock_movements'), {
            itemId,
            itemName,
            category: itemCategory,
            type: 'OUT',
            quantity,
            previousStock: currentStock,
            newStock,
            department,
            recipient,
            reason: reason || 'Internal hotel usage',
            issuedBy: state.userId,
            issuedByEmail: state.auth?.currentUser?.email || 'N/A',
            timestamp: serverTimestamp()
        });

        hideIssueModal();
        showNotification(`Issued ${quantity} units of ${itemName} to ${recipient} (${department}). Remaining stock: ${newStock}`);
    } catch (error) {
        console.error("Error issuing stock:", error);
        showNotification("Failed to issue stock. Check console for details.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Handles receiving stock into the warehouse / store from a supplier.
 * Directly increases inventory stock and logs an immutable audit trail entry.
 */
export async function handleReceiveStock(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to receive inventory into the store.", true);
        return;
    }

    const itemId = document.getElementById('receive-item-id').value;
    const itemName = document.getElementById('receive-item-name').value;
    const itemCategory = document.getElementById('receive-item-category').value;
    const currentStock = Number(document.getElementById('receive-current-stock').value || 0);
    const quantity = Number(document.getElementById('receive-quantity').value);
    const unitPrice = Number(document.getElementById('receive-price').value || 0);
    const supplier = document.getElementById('receive-supplier').value.trim();
    const invoice = document.getElementById('receive-invoice').value.trim();
    const notes = document.getElementById('receive-notes').value.trim();

    if (!itemId || !itemName) {
        showNotification("Please select a valid inventory item to stock in.", true);
        return;
    }

    if (isNaN(quantity) || quantity <= 0) {
        showNotification("Please specify a valid positive quantity received.", true);
        return;
    }

    if (!supplier) {
        showNotification("Please provide the supplier or vendor name.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const newStock = currentStock + quantity;
        const updateData = { stock: newStock };
        if (unitPrice > 0) {
            updateData.price = unitPrice;
        }

        // 1. Update stock in inventory
        await setDoc(doc(state.db, 'inventory', itemId), updateData, { merge: true });

        // 2. Log Stock In movement in audit trail
        let fullReason = `Vendor Delivery: ${supplier}`;
        if (invoice) fullReason += ` (Ref: ${invoice})`;
        if (notes) fullReason += ` - ${notes}`;

        await addDoc(collection(state.db, 'stock_movements'), {
            itemId,
            itemName,
            category: itemCategory || 'General',
            type: 'IN',
            quantity,
            previousStock: currentStock,
            newStock,
            department: 'Store',
            recipient: 'Store / Warehouse',
            reason: fullReason,
            issuedBy: state.userId,
            issuedByEmail: state.auth?.currentUser?.email || 'N/A',
            timestamp: serverTimestamp()
        });

        hideReceiveModal();
        showNotification(`Successfully received ${quantity} units of ${itemName} into Store! New stock: ${newStock}`);
    } catch (error) {
        console.error("Error receiving stock:", error);
        showNotification("Failed to receive stock into store. Check console for details.", true);
    } finally {
        hideLoadingOverlay();
    }
}

// ============================================================================
// Budget Actions
// ============================================================================

/**
 * Handles setting a department budget.
 */
export async function handleSetBudget() {
    if (!hasPermission(state.userRole, 'manage_budgets')) {
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
    if (!hasPermission(state.userRole, 'view_reports')) {
        showNotification("You don't have permission to export reports.", true);
        return;
    }
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
    if (!hasPermission(state.userRole, 'view_reports')) {
        showNotification("You don't have permission to export reports.", true);
        return;
    }
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

    // Select Purchase Order (Supplier Restock) type and set department to Store
    const reqTypePo = document.getElementById('req-type-po');
    if (reqTypePo) reqTypePo.checked = true;

    const reqDeptHidden = document.getElementById('req-department');
    if (reqDeptHidden) reqDeptHidden.value = 'Store';
    const reqDeptDisplay = document.getElementById('req-dept-display');
    if (reqDeptDisplay) reqDeptDisplay.textContent = 'Store (Warehouse)';

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

// ============================================================================
// Hotel Settings & Permissions Actions
// ============================================================================

/**
 * Adds a new department to Firestore.
 */
export async function handleAddDepartment(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_settings')) {
        showNotification("You do not have permission to manage hotel settings.", true);
        return;
    }

    const input = document.getElementById('new-dept-name');
    if (!input) return;
    const deptName = input.value.trim();

    if (!deptName) {
        showNotification("Department name cannot be empty.", true);
        return;
    }

    // Check duplicate
    const activeDepts = getActiveDepartments();
    if (activeDepts.some(d => d.toLowerCase() === deptName.toLowerCase())) {
        showNotification(`Department "${deptName}" already exists.`, true);
        return;
    }

    showLoadingOverlay();
    try {
        await setDoc(doc(state.db, 'departments', deptName), {
            name: deptName,
            createdAt: serverTimestamp(),
            createdBy: state.userId || 'system'
        });
        input.value = '';
        showNotification(`Department "${deptName}" added successfully!`);
    } catch (error) {
        console.error("Error adding department:", error);
        showNotification("Failed to add department.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Deletes a department from Firestore after user confirmation.
 */
export async function handleDeleteDepartment(deptName) {
    if (!hasPermission(state.userRole, 'manage_settings')) {
        showNotification("You do not have permission to delete departments.", true);
        return;
    }

    const usersInDept = (state.allUsersCache || []).filter(u => u.department === deptName);
    const reqsInDept = (state.allRequestsCache || []).filter(r => r.department === deptName);

    let warning = `Are you sure you want to delete department "${deptName}"?`;
    if (usersInDept.length > 0 || reqsInDept.length > 0) {
        warning += ` Note: ${usersInDept.length} staff member(s) and ${reqsInDept.length} request(s) are linked to this department.`;
    }

    showConfirmModal(warning, async () => {
        showLoadingOverlay();
        try {
            await deleteDoc(doc(state.db, 'departments', deptName));
            showNotification(`Department "${deptName}" deleted.`);
        } catch (error) {
            console.error("Error deleting department:", error);
            showNotification("Failed to delete department.", true);
        } finally {
            hideLoadingOverlay();
        }
    });
}

/**
 * Saves customized role permissions matrix to Firestore settings/permissions.
 */
export async function handleSaveRolePermissions(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_settings')) {
        showNotification("You do not have permission to configure role permissions.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const matrixForm = document.getElementById('permissions-matrix-form');
        if (!matrixForm) return;

        const updatedPermissions = {};
        ROLES.forEach(r => { updatedPermissions[r] = []; });

        const checkboxes = matrixForm.querySelectorAll('.perm-checkbox');
        checkboxes.forEach(cb => {
            const role = cb.dataset.role;
            const perm = cb.dataset.permission;
            if (cb.checked && role && perm) {
                if (!updatedPermissions[role]) updatedPermissions[role] = [];
                if (!updatedPermissions[role].includes(perm)) {
                    updatedPermissions[role].push(perm);
                }
            }
        });

        // Ensure System Administrator always retains ALL available permissions (safety guarantee)
        updatedPermissions['System Administrator'] = AVAILABLE_PERMISSIONS.map(p => p.id);

        await setDoc(doc(state.db, 'settings', 'permissions'), updatedPermissions);
        state.rolePermissions = updatedPermissions;
        updateUIVisibility();
        showNotification("Role permissions updated successfully!");
    } catch (error) {
        console.error("Error saving role permissions:", error);
        showNotification("Failed to save permissions.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Resets all role permissions to standard hotel defaults.
 */
export function handleResetRolePermissions() {
    if (!hasPermission(state.userRole, 'manage_settings')) {
        showNotification("You do not have permission to configure role permissions.", true);
        return;
    }

    showConfirmModal("Are you sure you want to reset all role permissions to standard hotel defaults?", async () => {
        showLoadingOverlay();
        try {
            await setDoc(doc(state.db, 'settings', 'permissions'), DEFAULT_ROLE_PERMISSIONS);
            state.rolePermissions = { ...DEFAULT_ROLE_PERMISSIONS };
            updateUIVisibility();
            renderPermissionsMatrix();
            showNotification("Role permissions reset to hotel defaults.");
        } catch (error) {
            console.error("Error resetting permissions:", error);
            showNotification("Failed to reset permissions.", true);
        } finally {
            hideLoadingOverlay();
        }
    });
}
