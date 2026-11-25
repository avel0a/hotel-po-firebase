/**
 * Actions module — all data mutations (form submissions, CRUD, approve/reject).
 * Imports UI helpers for notifications/overlays but never does rendering.
 */

import state, { mergePaginatedCache } from './state.js';
import {
    firebaseConfig, ROLES, AVAILABLE_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS,
    DEFAULT_UNIT_MULTIPLIERS, DEFAULT_HOTEL_SETTINGS, COMMITTED_STATUSES,
    getUnitConversionFactor, isPurchaseRequest, normalizeRole,
    safeCsvCell, formatMoney, roundQty
} from './config.js';
import {
    signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    sendPasswordResetEmail, initializeApp, deleteApp, getAuth,
    doc, collection, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, startAfter, documentId, Timestamp,
    serverTimestamp, getDoc, getDocs, arrayUnion,
    runTransaction, writeBatch
} from './firebase.js';
import {
    showLoadingOverlay, hideLoadingOverlay, showNotification,
    showSection, showConfirmModal, addRequestItemRow, updateTotalCost, handleItemRowNameChange,
    hideItemModal, showUserModal, hideUserModal, hideIssueModal, hideReceiveModal,
    showIssueRequisitionModal, hideIssueRequisitionModal,
    showOrderPOModal, hideOrderPOModal,
    showReceiveGoodsModal, hideReceiveGoodsModal,
    showRequestDetailsModal, renderReconciliationContent, computeStockReconciliation,
    hasPermission, getActiveDepartments, renderPermissionsMatrix, updateUIVisibility,
    findInventoryItem, getHotelSettings, applyHotelBranding,
    renderDashboard, renderDashboardCharts, updateStats, renderMyRequests,
    renderApprovals, renderBudgets, applyReportFilters, renderStockMovements,
    updateSidebarBadges, renderStoreOperations, renderBackupSectionUI,
    renderRestorePreview, updateAdminBackupReminder
} from './ui.js?v=3.3';
import {
    BACKUP_COLLECTIONS, BACKUP_PLAIN_FORMAT,
    serializeFirestoreValue, deserializeFirestoreValue,
    encryptBackupPayload, decryptBackupPayload,
    isEncryptedBackupEnvelope, validateBackupDataset, sha256Hex,
    uploadEncryptedBackupToCloudinary
} from './backup.js?v=3.3';

/** Internal sentinel error to abort transactions cleanly with user-facing validation feedback. */
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

/** Builds a standardized immutable stock movement ledger entry. */
function buildMovementEntry({
    itemId, itemName, category = 'General', type, quantity,
    previousStock, newStock, unitPrice = null, department = 'Store',
    recipient = '', supplier = '', deliveryNote = '', reason = ''
}) {
    const entry = {
        itemId,
        itemName,
        category,
        type,
        quantity: roundQty(quantity),
        previousStock: roundQty(previousStock),
        newStock: roundQty(newStock),
        department,
        recipient,
        reason,
        issuedBy: state.userId,
        issuedByEmail: state.auth?.currentUser?.email || 'Staff',
        timestamp: serverTimestamp()
    };
    if (unitPrice !== null && unitPrice !== undefined) entry.unitPrice = Number(unitPrice);
    if (supplier) entry.supplier = supplier;
    if (deliveryNote) entry.deliveryNote = deliveryNote;
    return entry;
}

/**
 * Resolves an inventory document reference before entering a Firestore transaction
 * (client Web SDK transactions only permit single-doc transaction.get, not queries).
 */
async function resolveInventoryDocRef(item) {
    const cached = findInventoryItem(item);
    if (cached && cached.id) {
        return doc(state.db, 'inventory', cached.id);
    }
    const q = query(collection(state.db, 'inventory'), where("name", "==", item.name));
    const snap = await getDocs(q);
    if (!snap.empty) {
        return doc(state.db, 'inventory', snap.docs[0].id);
    }
    return null;
}

// ============================================================================
// Authentication Actions
// ============================================================================

function friendlyAuthError(error) {
    const code = error?.code || '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        return 'Incorrect email or password. Please check your credentials and try again.';
    }
    if (code === 'auth/user-disabled') {
        return 'This account has been disabled. Please contact your System Administrator.';
    }
    if (code === 'auth/too-many-requests') {
        return 'Too many failed attempts. Please wait a few minutes or reset your password.';
    }
    if (code === 'auth/invalid-email') {
        return 'Please enter a valid email address.';
    }
    return error?.message || 'Sign-in failed. Please try again.';
}

/**
 * Handles login form submission.
 */
export async function handleLogin(e) {
    e.preventDefault();
    const email = (document.getElementById('email')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    showLoadingOverlay();
    try {
        await signInWithEmailAndPassword(state.auth, email, password);
    } catch (error) {
        showNotification(friendlyAuthError(error), true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Sends a self-service password reset email from the Login screen.
 */
export async function handleForgotPassword() {
    const emailInput = document.getElementById('email');
    const email = (emailInput?.value || '').trim();
    if (!email) {
        showNotification("Enter your email address above first, then click Forgot Password?", true);
        if (emailInput) emailInput.focus();
        return;
    }
    showLoadingOverlay();
    try {
        await sendPasswordResetEmail(state.auth, email);
        showNotification(`Password reset link sent to ${email} (check spam folder if not in inbox).`);
    } catch (error) {
        showNotification(friendlyAuthError(error), true);
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
 * Revokes a staff user's access without deleting the document, preventing
 * self-registration resurrection on re-login and preserving report/audit history.
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

    showConfirmModal(`Revoke access for ${userEmail}? They will be locked out immediately while preserving audit history.`, async () => {
        showLoadingOverlay();
        try {
            await updateDoc(doc(state.db, 'users', userId), {
                status: 'Deleted',
                deletedAt: serverTimestamp(),
                deletedBy: state.userId
            });
            showNotification(`User ${userEmail} access has been revoked.`);
        } catch (error) {
            console.error("Error revoking user:", error);
            showNotification("Failed to revoke user access.", true);
        } finally {
            hideLoadingOverlay();
        }
    });
}

// ============================================================================
// Notification Helper
// ============================================================================

/**
 * Emits an in-app notification document into Firestore for staff members.
 */
export async function createInAppNotification({ recipientRole = 'All', recipientUserId = null, title, message, type = 'info', requestId = '', requestType = '', department = '' }) {
    try {
        await addDoc(collection(state.db, 'notifications'), {
            recipientRole,
            recipientUserId,
            title,
            message,
            type,
            requestId,
            requestType,
            department,
            readBy: [],
            createdAt: serverTimestamp()
        });
    } catch (e) {
        console.warn("Could not create notification:", e);
    }
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
    const items = Array.from(document.querySelectorAll('#items-container .item-row')).map(row => {
        const name = (row.querySelector('.item-name')?.value || '').trim();
        const quantity = Number(row.querySelector('.item-quantity')?.value) || 0;
        const unit = row.querySelector('.item-unit')?.value || 'Each';
        const price = Number(row.querySelector('.item-price')?.value) || 0;
        const baseUnit = row.dataset.baseUnit || unit;
        const packageSize = Number(row.dataset.packageSize) || 1;
        const conversionFactor = Number(row.dataset.conversionFactor) || 1;
        const baseQuantity = roundQty(quantity * conversionFactor);
        const matchedInv = findInventoryItem({ name });

        return {
            itemId: matchedInv?.id || null,
            name: matchedInv ? matchedInv.name : name,
            quantity,
            unit,
            price,
            baseUnit,
            packageSize,
            conversionFactor,
            baseQuantity,
            issuedQuantity: 0,
            receivedQuantity: 0
        };
    }).filter(item => item.name && item.quantity > 0);

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
    const totalCost = roundQty(items.reduce((acc, item) => acc + (item.price * item.quantity), 0), 2);

    const reqTypeInput = document.querySelector('input[name="req-type"]:checked');
    const requestType = reqTypeInput ? reqTypeInput.value : (department === 'Store' || department === 'Purchasing' ? 'Purchase Order' : 'Requisition');
    const isRequisition = requestType === 'Requisition' || requestType === 'requisition';

    if (!department || !priority || !requiredBy) {
        showNotification("Please fill in all required request details.", true);
        return;
    }

    // Flow A (Department Requisition) Validation: Items MUST exist in store inventory and have available stock
    if (isRequisition) {
        for (const item of items) {
            const invItem = findInventoryItem(item);

            if (!invItem) {
                showNotification(`Cannot submit Requisition: "${item.name}" is not in hotel store inventory. Requisitions are for existing supplies only. Please submit a Purchase Order instead.`, true);
                return;
            }

            const currentStock = Number(invItem.stock || 0);
            if (currentStock <= 0) {
                showNotification(`Cannot submit Requisition: "${item.name}" is currently Out of Stock in the store (0 ${invItem.unit || 'units'} available). Please submit a Purchase Order to restock.`, true);
                return;
            }

            const requiredBaseQty = item.baseQuantity || (item.quantity * (item.conversionFactor || 1));
            if (requiredBaseQty > currentStock) {
                showNotification(`Requested quantity for "${item.name}" (${item.quantity} ${item.unit} = ${requiredBaseQty} ${invItem.unit || ''}) exceeds available store stock (${currentStock} ${invItem.unit || ''}). Please reduce quantity or submit a Purchase Order.`, true);
                return;
            }
        }
    }

    const newRequest = {
        requestType,
        department, priority, requiredBy, notes, items, totalCost,
        status: 'Pending',
        createdAt: serverTimestamp(),
        createdBy: state.userId,
        createdByEmail: state.auth.currentUser.email
    };

    const curr = getHotelSettings().currency;
    showLoadingOverlay();
    try {
        const docRef = await addDoc(collection(state.db, 'requests'), newRequest);
        showNotification("Request submitted successfully!");

        // Emit notification to Approval Manager (General Manager / System Administrator)
        const isPO = requestType === 'Purchase Order' || requestType === 'purchase';
        await createInAppNotification({
            recipientRole: 'General Manager',
            title: isPO ? 'New Purchase Order Submitted' : 'New Department Requisition',
            message: `${department} (${state.auth.currentUser?.email || 'Staff'}) submitted request #${docRef.id.substring(0, 8)} for ${items.length} item(s) (Total: ${formatMoney(totalCost, curr)}). Awaiting approval.`,
            type: 'new_request',
            requestId: docRef.id,
            requestType: requestType,
            department: department
        });

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
        const reqDocRef = doc(state.db, 'requests', id);
        const reqSnap = await getDoc(reqDocRef);
        const reqData = reqSnap.exists() ? reqSnap.data() : (state.allRequestsCache.find(r => r.id === id) || {});

        const updateData = { status: newStatus, processedAt: serverTimestamp() };
        if (approvalNotes && approvalNotes.trim()) {
            updateData.approvalNotes = approvalNotes.trim();
        }
        await setDoc(reqDocRef, updateData, { merge: true });
        showNotification(`Request has been ${newStatus.toLowerCase()}.`);

        const isPO = reqData.requestType === 'purchase' || reqData.requestType === 'Purchase Order' || reqData.department === 'Store' || reqData.department === 'Purchasing';

        if (newStatus === 'Approved') {
            if (isPO) {
                // Flow B: Purchase Order -> Notify Purchasing Team to place order
                await createInAppNotification({
                    recipientRole: 'Purchasing',
                    title: 'Purchase Order Approved',
                    message: `PO #${id.substring(0, 8)} for ${reqData.department || 'Hotel'} approved by General Manager. Ready to place order with vendor.`,
                    type: 'approved',
                    requestId: id,
                    requestType: 'purchase',
                    department: reqData.department || 'Store'
                });
            } else {
                // Flow A: Department Requisition -> Notify Storekeeper to issue items
                await createInAppNotification({
                    recipientRole: 'Storekeeper',
                    title: 'Store Requisition Approved',
                    message: `Requisition #${id.substring(0, 8)} for ${reqData.department || 'Department'} approved by General Manager. Ready to issue goods to staff.`,
                    type: 'approved',
                    requestId: id,
                    requestType: 'requisition',
                    department: reqData.department || 'Store'
                });
            }

            // Notify original requester
            if (reqData.createdBy) {
                await createInAppNotification({
                    recipientUserId: reqData.createdBy,
                    title: `Your ${reqData.department || ''} Request Was Approved`,
                    message: `Your request #${id.substring(0, 8)} has been approved by GM.${approvalNotes ? ' Notes: ' + approvalNotes : ''}`,
                    type: 'approved',
                    requestId: id,
                    requestType: reqData.requestType || 'requisition',
                    department: reqData.department || ''
                });
            }
        } else if (newStatus === 'Rejected') {
            if (reqData.createdBy) {
                await createInAppNotification({
                    recipientUserId: reqData.createdBy,
                    title: `Your ${reqData.department || ''} Request Was Rejected`,
                    message: `Your request #${id.substring(0, 8)} was rejected.${approvalNotes ? ' Reason: ' + approvalNotes : ''}`,
                    type: 'rejected',
                    requestId: id,
                    requestType: reqData.requestType || 'requisition',
                    department: reqData.department || ''
                });
            }
        }
    } catch (error) {
        console.error(`Error updating request to ${newStatus}:`, error);
        showNotification("Failed to update status.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Legacy fallback: marks a request as received using an atomic Firestore transaction.
 * Strictly restricted to Storekeepers / System Administrators with manage_inventory permission.
 */
export async function markRequestAsReceived(requestId) {
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("Only Storekeepers or Administrators can fulfill requests and modify store inventory.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const requestDocRef = doc(state.db, 'requests', requestId);
        const preSnap = await getDoc(requestDocRef);
        if (!preSnap.exists()) {
            showNotification("Request not found.", true);
            return;
        }
        const preData = preSnap.data();
        const itemRefs = [];
        for (const item of (preData.items || [])) {
            itemRefs.push(await resolveInventoryDocRef(item));
        }

        const result = await runTransaction(state.db, async (transaction) => {
            const reqDoc = await transaction.get(requestDocRef);
            if (!reqDoc.exists()) throw new ValidationError("Request not found.");
            const requestData = reqDoc.data();
            if (requestData.received) throw new ValidationError("This request has already been marked as received.");

            const isRestockPO = isPurchaseRequest(requestData);
            const items = requestData.items || [];

            // Read phase: read all unique inventory docs
            const uniqueDocs = new Map();
            for (const ref of itemRefs) {
                if (ref && !uniqueDocs.has(ref.id)) {
                    uniqueDocs.set(ref.id, await transaction.get(ref));
                }
            }

            const runningStock = new Map();
            const invPayloads = new Map();
            uniqueDocs.forEach((snap, id) => {
                if (snap.exists()) {
                    const data = snap.data();
                    runningStock.set(id, Number(data.stock || 0));
                    invPayloads.set(id, data);
                }
            });

            const missingItems = [];
            const movements = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const ref = itemRefs[i];
                const snapData = ref ? invPayloads.get(ref.id) : null;
                if (!ref || !snapData) {
                    missingItems.push(item.name);
                    continue;
                }
                const currentStock = runningStock.get(ref.id) ?? 0;
                const quantity = roundQty(item.quantity);
                const newStock = isRestockPO
                    ? roundQty(currentStock + quantity)
                    : roundQty(Math.max(0, currentStock - quantity));

                runningStock.set(ref.id, newStock);
                movements.push(buildMovementEntry({
                    itemId: ref.id,
                    itemName: item.name,
                    category: snapData.category || 'General',
                    type: isRestockPO ? 'IN' : 'OUT',
                    quantity,
                    previousStock: currentStock,
                    newStock,
                    department: requestData.department || 'Store',
                    recipient: requestData.createdByEmail || state.auth?.currentUser?.email || 'Staff',
                    reason: isRestockPO
                        ? `Vendor PO Delivery Received (PO: #${requestId.substring(0, 8)})`
                        : `Issued to ${requestData.department || 'Department'} (Req: #${requestId.substring(0, 8)})`
                }));
            }

            // Write phase
            runningStock.forEach((stockVal, id) => {
                transaction.set(doc(state.db, 'inventory', id), { stock: stockVal }, { merge: true });
            });
            movements.forEach(m => {
                transaction.set(doc(collection(state.db, 'stock_movements')), m);
            });
            transaction.set(requestDocRef, {
                status: isRestockPO ? 'Received' : 'Issued',
                received: true,
                receivedAt: serverTimestamp(),
                receivedBy: state.userId,
                receivedByEmail: state.auth?.currentUser?.email || 'N/A'
            }, { merge: true });

            return { isRestockPO, department: requestData.department, missingItems };
        });

        result.missingItems.forEach(name => showNotification(`Note: "${name}" is not registered in inventory.`, true));
        showNotification(result.isRestockPO
            ? "PO items received into Store! Store stock levels increased."
            : `Requisition fulfilled! Items issued to ${result.department} (store stock decreased).`);
    } catch (error) {
        if (error instanceof ValidationError) {
            showNotification(error.message, true);
        } else {
            console.error("Error marking as received or updating inventory:", error);
            showNotification("Failed to update inventory status.", true);
        }
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Flow B: Purchasing marks an approved PO as Ordered with supplier.
 * Separation of Duties: Only Purchasing or System Admin can place orders; NEVER edits inventory stock.
 */
export async function handleMarkAsOrdered(e) {
    e.preventDefault();
    const normRole = normalizeRole(state.userRole);
    const canOrder = normRole === 'Purchasing' || normRole === 'System Administrator';
    if (!canOrder) {
        showNotification("Only Purchasing Officers or Administrators can place vendor purchase orders.", true);
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

        // Notify Storekeeper that goods have been ordered and will arrive
        await createInAppNotification({
            recipientRole: 'Storekeeper',
            title: 'PO Ordered with Supplier',
            message: `PO #${reqId.substring(0, 8)} ordered from ${supplier}. Expected delivery: ${deliveryDate}. Ready to receive upon arrival.`,
            type: 'ordered',
            requestId: reqId,
            requestType: 'purchase',
            department: 'Store'
        });
    } catch (error) {
        console.error("Error marking PO as ordered:", error);
        showNotification("Failed to update purchase order.", true);
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Flow A: Storekeeper issues items from hotel store to department.
 * Uses an atomic Firestore transaction to decrement stock, update requisition status,
 * and append immutable Stock Movement audit entries together.
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

    // Read all inputs for issued quantities before opening transaction
    const qtyInputs = document.querySelectorAll('#issue-requisition-form .issue-qty-input');
    const issueMap = {};
    let totalIssuedThisTime = 0;
    let anyInputAvailable = false;

    qtyInputs.forEach(input => {
        const idx = parseInt(input.dataset.index, 10);
        const max = parseFloat(input.dataset.max) || 0;
        if (max > 0) anyInputAvailable = true;
        const qty = Math.max(0, parseFloat(input.value) || 0);
        issueMap[idx] = qty;
        totalIssuedThisTime += qty;
    });

    if (totalIssuedThisTime <= 0) {
        if (!anyInputAvailable) {
            showNotification("Cannot issue: All requested items on this requisition currently have 0 store stock available. Please restock the store first.", true);
        } else {
            showNotification("Please enter at least 1 unit in the 'Issue Now' column for the item(s) you wish to dispense.", true);
        }
        return;
    }

    const reqDocRef = doc(state.db, 'requests', reqId);
    showLoadingOverlay();
    try {
        const preSnap = await getDoc(reqDocRef);
        if (!preSnap.exists()) {
            showNotification("Requisition record not found.", true);
            return;
        }
        const preItems = preSnap.data().items || [];
        const resolvedRefs = new Map();
        for (let i = 0; i < preItems.length; i++) {
            if ((issueMap[i] || 0) <= 0) continue;
            const ref = await resolveInventoryDocRef(preItems[i]);
            if (!ref) {
                showNotification(`Item "${preItems[i].name}" is not registered in hotel inventory database.`, true);
                return;
            }
            resolvedRefs.set(i, ref);
        }

        const txResult = await runTransaction(state.db, async (transaction) => {
            // Read Phase (must precede all writes in Firestore transactions)
            const reqSnap = await transaction.get(reqDocRef);
            if (!reqSnap.exists()) throw new ValidationError("Requisition record not found.");
            const reqData = reqSnap.data();
            if (reqData.status !== 'Approved' && reqData.status !== 'Partially Issued') {
                throw new ValidationError(`Requisition status is "${reqData.status}" and cannot be issued.`);
            }
            const items = reqData.items || [];

            const uniqueInvRefs = new Map();
            resolvedRefs.forEach((ref) => {
                if (!uniqueInvRefs.has(ref.id)) uniqueInvRefs.set(ref.id, ref);
            });

            const liveInventory = new Map();
            for (const [id, ref] of uniqueInvRefs.entries()) {
                const invSnap = await transaction.get(ref);
                if (!invSnap.exists()) {
                    throw new ValidationError("One of the requested inventory items no longer exists.");
                }
                const data = invSnap.data();
                liveInventory.set(id, {
                    ref,
                    data,
                    runningStock: Number(data.stock || 0)
                });
            }

            // Validation & Computation Phase
            const updatedItems = [...items];
            const movementsToWrite = [];

            for (let i = 0; i < updatedItems.length; i++) {
                const toIssue = issueMap[i] || 0;
                if (toIssue <= 0) continue;

                const item = updatedItems[i];
                const remainingNeeded = roundQty(item.quantity - (item.issuedQuantity || 0));
                if (toIssue > (remainingNeeded + 0.0001)) {
                    throw new ValidationError(`Cannot issue ${toIssue} for "${item.name}"; only ${remainingNeeded} remaining requested.`);
                }

                const ref = resolvedRefs.get(i);
                const invState = ref ? liveInventory.get(ref.id) : null;
                if (!invState) {
                    throw new ValidationError(`Item "${item.name}" is not registered in hotel inventory database.`);
                }

                const currentStock = invState.runningStock;
                const invData = invState.data;
                const conversionFactor = Number(item.conversionFactor) || getUnitConversionFactor(item.unit, invData.unit, invData.packageSize);
                const deductBaseQty = roundQty(toIssue * conversionFactor);

                if (currentStock < deductBaseQty) {
                    throw new ValidationError(`Insufficient store stock for "${item.name}". In store: ${currentStock} ${invData.unit || 'units'}, attempting to issue: ${deductBaseQty} ${invData.unit || 'units'} (${toIssue} ${item.unit}).`);
                }

                const newStock = roundQty(Math.max(0, currentStock - deductBaseQty));
                invState.runningStock = newStock;

                movementsToWrite.push(buildMovementEntry({
                    itemId: ref.id,
                    itemName: item.name,
                    category: invData.category || reqData.department || 'General',
                    type: 'OUT',
                    quantity: deductBaseQty,
                    previousStock: currentStock,
                    newStock,
                    department: reqData.department || 'Store',
                    recipient,
                    reason: `Issued ${toIssue} ${item.unit}${conversionFactor !== 1 ? ` (${deductBaseQty} ${invData.unit || 'units'})` : ''} for Requisition #${reqId.substring(0, 8)}${issueNotes ? ' - ' + issueNotes : ''}`
                }));

                updatedItems[i] = {
                    ...item,
                    issuedQuantity: roundQty((item.issuedQuantity || 0) + toIssue)
                };
            }

            const allFulfilled = updatedItems.every(it => (it.issuedQuantity || 0) >= (it.quantity - 0.0001));
            const newStatus = allFulfilled ? 'Issued' : 'Partially Issued';

            // Write Phase (all atomic within one transaction)
            liveInventory.forEach((invState) => {
                transaction.set(invState.ref, { stock: invState.runningStock }, { merge: true });
            });
            movementsToWrite.forEach((movement) => {
                transaction.set(doc(collection(state.db, 'stock_movements')), movement);
            });
            transaction.set(reqDocRef, {
                status: newStatus,
                items: updatedItems,
                lastIssuedAt: serverTimestamp(),
                lastIssuedBy: state.userId,
                lastIssuedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
                lastIssuedRecipient: recipient,
                issueNotes: issueNotes || '',
                received: allFulfilled
            }, { merge: true });

            return { allFulfilled, reqData };
        });

        hideIssueRequisitionModal();
        showNotification(txResult.allFulfilled
            ? `Requisition #${reqId.substring(0, 8)} fully issued to ${recipient}! Store stock decreased.`
            : `Requisition #${reqId.substring(0, 8)} partially issued (${totalIssuedThisTime} units). Store stock decreased.`
        );

        // Notify original requester that items were issued
        if (txResult.reqData.createdBy) {
            await createInAppNotification({
                recipientUserId: txResult.reqData.createdBy,
                title: txResult.allFulfilled ? 'Requisition Items Issued' : 'Requisition Partially Issued',
                message: `${totalIssuedThisTime} unit(s) issued for request #${reqId.substring(0, 8)} to ${recipient}. Available for pickup.`,
                type: 'issued',
                requestId: reqId,
                requestType: 'requisition',
                department: txResult.reqData.department || ''
            });
        }
    } catch (error) {
        if (error instanceof ValidationError) {
            showNotification(error.message, true);
        } else {
            console.error("Error issuing requisition:", error);
            showNotification("Failed to issue requisition items. Check console for details.", true);
        }
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Flow B: Storekeeper receives PO goods from supplier into hotel store.
 * Atomically increments inventory stock, recalculates weighted average unit cost,
 * updates PO fulfillment status, and logs immutable audit trail entries.
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

    // Read all inputs for received quantities and actual unit prices
    const qtyInputs = document.querySelectorAll('#receive-goods-form .receive-goods-qty-input');
    const priceInputs = document.querySelectorAll('#receive-goods-form .receive-goods-price-input');

    const receiveMap = {};
    let totalReceivedThisTime = 0;

    qtyInputs.forEach(input => {
        const idx = parseInt(input.dataset.index, 10);
        const qty = Math.max(0, parseFloat(input.value) || 0);
        receiveMap[idx] = { qty };
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

    const reqDocRef = doc(state.db, 'requests', reqId);
    showLoadingOverlay();
    try {
        const preSnap = await getDoc(reqDocRef);
        if (!preSnap.exists()) {
            showNotification("Purchase order record not found.", true);
            return;
        }
        const preItems = preSnap.data().items || [];
        const resolvedRefs = new Map();
        for (let i = 0; i < preItems.length; i++) {
            if (!receiveMap[i] || receiveMap[i].qty <= 0) continue;
            const ref = await resolveInventoryDocRef(preItems[i]);
            if (ref) resolvedRefs.set(i, ref);
        }

        const txResult = await runTransaction(state.db, async (transaction) => {
            // Read Phase
            const reqSnap = await transaction.get(reqDocRef);
            if (!reqSnap.exists()) throw new ValidationError("Purchase order record not found.");
            const reqData = reqSnap.data();
            if (reqData.status !== 'Ordered' && reqData.status !== 'Partially Received') {
                throw new ValidationError(`Purchase Order status is "${reqData.status}" and cannot receive goods.`);
            }
            const items = reqData.items || [];

            const uniqueInvRefs = new Map();
            resolvedRefs.forEach((ref) => {
                if (!uniqueInvRefs.has(ref.id)) uniqueInvRefs.set(ref.id, ref);
            });

            const liveInventory = new Map();
            for (const [id, ref] of uniqueInvRefs.entries()) {
                const invSnap = await transaction.get(ref);
                if (invSnap.exists()) {
                    const data = invSnap.data();
                    liveInventory.set(id, {
                        ref,
                        isNew: false,
                        data,
                        runningStock: Number(data.stock || 0),
                        runningPrice: Number(data.price || 0)
                    });
                }
            }

            // Track newly created items keyed by normalized name in case a PO repeats a new SKU
            const createdByNormName = new Map();
            const updatedItems = [...items];
            const movementsToWrite = [];

            for (let i = 0; i < updatedItems.length; i++) {
                const entry = receiveMap[i];
                if (!entry || entry.qty <= 0) continue;

                const toReceive = entry.qty;
                const actualUnitPrice = entry.price;
                const item = updatedItems[i];
                const normName = (item.name || '').trim().toLowerCase();

                const existingRef = resolvedRefs.get(i);
                let invState = existingRef ? liveInventory.get(existingRef.id) : createdByNormName.get(normName);

                if (invState) {
                    const invData = invState.data;
                    const currentStock = invState.runningStock;
                    const currentPrice = invState.runningPrice;
                    const category = invData.category || reqData.department || 'Store';

                    const conversionFactor = Number(item.conversionFactor) || getUnitConversionFactor(item.unit, invData.unit, invData.packageSize);
                    const receivedBaseQty = roundQty(toReceive * conversionFactor);
                    const effectivePrice = actualUnitPrice > 0 ? actualUnitPrice : (item.price || 0);
                    const actualBaseUnitPrice = conversionFactor > 0 ? (effectivePrice / conversionFactor) : effectivePrice;

                    const newStock = roundQty(currentStock + receivedBaseQty);
                    const newPrice = currentStock > 0 && actualBaseUnitPrice > 0
                        ? Number((((currentStock * currentPrice) + (receivedBaseQty * actualBaseUnitPrice)) / newStock).toFixed(2))
                        : (actualBaseUnitPrice > 0 ? Number(actualBaseUnitPrice.toFixed(2)) : currentPrice);

                    invState.runningStock = newStock;
                    invState.runningPrice = newPrice;

                    movementsToWrite.push(buildMovementEntry({
                        itemId: invState.ref.id,
                        itemName: item.name,
                        category,
                        type: 'IN',
                        quantity: receivedBaseQty,
                        previousStock: currentStock,
                        newStock,
                        unitPrice: Number(actualBaseUnitPrice.toFixed(2)),
                        department: 'Store',
                        supplier: reqData.supplier || 'Vendor',
                        deliveryNote: invoice || '',
                        recipient: 'Store / Warehouse',
                        reason: `PO Delivery Received (PO #${reqId.substring(0, 8)}): ${toReceive} ${item.unit}${conversionFactor !== 1 ? ` (${receivedBaseQty} ${invData.unit || 'units'} @ ${actualBaseUnitPrice.toFixed(2)}/${invData.unit || 'unit'})` : ''}${invoice ? ' Inv: ' + invoice : ''}${receiveNotes ? ' - ' + receiveNotes : ''}`
                    }));
                } else {
                    const conversionFactor = Number(item.conversionFactor) || (DEFAULT_UNIT_MULTIPLIERS[item.unit] || 1);
                    const receivedBaseQty = roundQty(toReceive * conversionFactor);
                    const effectivePrice = actualUnitPrice > 0 ? actualUnitPrice : (item.price || 0);
                    const actualBaseUnitPrice = conversionFactor > 0 ? (effectivePrice / conversionFactor) : effectivePrice;
                    const baseUnit = item.baseUnit || (conversionFactor > 1 ? 'Each' : item.unit);
                    const category = reqData.department || 'Store';
                    const newPrice = Number(actualBaseUnitPrice.toFixed(2));
                    const newRef = doc(collection(state.db, 'inventory'));

                    invState = {
                        ref: newRef,
                        isNew: true,
                        data: {
                            name: item.name,
                            category,
                            min: 5,
                            unit: baseUnit,
                            packageSize: item.packageSize || conversionFactor
                        },
                        runningStock: receivedBaseQty,
                        runningPrice: newPrice
                    };
                    liveInventory.set(newRef.id, invState);
                    createdByNormName.set(normName, invState);

                    movementsToWrite.push(buildMovementEntry({
                        itemId: newRef.id,
                        itemName: item.name,
                        category,
                        type: 'IN',
                        quantity: receivedBaseQty,
                        previousStock: 0,
                        newStock: receivedBaseQty,
                        unitPrice: newPrice,
                        department: 'Store',
                        supplier: reqData.supplier || 'Vendor',
                        deliveryNote: invoice || '',
                        recipient: 'Store / Warehouse',
                        reason: `New Item PO Delivery (PO #${reqId.substring(0, 8)}): ${toReceive} ${item.unit}${conversionFactor !== 1 ? ` (${receivedBaseQty} ${baseUnit})` : ''}${invoice ? ' Inv: ' + invoice : ''}`
                    }));
                }

                updatedItems[i] = {
                    ...item,
                    receivedQuantity: roundQty((item.receivedQuantity || 0) + toReceive),
                    actualPrice: actualUnitPrice > 0 ? actualUnitPrice : item.price
                };
            }

            const allFulfilled = updatedItems.every(it => (it.receivedQuantity || 0) >= (it.quantity - 0.0001));
            const newStatus = allFulfilled ? 'Received' : 'Partially Received';

            // Write Phase
            liveInventory.forEach((invState) => {
                if (invState.isNew) {
                    transaction.set(invState.ref, {
                        ...invState.data,
                        stock: invState.runningStock,
                        price: invState.runningPrice,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });
                } else {
                    transaction.set(invState.ref, {
                        stock: invState.runningStock,
                        price: invState.runningPrice,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                }
            });
            movementsToWrite.forEach((movement) => {
                transaction.set(doc(collection(state.db, 'stock_movements')), movement);
            });
            transaction.set(reqDocRef, {
                status: newStatus,
                items: updatedItems,
                lastReceivedAt: serverTimestamp(),
                lastReceivedBy: state.userId,
                lastReceivedByEmail: state.auth?.currentUser?.email || 'Storekeeper',
                deliveryNote: invoice || '',
                receiveNotes: receiveNotes || '',
                received: allFulfilled
            }, { merge: true });

            return { allFulfilled, reqData };
        });

        hideReceiveGoodsModal();
        showNotification(txResult.allFulfilled
            ? `PO #${reqId.substring(0, 8)} fully received into Store! Stock increased.`
            : `PO #${reqId.substring(0, 8)} partially received (${totalReceivedThisTime} units). Stock increased.`
        );

        // Notify Purchasing team that items have arrived
        await createInAppNotification({
            recipientRole: 'Purchasing',
            title: txResult.allFulfilled ? 'PO Delivery Fully Received' : 'PO Delivery Partially Received',
            message: `${totalReceivedThisTime} unit(s) received into store for PO #${reqId.substring(0, 8)}${invoice ? ' (Inv: ' + invoice + ')' : ''}.`,
            type: 'received',
            requestId: reqId,
            requestType: 'purchase',
            department: 'Store'
        });

        // Notify original requester if applicable
        if (txResult.reqData.createdBy && txResult.reqData.createdBy !== state.userId) {
            await createInAppNotification({
                recipientUserId: txResult.reqData.createdBy,
                title: 'PO Delivery Arrived in Store',
                message: `Items for purchase order #${reqId.substring(0, 8)} have been received into the store.`,
                type: 'received',
                requestId: reqId,
                requestType: 'purchase',
                department: txResult.reqData.department || ''
            });
        }
    } catch (error) {
        if (error instanceof ValidationError) {
            showNotification(error.message, true);
        } else {
            console.error("Error receiving goods into store:", error);
            showNotification("Failed to receive goods. Check console for details.", true);
        }
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Admin-only maintenance helper to normalize legacy request documents.
 */
export async function runOneTimeRequestAudit() {
    if (normalizeRole(state.userRole) !== 'System Administrator') return;
    try {
        const snap = await getDocs(collection(state.db, 'requests'));
        let migratedCount = 0;
        const batch = writeBatch(state.db);
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
                batch.set(d.ref, update, { merge: true });
                migratedCount++;
            }
        }
        if (migratedCount > 0) {
            await batch.commit();
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
 * Handles inventory item form submission (add or edit) using atomic Firestore transactions/batches.
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
    const itemUnit = document.getElementById('item-unit')?.value || 'Each';
    const itemPackageSize = Number(document.getElementById('item-package-size')?.value) || 1;
    const itemStock = roundQty(document.getElementById('item-stock').value);
    const itemMin = roundQty(document.getElementById('item-min').value);
    const itemPrice = Number(document.getElementById('item-price').value);

    if (!itemName || isNaN(itemStock) || itemStock < 0 || isNaN(itemMin) || itemMin < 0 || isNaN(itemPrice) || itemPrice < 0) {
        showNotification("Please ensure all fields are valid (name not empty, stock/min/price non-negative).", true);
        return;
    }

    const itemData = {
        name: itemName,
        category: itemCategory,
        unit: itemUnit,
        packageSize: itemPackageSize,
        stock: itemStock,
        min: itemMin,
        price: itemPrice,
        updatedAt: serverTimestamp()
    };

    const curr = getHotelSettings().currency;
    showLoadingOverlay();
    try {
        const collectionRef = collection(state.db, 'inventory');
        if (itemId) {
            const reasonInput = document.getElementById('item-adjustment-reason')?.value.trim() || '';
            const itemDocRef = doc(collectionRef, itemId);

            // Read live DB stock & price inside transaction to avoid stale DOM drift
            const { stockDiff, livePrevStock, isIncrease, qtyChanged } = await runTransaction(state.db, async (transaction) => {
                const liveSnap = await transaction.get(itemDocRef);
                if (!liveSnap.exists()) throw new ValidationError("Inventory item no longer exists.");
                const liveData = liveSnap.data();
                const prevStock = Number(liveData.stock || 0);
                const prevPrice = Number(liveData.price || 0);
                const diff = roundQty(itemStock - prevStock);
                const inc = diff > 0;
                const changed = Math.abs(diff);

                transaction.set(itemDocRef, itemData, { merge: true });

                if (changed >= 0.001) {
                    const defaultReason = inc
                        ? `Physical recount / Stock increase (+${changed} ${itemUnit})`
                        : `Physical recount / Stock decrease (-${changed} ${itemUnit})`;
                    const fullReason = reasonInput
                        ? `Manual Stock Adjustment (${inc ? '+' : '-'}${changed} ${itemUnit}): ${reasonInput}`
                        : `Manual Stock Adjustment: ${defaultReason}`;

                    transaction.set(doc(collection(state.db, 'stock_movements')), buildMovementEntry({
                        itemId,
                        itemName,
                        category: itemCategory,
                        type: inc ? 'IN' : 'OUT',
                        quantity: changed,
                        previousStock: prevStock,
                        newStock: itemStock,
                        unitPrice: itemPrice,
                        department: 'Store',
                        recipient: inc ? 'Store Restock / Stock Recount' : 'Store Write-off / Stock Recount',
                        reason: fullReason
                    }));
                } else if (prevPrice !== itemPrice) {
                    transaction.set(doc(collection(state.db, 'stock_movements')), buildMovementEntry({
                        itemId,
                        itemName,
                        category: itemCategory,
                        type: 'IN',
                        quantity: 0,
                        previousStock: prevStock,
                        newStock: itemStock,
                        unitPrice: itemPrice,
                        department: 'Store',
                        recipient: 'Store Price Revaluation',
                        reason: `Unit valuation updated: ${formatMoney(prevPrice, curr)} ➔ ${formatMoney(itemPrice, curr)}${reasonInput ? ' (' + reasonInput + ')' : ''}`
                    }));
                }

                return { stockDiff: diff, livePrevStock: prevStock, isIncrease: inc, qtyChanged: changed };
            });

            if (qtyChanged >= 0.001) {
                const defaultReason = isIncrease
                    ? `Physical recount / Stock increase (+${qtyChanged} ${itemUnit})`
                    : `Physical recount / Stock decrease (-${qtyChanged} ${itemUnit})`;
                await createInAppNotification({
                    recipientRole: 'General Manager',
                    title: `Stock Adjustment: ${itemName}`,
                    message: `${state.auth?.currentUser?.email || 'Storekeeper'} adjusted stock for "${itemName}": ${livePrevStock} ➔ ${itemStock} ${itemUnit} (${isIncrease ? '+' : '-'}${qtyChanged}). Reason: ${reasonInput || defaultReason}`,
                    type: 'info',
                    requestId: '',
                    requestType: '',
                    department: 'Store'
                });
                showNotification(`Item "${itemName}" updated. Stock adjustment (${isIncrease ? '+' : '-'}${qtyChanged} ${itemUnit}) logged to audit trail!`);
            } else {
                showNotification("Item updated successfully!");
            }
        } else {
            const existingMatch = findInventoryItem({ name: itemName });
            const q = query(collectionRef, where("name", "==", itemName));
            const querySnapshot = await getDocs(q);
            if (existingMatch || !querySnapshot.empty) {
                showNotification(`An inventory item matching "${itemName}" already exists.`, true);
                return;
            }

            const batch = writeBatch(state.db);
            const newDocRef = doc(collectionRef);
            batch.set(newDocRef, { ...itemData, createdAt: serverTimestamp() });
            if (itemStock > 0) {
                batch.set(doc(collection(state.db, 'stock_movements')), buildMovementEntry({
                    itemId: newDocRef.id,
                    itemName,
                    category: itemCategory,
                    type: 'IN',
                    quantity: itemStock,
                    previousStock: 0,
                    newStock: itemStock,
                    unitPrice: itemPrice,
                    department: 'Store',
                    recipient: 'Store Warehouse / Initial Setup',
                    reason: `Initial Opening Stock Registered (+${itemStock} ${itemUnit})`
                }));
            }
            await batch.commit();
            showNotification("Item added successfully with initial stock logged!");
        }
        hideItemModal();
    } catch (error) {
        if (error instanceof ValidationError) {
            showNotification(error.message, true);
        } else {
            console.error("Error saving inventory item: ", error);
            showNotification("Failed to save item.", true);
        }
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Deletes an inventory item atomically after writing off remaining stock to the ledger.
 */
export async function deleteInventoryItem(id) {
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to delete inventory items.", true);
        return;
    }
    showConfirmModal("Are you sure you want to delete this item? This action cannot be undone.", async () => {
        showLoadingOverlay();
        try {
            const itemDocRef = doc(state.db, 'inventory', id);
            await runTransaction(state.db, async (transaction) => {
                const snap = await transaction.get(itemDocRef);
                if (!snap.exists()) return;
                const data = snap.data();
                const remainingStock = roundQty(data.stock || 0);
                if (remainingStock > 0) {
                    transaction.set(doc(collection(state.db, 'stock_movements')), buildMovementEntry({
                        itemId: id,
                        itemName: data.name || 'Deleted Item',
                        category: data.category || 'Store',
                        type: 'OUT',
                        quantity: remainingStock,
                        previousStock: remainingStock,
                        newStock: 0,
                        unitPrice: Number(data.price || 0),
                        department: 'Store',
                        recipient: 'Item Deletion / Write-off',
                        reason: `Item removed from inventory catalog (Stock written off: ${remainingStock} ${data.unit || 'units'})`
                    }));
                }
                transaction.delete(itemDocRef);
            });
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
 * Handles issuing stock out of the store to a department/staff member atomically.
 */
export async function handleIssueStock(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to issue inventory items.", true);
        return;
    }

    const itemId = document.getElementById('issue-item-id').value;
    const quantity = roundQty(document.getElementById('issue-quantity').value);
    const department = document.getElementById('issue-department').value;
    const recipient = document.getElementById('issue-recipient').value.trim();
    const reason = document.getElementById('issue-reason').value.trim();

    if (!itemId || isNaN(quantity) || quantity <= 0) {
        showNotification("Please specify a valid quantity to issue.", true);
        return;
    }
    if (!department || !recipient) {
        showNotification("Please provide both the receiving department and staff member name.", true);
        return;
    }

    const itemDocRef = doc(state.db, 'inventory', itemId);
    showLoadingOverlay();
    try {
        const { itemName, newStock } = await runTransaction(state.db, async (transaction) => {
            const snap = await transaction.get(itemDocRef);
            if (!snap.exists()) throw new ValidationError("Inventory item not found.");
            const data = snap.data();
            const liveStock = Number(data.stock || 0);
            if (quantity > liveStock) {
                throw new ValidationError(`Cannot issue ${quantity} units. Only ${liveStock} currently in store!`);
            }
            const nextStock = roundQty(liveStock - quantity);
            transaction.set(itemDocRef, { stock: nextStock, updatedAt: serverTimestamp() }, { merge: true });
            transaction.set(doc(collection(state.db, 'stock_movements')), buildMovementEntry({
                itemId,
                itemName: data.name || 'Item',
                category: data.category || 'General',
                type: 'OUT',
                quantity,
                previousStock: liveStock,
                newStock: nextStock,
                department,
                recipient,
                reason: reason || 'Internal hotel usage'
            }));
            return { itemName: data.name || 'Item', newStock: nextStock };
        });

        hideIssueModal();
        showNotification(`Issued ${quantity} units of ${itemName} to ${recipient} (${department}). Remaining stock: ${newStock}`);
    } catch (error) {
        if (error instanceof ValidationError) {
            showNotification(error.message, true);
        } else {
            console.error("Error issuing stock:", error);
            showNotification("Failed to issue stock. Check console for details.", true);
        }
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Handles receiving stock directly into the warehouse atomically.
 */
export async function handleReceiveStock(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You don't have permission to receive inventory into the store.", true);
        return;
    }

    const itemId = document.getElementById('receive-item-id').value;
    const quantity = roundQty(document.getElementById('receive-quantity').value);
    const unitPrice = Number(document.getElementById('receive-price').value || 0);
    const supplier = document.getElementById('receive-supplier').value.trim();
    const invoice = document.getElementById('receive-invoice').value.trim();
    const notes = document.getElementById('receive-notes').value.trim();

    if (!itemId) {
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

    let fullReason = `Vendor Delivery: ${supplier}`;
    if (invoice) fullReason += ` (Ref: ${invoice})`;
    if (notes) fullReason += ` - ${notes}`;

    const itemDocRef = doc(state.db, 'inventory', itemId);
    showLoadingOverlay();
    try {
        const { itemName, newStock } = await runTransaction(state.db, async (transaction) => {
            const snap = await transaction.get(itemDocRef);
            if (!snap.exists()) throw new ValidationError("Inventory item not found.");
            const data = snap.data();
            const liveStock = Number(data.stock || 0);
            const livePrice = Number(data.price || 0);
            const nextStock = roundQty(liveStock + quantity);

            const updateData = { stock: nextStock, updatedAt: serverTimestamp() };
            if (unitPrice > 0) {
                updateData.price = liveStock > 0
                    ? Number((((liveStock * livePrice) + (quantity * unitPrice)) / nextStock).toFixed(2))
                    : Number(unitPrice.toFixed(2));
            }

            transaction.set(itemDocRef, updateData, { merge: true });
            transaction.set(doc(collection(state.db, 'stock_movements')), buildMovementEntry({
                itemId,
                itemName: data.name || 'Item',
                category: data.category || 'General',
                type: 'IN',
                quantity,
                previousStock: liveStock,
                newStock: nextStock,
                unitPrice: unitPrice > 0 ? Number(unitPrice.toFixed(2)) : livePrice,
                department: 'Store',
                supplier,
                deliveryNote: invoice || '',
                recipient: 'Store / Warehouse',
                reason: fullReason
            }));
            return { itemName: data.name || 'Item', newStock: nextStock };
        });

        hideReceiveModal();
        showNotification(`Successfully received ${quantity} units of ${itemName} into Store! New stock: ${newStock}`);
    } catch (error) {
        if (error instanceof ValidationError) {
            showNotification(error.message, true);
        } else {
            console.error("Error receiving stock:", error);
            showNotification("Failed to receive stock into store. Check console for details.", true);
        }
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

    const curr = getHotelSettings().currency;
    showLoadingOverlay();
    try {
        await setDoc(doc(state.db, 'budgets', budgetId), {
            department, month: monthInput, amount,
            year: monthInput.split('-')[0],
            month_num: monthInput.split('-')[1],
            updatedAt: serverTimestamp()
        }, { merge: true });
        showNotification(`Budget for ${department} for ${monthInput} set to ${formatMoney(amount, curr)}.`, false);
    } catch (error) {
        console.error("Error setting budget:", error);
        showNotification("Failed to set budget.", true);
    } finally {
        hideLoadingOverlay();
    }
}

// ============================================================================
// PDF & CSV Exports (+ Individual Official PO / Requisition Vouchers)
// ============================================================================

function getJsPdfInstance() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf_autotable && !window.jspdf.jsPDF.API.autoTable) {
        window.jspdf.jsPDF.API.autoTable = window.jspdf_autotable;
    }
    if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable) {
        return null;
    }
    return window.jspdf.jsPDF;
}

/**
 * Generates and downloads a branded PDF summary report.
 */
export async function downloadReportPdf() {
    if (!hasPermission(state.userRole, 'view_reports')) {
        showNotification("You don't have permission to export reports.", true);
        return;
    }
    try {
        showNotification("Generating PDF...", false);
        const jsPDF = getJsPdfInstance();
        if (!jsPDF) {
            showNotification("PDF generation libraries not loaded. Please refresh the page.", true);
            return;
        }

        const cfg = getHotelSettings();
        const pdf = new jsPDF('p', 'mm', 'a4');
        const margin = 15;
        const headerHeight = 26;
        const pageWidth = pdf.internal.pageSize.getWidth();
        let lastY = headerHeight;

        pdf.setFillColor(26, 54, 93);
        pdf.rect(0, 0, pageWidth, headerHeight, 'F');
        pdf.setFontSize(16);
        pdf.setTextColor(255, 255, 255);
        pdf.text(`${cfg.hotelName} — Procurement Report`, margin, 14);
        pdf.setFontSize(9);
        pdf.text(`Generated on: ${new Date().toLocaleString()}${cfg.hotelAddress ? '  |  ' + cfg.hotelAddress : ''}`, margin, 21);

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
            const head = [['Date', 'Type', 'Department', 'Total Cost', 'Requested By', 'Status']];
            const body = state.currentFilteredRequests.map(req => {
                const date = req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString() : 'N/A';
                const typeLabel = isPurchaseRequest(req) ? 'PO' : 'Req';
                const requestedBy = state.allUsersCache.find(u => u.id === req.createdBy)?.email || req.createdByEmail || 'N/A';
                return [date, typeLabel, req.department, formatMoney(req.totalCost || 0, cfg.currency), requestedBy, req.status];
            });
            pdf.autoTable({
                head, body,
                startY: lastY + 18,
                headStyles: { fillColor: [44, 82, 130] },
                margin: { left: margin, right: margin },
                didDrawPage: (data) => {
                    pdf.setFontSize(9);
                    pdf.setTextColor(140);
                    pdf.text(`${cfg.footerNote} — Page ${data.pageNumber}`, pageWidth / 2, pdf.internal.pageSize.getHeight() - 10, { align: 'center' });
                }
            });
        }

        const safeName = cfg.hotelName.replace(/[^a-z0-9]/gi, '_');
        pdf.save(`${safeName}_Report_${new Date().toISOString().split('T')[0]}.pdf`);
        showNotification("PDF downloaded successfully!");
    } catch (err) {
        console.error('PDF generation or save failed:', err);
        showNotification("PDF could not be downloaded. See console for details.", true);
    }
}

/**
 * Generates an official printable Purchase Order (Flow B) or Store Issue Slip (Flow A)
 * with signature lines for vendor orders, receiving, and internal custody audit.
 */
export function downloadRequestVoucherPdf(requestId) {
    const req = (state.allRequestsCache || []).find(r => r.id === requestId);
    if (!req) {
        showNotification("Request details not found.", true);
        return;
    }

    const jsPDF = getJsPdfInstance();
    if (!jsPDF) {
        showNotification("PDF generation libraries not loaded. Please refresh the page.", true);
        return;
    }

    try {
        const cfg = getHotelSettings();
        const isPO = isPurchaseRequest(req);
        const docTitle = isPO ? 'PURCHASE ORDER' : 'STORE REQUISITION & ISSUE SLIP';
        const pdf = new jsPDF('p', 'mm', 'a4');
        const margin = 15;
        const pageWidth = pdf.internal.pageSize.getWidth();

        // Top Banner
        pdf.setFillColor(26, 54, 93);
        pdf.rect(0, 0, pageWidth, 28, 'F');
        pdf.setFontSize(16);
        pdf.setTextColor(255, 255, 255);
        pdf.text(cfg.hotelName, margin, 13);
        pdf.setFontSize(10);
        pdf.text(docTitle, margin, 21);
        pdf.setFontSize(9);
        pdf.text(`Ref: #${req.id.substring(0, 8).toUpperCase()}`, pageWidth - margin, 13, { align: 'right' });
        pdf.text(`Status: ${req.status || 'Pending'}`, pageWidth - margin, 21, { align: 'right' });

        if (cfg.hotelAddress) {
            pdf.setTextColor(90);
            pdf.setFontSize(8.5);
            pdf.text(cfg.hotelAddress, margin, 34);
        }

        // Metadata Grid
        const metaStartY = cfg.hotelAddress ? 40 : 36;
        const createdStr = req.createdAt?.toDate ? req.createdAt.toDate().toLocaleString() : 'N/A';
        const metaRows = [
            ['Department:', req.department || 'N/A', 'Priority:', req.priority || 'Normal'],
            ['Requested By:', req.createdByEmail || 'N/A', 'Date Submitted:', createdStr],
            ['Required By:', req.requiredBy || 'N/A', isPO ? 'Supplier:' : 'Issued To:', isPO ? (req.supplier || 'TBD') : (req.lastIssuedRecipient || 'Pending Issue')]
        ];
        if (isPO && (req.orderRef || req.deliveryNote)) {
            metaRows.push(['Order Ref:', req.orderRef || 'N/A', 'Delivery Inv #:', req.deliveryNote || 'Pending']);
        }

        pdf.autoTable({
            body: metaRows,
            startY: metaStartY,
            theme: 'grid',
            styles: { fontSize: 8.5, cellPadding: 2.5 },
            columnStyles: {
                0: { fontStyle: 'bold', fillColor: [244, 246, 249], cellWidth: 28 },
                1: { cellWidth: 62 },
                2: { fontStyle: 'bold', fillColor: [244, 246, 249], cellWidth: 28 },
                3: { cellWidth: 62 }
            },
            margin: { left: margin, right: margin }
        });

        let cursorY = pdf.lastAutoTable.finalY + 8;

        // Line Items
        const head = isPO
            ? [['#', 'Item Description', 'Unit', 'Ordered', 'Received', 'Unit Price', 'Line Total']]
            : [['#', 'Item Description', 'Unit', 'Requested', 'Issued', 'Est. Unit Price', 'Est. Total']];

        const body = (req.items || []).map((it, idx) => {
            const qty = Number(it.quantity || 0);
            const fulfilled = isPO ? Number(it.receivedQuantity || 0) : Number(it.issuedQuantity || 0);
            const unitPrice = Number((isPO && it.actualPrice > 0) ? it.actualPrice : (it.price || 0));
            return [
                idx + 1,
                it.name || '',
                it.unit || 'Each',
                qty,
                fulfilled,
                formatMoney(unitPrice, cfg.currency),
                formatMoney(unitPrice * qty, cfg.currency)
            ];
        });

        pdf.autoTable({
            head,
            body,
            startY: cursorY,
            headStyles: { fillColor: [44, 82, 130], fontSize: 8.5 },
            styles: { fontSize: 8.5 },
            columnStyles: {
                0: { halign: 'center', cellWidth: 10 },
                3: { halign: 'center' },
                4: { halign: 'center' },
                5: { halign: 'right' },
                6: { halign: 'right', fontStyle: 'bold' }
            },
            margin: { left: margin, right: margin }
        });

        cursorY = pdf.lastAutoTable.finalY + 6;
        pdf.setFontSize(11);
        pdf.setTextColor(26, 54, 93);
        pdf.text(`Total Estimated Value: ${formatMoney(req.totalCost || 0, cfg.currency)}`, pageWidth - margin, cursorY, { align: 'right' });

        if (req.notes || req.approvalNotes) {
            cursorY += 8;
            pdf.setFontSize(8.5);
            pdf.setTextColor(70);
            if (req.notes) {
                pdf.text(`Notes: ${req.notes}`, margin, cursorY, { maxWidth: pageWidth - margin * 2 });
                cursorY += 6;
            }
            if (req.approvalNotes) {
                pdf.text(`GM Approval Notes: ${req.approvalNotes}`, margin, cursorY, { maxWidth: pageWidth - margin * 2 });
            }
        }

        // Signature Block at bottom
        const sigY = Math.max(cursorY + 24, 240);
        const colW = (pageWidth - margin * 2) / 3;
        pdf.setDrawColor(160);
        pdf.setFontSize(8.5);
        pdf.setTextColor(80);
        const labels = isPO
            ? ['Prepared By (Purchasing)', 'Approved By (General Manager)', 'Received By (Storekeeper)']
            : ['Requested By (Dept Staff)', 'Approved By (General Manager)', 'Issued By (Storekeeper) / Recipient'];
        labels.forEach((lbl, idx) => {
            const x1 = margin + idx * colW + 3;
            const x2 = margin + (idx + 1) * colW - 3;
            pdf.line(x1, sigY, x2, sigY);
            pdf.text(lbl, (x1 + x2) / 2, sigY + 5, { align: 'center' });
        });

        pdf.setFontSize(8);
        pdf.setTextColor(150);
        pdf.text(`${cfg.footerNote} — Generated ${new Date().toLocaleString()}`, pageWidth / 2, pdf.internal.pageSize.getHeight() - 8, { align: 'center' });

        const prefix = isPO ? 'PO' : 'Requisition_Slip';
        pdf.save(`${prefix}_${req.id.substring(0, 8)}.pdf`);
        showNotification(`${isPO ? 'Purchase Order' : 'Requisition Slip'} PDF downloaded!`);
    } catch (err) {
        console.error('Voucher PDF error:', err);
        showNotification("Could not generate voucher PDF.", true);
    }
}

// ============================================================================
// CSV Report Download
// ============================================================================

/**
 * Generates and downloads a formula-safe CSV report from currently filtered requests.
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

        const cfg = getHotelSettings();
        const headers = ['Date', 'Type', 'Department', 'Total Cost', 'Requested By', 'Supplier', 'Status', 'Items', 'Priority', 'Notes', 'Approval Notes'];

        const rows = state.currentFilteredRequests.map(req => {
            const date = req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString() : 'N/A';
            const typeLabel = isPurchaseRequest(req) ? 'Purchase Order' : 'Department Requisition';
            const requestedBy = state.allUsersCache.find(u => u.id === req.createdBy)?.email || req.createdByEmail || 'N/A';
            const itemsSummary = (req.items || []).map(i => `${i.name} x${i.quantity} ${i.unit || ''}`).join('; ');
            return [
                date,
                typeLabel,
                req.department,
                formatMoney(req.totalCost || 0, cfg.currency),
                requestedBy,
                req.supplier || '',
                req.status,
                itemsSummary,
                req.priority || 'N/A',
                req.notes || '',
                req.approvalNotes || ''
            ].map(safeCsvCell).join(',');
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
 * a new Purchase Order (Restock) with those items and unit metadata.
 */
export function handleQuickOrderLowStock() {
    const lowStockItems = (state.inventoryItemsCache || []).filter(item => item.stock < item.min);

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

    // Add a row for each low-stock item and pre-fill unit/price metadata
    const curr = getHotelSettings().currency;
    lowStockItems.forEach(item => {
        addRequestItemRow();
        const rows = container.querySelectorAll('.item-row');
        const lastRow = rows[rows.length - 1];

        const nameInput = lastRow.querySelector('.item-name');
        const quantityInput = lastRow.querySelector('.item-quantity');
        const priceInput = lastRow.querySelector('.item-price');
        const subtotalSpan = lastRow.querySelector('.item-subtotal');

        const deficit = Number(item.min || 0) - Number(item.stock || 0);
        const qty = Math.max(Math.ceil(deficit), 1);

        if (nameInput) nameInput.value = item.name;
        handleItemRowNameChange(lastRow);
        if (quantityInput) quantityInput.value = qty;
        const unitPrice = parseFloat(priceInput?.value) || Number(item.price || 0);
        if (subtotalSpan) subtotalSpan.textContent = formatMoney(unitPrice * qty, curr);
    });

    updateTotalCost();

    const notesField = document.getElementById('req-notes');
    if (notesField) {
        notesField.value = `Auto-generated restock order for ${lowStockItems.length} low-stock item(s).`;
    }

    showNotification(`${lowStockItems.length} low-stock item(s) added to new Purchase Order. Review and submit.`, false);
}

// ============================================================================
// Hotel Settings & Permissions Actions
// ============================================================================

/**
 * Saves white-label hotel identity, currency, address, and voucher footer to Firestore settings/general.
 */
export async function handleSaveHotelSettings(e) {
    e.preventDefault();
    if (!hasPermission(state.userRole, 'manage_settings')) {
        showNotification("You do not have permission to configure hotel settings.", true);
        return;
    }

    const hotelName = (document.getElementById('setting-hotel-name')?.value || '').trim();
    const currency = (document.getElementById('setting-currency')?.value || '').trim();
    const hotelAddress = (document.getElementById('setting-hotel-address')?.value || '').trim();
    const footerNote = (document.getElementById('setting-footer-note')?.value || '').trim();

    if (!hotelName || !currency) {
        showNotification("Hotel Name and Currency Label are required.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const payload = {
            hotelName,
            currency,
            hotelAddress,
            footerNote: footerNote || DEFAULT_HOTEL_SETTINGS.footerNote,
            updatedAt: serverTimestamp(),
            updatedBy: state.userId || 'admin'
        };
        await setDoc(doc(state.db, 'settings', 'general'), payload, { merge: true });
        state.hotelSettings = { ...DEFAULT_HOTEL_SETTINGS, hotelName, currency, hotelAddress, footerNote: payload.footerNote };
        applyHotelBranding();
        updateTotalCost();
        showNotification("Hotel identity & currency settings updated!");
    } catch (error) {
        console.error("Error saving hotel branding settings:", error);
        showNotification("Failed to save hotel settings.", true);
    } finally {
        hideLoadingOverlay();
    }
}

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

// ============================================================================
// Notification Actions
// ============================================================================

/**
 * Marks all notifications visible to the current user as read.
 */
export async function handleMarkAllNotificationsRead() {
    if (!state.userId) return;
    try {
        const unreadNotifs = (state.notificationsCache || []).filter(n => {
            const isTarget = n.recipientRole === 'All' ||
                n.recipientRole === state.userRole ||
                n.recipientUserId === state.userId ||
                state.userRole === 'System Administrator';
            const isRead = Array.isArray(n.readBy) && n.readBy.includes(state.userId);
            return isTarget && !isRead;
        });

        for (const notif of unreadNotifs) {
            await updateDoc(doc(state.db, 'notifications', notif.id), {
                readBy: arrayUnion(state.userId)
            });
        }
        showNotification("All notifications marked as read.");
    } catch (err) {
        console.error("Error marking notifications as read:", err);
    }
}

/**
 * Handles clicking a notification: marks it read and navigates directly to the relevant action or request.
 */
export async function handleNotificationClick(notifId, requestId) {
    if (!state.userId || !notifId) return;
    try {
        await updateDoc(doc(state.db, 'notifications', notifId), {
            readBy: arrayUnion(state.userId)
        });
    } catch (e) {
        console.warn("Could not mark notification read:", e);
    }

    if (requestId) {
        const req = (state.allRequestsCache || []).find(r => r.id === requestId);
        if (req) {
            const isRequisition = req.requestType === 'requisition' || req.requestType === 'Requisition';
            const isPO = req.requestType === 'purchase' || req.requestType === 'Purchase Order';
            const isStoreStaff = state.userRole === 'Storekeeper' || state.userRole === 'Store Keeper' || state.userRole === 'System Administrator';
            const isPurchasingStaff = state.userRole === 'Purchasing' || state.userRole === 'System Administrator';
            const isGMStaff = state.userRole === 'General Manager' || state.userRole === 'System Administrator';

            // 1. If Requisition is Approved or Partially Issued -> Open Issue Modal for Storekeeper!
            if (isRequisition && (req.status === 'Approved' || req.status === 'Partially Issued') && isStoreStaff) {
                showIssueRequisitionModal(req);
                return;
            }

            // 2. If PO is Ordered or Partially Received -> Open Receive Goods Modal for Storekeeper!
            if (isPO && (req.status === 'Ordered' || req.status === 'Partially Received') && isStoreStaff) {
                showReceiveGoodsModal(req);
                return;
            }

            // 3. If PO is Approved -> Open Place Order Modal for Purchasing!
            if (isPO && req.status === 'Approved' && isPurchasingStaff) {
                showOrderPOModal(req);
                return;
            }

            // 4. If request is Pending and user can approve -> Go to Approvals section!
            if (req.status === 'Pending' && isGMStaff) {
                showSection('approvals');
                return;
            }

            // 5. Default -> Open full Request Details Modal!
            showRequestDetailsModal(req);
            return;
        }

        // Fallback navigation if request not found in recent memory cache
        if (state.userRole === 'General Manager') {
            showSection('approvals');
        } else if (state.userRole === 'Storekeeper' || state.userRole === 'Store Keeper') {
            showSection('inventory');
        } else {
            showSection('my-requests');
        }
    }
}

/**
 * Reconciles variances between physical System Stock and Computed Stock (Total IN - Total OUT).
 * Works both for pre-existing items with 0 movements (opening baseline) and items that had
 * prior stock before movement tracking began (recording the exact missing variance).
 */
let isReconciling = false;

/**
 * Reconciles variances between physical System Stock and Computed Stock (Total IN - Total OUT)
 * using atomic batched writes and an in-flight guard against double-clicks.
 */
export async function handleBaselineOpeningStock(itemId = null) {
    if (!hasPermission(state.userRole, 'manage_inventory')) {
        showNotification("You do not have permission to configure inventory baselines.", true);
        return;
    }
    if (isReconciling) return;

    // Ensure full historical movement ledger is loaded before calculating variances
    if (state.stockMovementsHasMore) {
        const res = await loadMoreStockMovements({ loadAll: true, silent: true });
        if (!res.complete) {
            showNotification("Could not load complete movement history. Load full ledger first before reconciling.", true);
            return;
        }
    }

    const reconRows = computeStockReconciliation();
    const itemsToProcess = itemId
        ? reconRows.filter(r => r.id === itemId && !r.isMatch)
        : reconRows.filter(r => !r.isMatch);

    if (itemsToProcess.length === 0) {
        showNotification("All inventory items are already 100% balanced!");
        return;
    }

    isReconciling = true;
    showLoadingOverlay();
    try {
        let count = 0;
        const invMap = new Map((state.inventoryItemsCache || []).map(i => [i.id, i]));
        const entries = [];

        for (const r of itemsToProcess) {
            const diff = roundQty(r.difference || 0);
            if (Math.abs(diff) < 0.001) continue;

            const invItem = invMap.get(r.id);
            const unitLabel = invItem?.unit || 'units';
            const isIncoming = diff > 0;
            const adjustQty = Math.abs(diff);

            const reason = r.movementCount === 0
                ? `Initial Baseline Opening Balance (+${adjustQty} ${unitLabel})`
                : (isIncoming
                    ? `Reconciliation Opening Balance Adjustment (+${adjustQty} ${unitLabel})`
                    : `Physical Count Reconciliation Adjustment (-${adjustQty} ${unitLabel})`);

            entries.push(buildMovementEntry({
                itemId: r.id,
                itemName: r.name,
                category: r.category || 'General',
                type: isIncoming ? 'IN' : 'OUT',
                quantity: adjustQty,
                previousStock: r.computedStock,
                newStock: r.systemStock,
                unitPrice: Number(r.price || 0),
                department: 'Store',
                recipient: 'Store Warehouse Reconciliation',
                reason
            }));
            count++;
        }

        // Commit atomically in chunks of <= 400 (Firestore batch limit is 500)
        for (let i = 0; i < entries.length; i += 400) {
            const batch = writeBatch(state.db);
            entries.slice(i, i + 400).forEach(entry => {
                batch.set(doc(collection(state.db, 'stock_movements')), entry);
            });
            await batch.commit();
        }

        showNotification(`Successfully reconciled ${count} item(s)! Ledger is now 100% balanced.`);
        if (typeof renderReconciliationContent === 'function') {
            renderReconciliationContent();
        }
    } catch (err) {
        console.error("Error reconciling stock variance:", err);
        showNotification("Failed to reconcile stock variance.", true);
    } finally {
        isReconciling = false;
        hideLoadingOverlay();
    }
}

// ============================================================================
// Cursor Pagination (Prevents UI Freezing & Excess Reads at Scale)
// ============================================================================

let isLoadingOlderRequests = false;
let isLoadingOlderMovements = false;

export async function loadMoreRequests() {
    if (isLoadingOlderRequests || !state.requestsHasMore || !state.requestsLastDoc) return;
    isLoadingOlderRequests = true;
    showLoadingOverlay();
    try {
        const normRole = normalizeRole(state.userRole);
        const canViewAllRequests = hasPermission(state.userRole, 'view_all_requests') ||
            hasPermission(state.userRole, 'approve_requests') ||
            hasPermission(state.userRole, 'manage_inventory') ||
            hasPermission(state.userRole, 'view_reports');

        const nextQ = canViewAllRequests
            ? query(
                collection(state.db, 'requests'),
                orderBy("createdAt", "desc"),
                startAfter(state.requestsLastDoc),
                limit(state.requestsPageSize)
            )
            : query(
                collection(state.db, 'requests'),
                where("createdBy", "==", state.userId),
                orderBy("createdAt", "desc"),
                startAfter(state.requestsLastDoc),
                limit(state.requestsPageSize)
            );

        const snap = await getDocs(nextQ);
        const batchRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.requestsOlderCache = [...state.requestsOlderCache, ...batchRows];
        state.requestsDidPaginateOlder = true;
        state.requestsHasMore = snap.docs.length >= state.requestsPageSize;
        state.requestsLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
        state.allRequestsCache = mergePaginatedCache(state.requestsLiveCache, state.requestsOlderCache);

        const searchVal = document.getElementById('my-requests-search')?.value || '';
        renderDashboard(state.allRequestsCache);
        renderMyRequests(state.allRequestsCache.filter(r => canViewAllRequests || r.createdBy === state.userId), searchVal);
        renderBudgets(state.budgetsCache, state.allRequestsCache);
        if (hasPermission(state.userRole, 'approve_requests') || normRole === 'General Manager' || normRole === 'System Administrator') {
            renderApprovals(state.allRequestsCache);
        }
        updateStats(state.allRequestsCache, null);
        renderDashboardCharts(state.allRequestsCache);
        applyReportFilters();
        updateSidebarBadges();
        renderStoreOperations();

        showNotification(`Loaded ${batchRows.length} older request(s) (Total: ${state.allRequestsCache.length}).`);
    } catch (err) {
        console.error("Error loading older requests:", err);
        showNotification("Failed to load older requests.", true);
    } finally {
        isLoadingOlderRequests = false;
        hideLoadingOverlay();
    }
}

export async function loadMoreStockMovements({ loadAll = false, silent = false } = {}) {
    if (isLoadingOlderMovements) return { loaded: 0, complete: !state.stockMovementsHasMore };
    if (!state.stockMovementsHasMore || !state.stockMovementsLastDoc) {
        return { loaded: 0, complete: true };
    }

    isLoadingOlderMovements = true;
    showLoadingOverlay();
    let totalLoadedNow = 0;
    let pageLoops = 0;
    try {
        do {
            const nextQ = query(
                collection(state.db, 'stock_movements'),
                orderBy("timestamp", "desc"),
                startAfter(state.stockMovementsLastDoc),
                limit(state.stockMovementsPageSize)
            );
            const snap = await getDocs(nextQ);
            const batchRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            totalLoadedNow += batchRows.length;
            state.stockMovementsOlderCache = [...state.stockMovementsOlderCache, ...batchRows];
            state.stockMovementsDidPaginateOlder = true;
            state.stockMovementsHasMore = snap.docs.length >= state.stockMovementsPageSize;
            state.stockMovementsLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
            pageLoops++;
        } while (loadAll && state.stockMovementsHasMore && pageLoops < 50);

        state.stockMovementsCache = mergePaginatedCache(state.stockMovementsLiveCache, state.stockMovementsOlderCache);
        renderStockMovements(state.stockMovementsCache);
        if (document.getElementById('reconciliation-table-container')) {
            renderReconciliationContent();
        }
        if (!silent) {
            showNotification(`Loaded ${totalLoadedNow} older movement record(s) (Total: ${state.stockMovementsCache.length}).`);
        }
        return { loaded: totalLoadedNow, complete: !state.stockMovementsHasMore };
    } catch (err) {
        console.error("Error loading older stock movements:", err);
        showNotification("Failed to load older stock movements.", true);
        return { loaded: totalLoadedNow, complete: false };
    } finally {
        isLoadingOlderMovements = false;
        hideLoadingOverlay();
    }
}

// ============================================================================
// Database Backup, Client-Side AES-256 Encryption & Cloudinary Off-Site Sync
// ============================================================================

function triggerBrowserJsonDownload(obj, filename) {
    const jsonString = JSON.stringify(obj, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return jsonString.length;
}

async function fetchEntireCollectionPaginated(colName) {
    const colRef = collection(state.db, colName);
    const docs = [];
    let lastDocSnap = null;
    while (true) {
        const q = lastDocSnap
            ? query(colRef, orderBy(documentId()), startAfter(lastDocSnap), limit(500))
            : query(colRef, orderBy(documentId()), limit(500));
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
            docs.push({
                id: d.id,
                data: serializeFirestoreValue(d.data())
            });
        });
        if (snap.docs.length < 500) break;
        lastDocSnap = snap.docs[snap.docs.length - 1];
    }
    return docs;
}

async function collectCompleteBackupDataset() {
    const collections = {};
    const counts = {};
    let totalDocs = 0;

    for (const colName of BACKUP_COLLECTIONS) {
        const docs = await fetchEntireCollectionPaginated(colName);
        collections[colName] = docs;
        counts[colName] = docs.length;
        totalDocs += docs.length;
    }

    const cfg = getHotelSettings();
    return {
        format: BACKUP_PLAIN_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: state.auth?.currentUser?.email || state.userId || 'Admin',
        projectId: firebaseConfig.projectId,
        hotelName: cfg.hotelName,
        counts,
        totalDocs,
        collections
    };
}

async function recordBackupAuditLog({ provider, encrypted, bytes, totalDocs, counts, checksumSha256 = '', secureUrl = '', publicId = '' }) {
    const nowIso = new Date().toISOString();
    const userEmail = state.auth?.currentUser?.email || 'Admin';

    await setDoc(doc(state.db, 'backups', 'config'), {
        lastBackupAt: serverTimestamp(),
        lastBackupAtIso: nowIso,
        lastBackupBy: userEmail,
        lastBackupProvider: provider,
        lastBackupEncrypted: Boolean(encrypted)
    }, { merge: true });

    await addDoc(collection(state.db, 'backups'), {
        type: 'log',
        provider,
        encrypted: Boolean(encrypted),
        bytes: Number(bytes || 0),
        totalDocs: Number(totalDocs || 0),
        counts: counts || {},
        checksumSha256,
        secureUrl,
        publicId,
        createdAt: serverTimestamp(),
        createdAtIso: nowIso,
        createdBy: state.userId,
        createdByEmail: userEmail
    });
}

export async function handleSaveBackupConfig(e) {
    if (e) e.preventDefault();
    if (normalizeRole(state.userRole) !== 'System Administrator') {
        showNotification("Only System Administrators can manage backup settings.", true);
        return;
    }

    const cloudinaryCloudName = (document.getElementById('backup-cloud-name')?.value || '').trim();
    const cloudinaryUploadPreset = (document.getElementById('backup-upload-preset')?.value || '').trim();
    const cloudinaryFolder = (document.getElementById('backup-cloud-folder')?.value || 'hotel-po-backups').trim() || 'hotel-po-backups';
    const backupReminderDays = Math.max(1, Math.min(90, parseInt(document.getElementById('backup-reminder-days')?.value || '7', 10) || 7));

    showLoadingOverlay();
    try {
        // Note: Encryption passphrase is NEVER stored in Firestore or Cloudinary.
        await setDoc(doc(state.db, 'backups', 'config'), {
            cloudinaryCloudName,
            cloudinaryUploadPreset,
            cloudinaryFolder,
            backupReminderDays,
            updatedAt: serverTimestamp(),
            updatedBy: state.userId
        }, { merge: true });
        renderBackupSectionUI();
        updateAdminBackupReminder();
        showNotification("Backup & Cloudinary configuration saved cleanly (no secrets stored).");
    } catch (err) {
        console.error("Error saving backup config:", err);
        showNotification("Failed to save backup configuration.", true);
    } finally {
        hideLoadingOverlay();
    }
}

export async function handleDownloadBackup({ encrypted = true } = {}) {
    if (normalizeRole(state.userRole) !== 'System Administrator') {
        showNotification("Only System Administrators can export full database backups.", true);
        return;
    }

    const passphraseInput = document.getElementById('backup-passphrase');
    const passphrase = passphraseInput?.value || '';
    if (encrypted && passphrase.length < 6) {
        showNotification("Enter an encryption passphrase (at least 6 characters) before creating an encrypted backup.", true);
        if (passphraseInput) passphraseInput.focus();
        return;
    }

    showLoadingOverlay();
    try {
        const dataset = await collectCompleteBackupDataset();
        const dateTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeHotel = (dataset.hotelName || 'Hotel').replace(/[^a-z0-9]+/gi, '_');

        let bytes = 0;
        let checksumSha256 = '';
        if (encrypted) {
            const envelope = await encryptBackupPayload(dataset, passphrase, { hotelName: dataset.hotelName });
            checksumSha256 = envelope.checksumSha256 || '';
            bytes = triggerBrowserJsonDownload(envelope, `${safeHotel}_Encrypted_Backup_${dateTag}.json`);
        } else {
            const plaintext = JSON.stringify(dataset, null, 2);
            checksumSha256 = await sha256Hex(plaintext);
            bytes = triggerBrowserJsonDownload(dataset, `${safeHotel}_Plain_Backup_${dateTag}.json`);
        }

        await recordBackupAuditLog({
            provider: 'local',
            encrypted,
            bytes,
            totalDocs: dataset.totalDocs,
            counts: dataset.counts,
            checksumSha256
        });

        showNotification(`${encrypted ? 'Encrypted' : 'Plain JSON'} backup downloaded (${dataset.totalDocs} records across ${BACKUP_COLLECTIONS.length} collections).`);
    } catch (err) {
        console.error("Error exporting backup:", err);
        showNotification(err?.message || "Failed to generate backup.", true);
    } finally {
        hideLoadingOverlay();
    }
}

export async function handleUploadCloudinaryBackup() {
    if (normalizeRole(state.userRole) !== 'System Administrator') {
        showNotification("Only System Administrators can upload backups to Cloudinary.", true);
        return;
    }

    const cloudName = (document.getElementById('backup-cloud-name')?.value || '').trim();
    const uploadPreset = (document.getElementById('backup-upload-preset')?.value || '').trim();
    const folder = (document.getElementById('backup-cloud-folder')?.value || 'hotel-po-backups').trim() || 'hotel-po-backups';
    const reminderDays = Math.max(1, Math.min(90, parseInt(document.getElementById('backup-reminder-days')?.value || '7', 10) || 7));
    const passphraseInput = document.getElementById('backup-passphrase');
    const passphrase = passphraseInput?.value || '';

    if (!cloudName || !uploadPreset) {
        showNotification("Enter your Cloudinary Cloud Name and Unsigned Upload Preset first.", true);
        return;
    }
    if (passphrase.length < 6) {
        showNotification("Passphrase required (min 6 chars): Cloudinary URLs require client-side AES-256 encryption to keep sensitive hotel data private.", true);
        if (passphraseInput) passphraseInput.focus();
        return;
    }

    showLoadingOverlay();
    try {
        // Persist non-secret Cloudinary settings for future backups
        await setDoc(doc(state.db, 'backups', 'config'), {
            cloudinaryCloudName: cloudName,
            cloudinaryUploadPreset: uploadPreset,
            cloudinaryFolder: folder,
            backupReminderDays: reminderDays
        }, { merge: true });

        const dataset = await collectCompleteBackupDataset();
        const envelope = await encryptBackupPayload(dataset, passphrase, { hotelName: dataset.hotelName });
        const dateTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeHotel = (dataset.hotelName || 'Hotel').replace(/[^a-z0-9]+/gi, '_');

        const cloudRes = await uploadEncryptedBackupToCloudinary({
            cloudName,
            uploadPreset,
            folder,
            encryptedEnvelope: envelope,
            filename: `${safeHotel}_AES256_${dateTag}.json`
        });

        await recordBackupAuditLog({
            provider: 'cloudinary',
            encrypted: true,
            bytes: cloudRes.bytes,
            totalDocs: dataset.totalDocs,
            counts: dataset.counts,
            checksumSha256: envelope.checksumSha256 || '',
            secureUrl: cloudRes.secureUrl,
            publicId: cloudRes.publicId
        });

        showNotification(`AES-256 encrypted backup uploaded to Cloudinary (${dataset.totalDocs} records)!`);
    } catch (err) {
        console.error("Cloudinary backup upload failed:", err);
        showNotification(err?.message || "Cloudinary upload failed. Verify Cloud Name and Unsigned Raw Preset.", true);
    } finally {
        hideLoadingOverlay();
    }
}

async function inspectParsedBackupJson(rawText, sourceLabel) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (_) {
        throw new Error('Selected file is not valid JSON.');
    }

    let plainDataset = parsed;
    let wasEncrypted = false;
    if (isEncryptedBackupEnvelope(parsed)) {
        wasEncrypted = true;
        const passInput = document.getElementById('restore-passphrase');
        const pass = passInput?.value || '';
        if (!pass) {
            if (passInput) passInput.focus();
            throw new Error('This backup is AES-256 encrypted. Enter its decryption passphrase in Step 2 and click Inspect again.');
        }
        plainDataset = await decryptBackupPayload(parsed, pass);
    }

    const summary = validateBackupDataset(plainDataset);
    state.pendingRestoreData = {
        dataset: plainDataset,
        summary,
        wasEncrypted,
        sourceLabel
    };
    renderRestorePreview();
}

export async function handleInspectLocalBackupFile() {
    if (normalizeRole(state.userRole) !== 'System Administrator') {
        showNotification("Only System Administrators can restore backups.", true);
        return;
    }

    const fileInput = document.getElementById('restore-file-input');
    const file = fileInput?.files?.[0];
    if (!file) {
        showNotification("Please select a backup .json file first.", true);
        return;
    }

    showLoadingOverlay();
    try {
        const text = await file.text();
        await inspectParsedBackupJson(text, file.name);
        showNotification("Backup verified and preview loaded below.");
    } catch (err) {
        console.error("Backup inspect failed:", err);
        showNotification(err?.message || "Failed to inspect backup file.", true);
    } finally {
        hideLoadingOverlay();
    }
}

export async function handleLoadCloudinaryBackup(secureUrl) {
    if (normalizeRole(state.userRole) !== 'System Administrator') {
        showNotification("Only System Administrators can load cloud backups.", true);
        return;
    }
    if (!secureUrl) return;

    showLoadingOverlay();
    try {
        const res = await fetch(secureUrl);
        if (!res.ok) throw new Error(`Could not fetch backup from Cloudinary (HTTP ${res.status}).`);
        const text = await res.text();
        await inspectParsedBackupJson(text, 'Cloudinary Encrypted Snapshot');
        showNotification("Cloudinary backup decrypted and verified! Review below before restoring.");
    } catch (err) {
        console.error("Error loading Cloudinary backup:", err);
        showNotification(err?.message || "Failed to load Cloudinary backup.", true);
    } finally {
        hideLoadingOverlay();
    }
}

export function handleCancelRestore() {
    state.pendingRestoreData = null;
    renderRestorePreview();
}

export function handleExecuteRestore() {
    if (normalizeRole(state.userRole) !== 'System Administrator') {
        showNotification("Only System Administrators can execute database restores.", true);
        return;
    }
    const pending = state.pendingRestoreData;
    if (!pending || !pending.dataset?.collections) {
        showNotification("Load and inspect a backup first.", true);
        return;
    }

    const selectedCols = Array.from(document.querySelectorAll('.restore-collection-cb:checked')).map(cb => cb.value);
    if (selectedCols.length === 0) {
        showNotification("Select at least one collection to restore.", true);
        return;
    }

    showConfirmModal(
        `Restore ${selectedCols.join(', ')} from "${pending.sourceLabel}"? Existing records with matching IDs will be merged (immutable audit logs already present stay untouched).`,
        async () => {
            showLoadingOverlay();
            try {
                let restoredCount = 0;
                let skippedImmutableCount = 0;

                for (const colName of selectedCols) {
                    const docs = pending.dataset.collections[colName] || [];
                    if (docs.length === 0) continue;

                    let existingMovementIds = null;
                    if (colName === 'stock_movements') {
                        const existingDocs = await fetchEntireCollectionPaginated('stock_movements');
                        existingMovementIds = new Set(existingDocs.map(d => d.id));
                    }

                    const writes = [];
                    for (const entry of docs) {
                        if (colName === 'settings' && entry.id === 'backup') continue;
                        if (colName === 'stock_movements') {
                            if (existingMovementIds.has(entry.id)) {
                                skippedImmutableCount++;
                                continue;
                            }
                            const d = entry.data || {};
                            if (!['IN', 'OUT'].includes(d.type) || typeof d.quantity !== 'number' || d.quantity < 0) {
                                skippedImmutableCount++;
                                continue;
                            }
                        }
                        writes.push({
                            ref: doc(state.db, colName, entry.id),
                            data: deserializeFirestoreValue(entry.data, Timestamp)
                        });
                    }

                    for (let i = 0; i < writes.length; i += 350) {
                        const batch = writeBatch(state.db);
                        writes.slice(i, i + 350).forEach(w => {
                            if (colName === 'stock_movements') {
                                batch.set(w.ref, w.data);
                            } else {
                                batch.set(w.ref, w.data, { merge: true });
                            }
                        });
                        await batch.commit();
                        restoredCount += writes.slice(i, i + 350).length;
                    }
                }

                state.pendingRestoreData = null;
                renderRestorePreview();
                const passEl = document.getElementById('restore-passphrase');
                if (passEl) passEl.value = '';

                const skipNote = skippedImmutableCount > 0 ? ` (${skippedImmutableCount} existing/immutable audit entries skipped)` : '';
                showNotification(`Restore complete: ${restoredCount} document(s) restored across ${selectedCols.length} collection(s)${skipNote}.`);
            } catch (err) {
                console.error("Database restore failed:", err);
                showNotification(err?.message || "Restore failed. Check console for details.", true);
            } finally {
                hideLoadingOverlay();
            }
        }
    );
}
