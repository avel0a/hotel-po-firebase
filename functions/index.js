/**
 * Cloud Functions for Hotel Purchase Order System.
 * Synchronizes departmental budgets on approval and supports admin Auth lifecycle cleanup.
 */

const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

/**
 * Updates department monthly budget spending when a request transitions
 * between Pending/Approved/Rejected. Schema matches frontend budgets collection:
 * Document ID: `${YYYY-MM}_${department.replace(/\s+/g, "-")}`
 */
exports.updateBudgetOnApproval = onDocumentUpdated("requests/{requestId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return null;

  const wasApproved = before.status === "Approved";
  const isNowApproved = after.status === "Approved";

  // Ignore status updates that don't enter Approved or leave Approved to Rejected
  const delta = !wasApproved && isNowApproved ? Number(after.totalCost || 0) :
    (wasApproved && after.status === "Rejected" ? -Number(before.totalCost || 0) : 0);

  if (delta === 0) return null;

  const department = after.department;
  if (!department) {
    logger.log(`Request ${event.params.requestId} missing department. Skipping budget update.`);
    return null;
  }

  const requestDate = (after.createdAt && typeof after.createdAt.toDate === "function") ?
    after.createdAt.toDate() :
    new Date();

  const year = String(requestDate.getFullYear());
  const monthNum = String(requestDate.getMonth() + 1).padStart(2, "0");
  const period = `${year}-${monthNum}`;

  // Matches client-side budget document ID format: YYYY-MM_Department-Name
  const budgetDocId = `${period}_${department.replace(/\s+/g, "-")}`;
  const budgetRef = db.collection("budgets").doc(budgetDocId);

  logger.info(`Updating budget ${budgetDocId} by ${delta} for request ${event.params.requestId}.`);

  try {
    await db.runTransaction(async (transaction) => {
      const budgetDoc = await transaction.get(budgetRef);
      if (!budgetDoc.exists) {
        transaction.set(budgetRef, {
          department,
          month: period,
          year,
          month_num: monthNum,
          amount: 0,
          spentAmount: Math.max(0, delta),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        const currentSpent = Number(budgetDoc.data().spentAmount || 0);
        transaction.update(budgetRef, {
          spentAmount: Math.max(0, currentSpent + delta),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (error) {
    logger.error(`Failed to update budget for ${budgetDocId}:`, error);
  }

  return null;
});

/**
 * Callable Cloud Function allowing System Administrators to disable or delete
 * a staff member's Firebase Authentication credentials when removing their account.
 */
exports.revokeUserAuthAccount = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const callerSnap = await db.collection("users").doc(request.auth.uid).get();
  if (!callerSnap.exists || callerSnap.data().role !== "System Administrator") {
    throw new HttpsError("permission-denied", "Only System Administrators can revoke user credentials.");
  }

  const {targetUid, mode = "disable"} = request.data || {};
  if (!targetUid || typeof targetUid !== "string") {
    throw new HttpsError("invalid-argument", "Missing targetUid.");
  }
  if (targetUid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "Cannot revoke your own administrator account.");
  }

  const auth = getAuth();
  if (mode === "delete") {
    await auth.deleteUser(targetUid);
    return {status: "deleted", uid: targetUid};
  }
  await auth.updateUser(targetUid, {disabled: mode !== "restore"});
  return {status: mode === "restore" ? "enabled" : "disabled", uid: targetUid};
});
