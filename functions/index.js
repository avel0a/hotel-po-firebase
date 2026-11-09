/**
 * Cloud Functions for Hotel Purchase Order System.
 * Triggers on Firestore document updates.
 */

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

/**
 * A Cloud Function that triggers when a purchase request is updated.
 * If the request's status changes to "Approved", it automatically updates
 * the corresponding department's monthly budget.
 */
exports.updateBudgetOnApproval = onDocumentUpdated("requests/{requestId}", async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();

    // We only care about the transition to "Approved" status.
    if (before.status !== "Approved" && after.status === "Approved") {
        const department = after.department;
        const totalCost = after.totalCost;
        const requestDate = after.createdAt.toDate(); // Firestore Timestamp

        if (!department || typeof totalCost !== "number" || totalCost <= 0) {
            logger.log(`Request ${event.params.requestId} is missing department or a valid totalCost. Skipping budget update.`);
            return null;
        }

        // Format the period as YYYY-MM (e.g., "2024-08")
        const year = requestDate.getFullYear();
        const month = (requestDate.getMonth() + 1).toString().padStart(2, "0");
        const period = `${year}-${month}`;

        // Create the budget document ID (e.g., "Kitchen_2024-08")
        const budgetDocId = `${department.replace(/\s+/g, "_")}_${period}`;
        const budgetRef = db.collection("budgets").doc(budgetDocId);

        logger.info(`Processing approval for request ${event.params.requestId}. Updating budget ${budgetDocId} by ${totalCost}.`);

        try {
            // Use a transaction to safely read and write the budget document.
            await db.runTransaction(async (transaction) => {
                const budgetDoc = await transaction.get(budgetRef);

                if (!budgetDoc.exists) {
                    // If budget doc doesn't exist, create it. The budgetAmount must be set from the UI.
                    logger.warn(`Budget document ${budgetDocId} does not exist. Creating with initial spent amount.`);
                    transaction.set(budgetRef, {
                        department: department,
                        period: period,
                        budgetAmount: 0, // Default to 0, must be set in the app
                        spentAmount: totalCost,
                    });
                } else {
                    // If it exists, atomically increment the spent amount.
                    transaction.update(budgetRef, { spentAmount: FieldValue.increment(totalCost) });
                }
            });
            logger.info(`Successfully updated budget for ${budgetDocId}.`);
        } catch (error) {
            logger.error(`Failed to update budget for ${budgetDocId}:`, error);
        }
    }

    return null;
});
