# Hotel Purchase Order System — Complete Documentation

> **Version:** 2.5 (Segregated Procurement & Storekeeper Fulfillment Engine)  
> **Prepared for:** Abel Amare  
> **Last Updated:** November 9, 2026  
> **Platform:** Firebase (Hosting + Cloud Firestore + Cloud Functions + Authentication)  
> **Live Web App:** [https://purchase-70a3f.web.app](https://purchase-70a3f.web.app)  
> **GitHub Repository:** [https://github.com/avel0a/hotel-po-firebase](https://github.com/avel0a/hotel-po-firebase)

---

## Table of Contents

1. [Overview & Core Architecture](#1-overview--core-architecture)
2. [Dual Procurement & Fulfillment Workflows](#2-dual-procurement--fulfillment-workflows)
   - [2.1 Flow A: Department Requisition (Stock Goes DOWN)](#21-flow-a-department-requisition-stock-goes-down)
   - [2.2 Flow B: Vendor Purchase Order (Stock Goes UP)](#22-flow-b-vendor-purchase-order-stock-goes-up)
   - [2.3 Weighted Average Cost Formula](#23-weighted-average-cost-formula)
3. [User Roles & Permissions Matrix](#3-user-roles--permissions-matrix)
4. [Firestore Data Model & Schemas](#4-firestore-data-model--schemas)
5. [Feature Walkthrough](#5-feature-walkthrough)
   - [5.1 Dashboard & Live Analytics](#51-dashboard--live-analytics)
   - [5.2 New Requisition / Purchase Order Creation](#52-new-requisition--purchase-order-creation)
   - [5.3 Tabbed Requests View & Action Buttons](#53-tabbed-requests-view--action-buttons)
   - [5.4 General Manager Approvals](#54-general-manager-approvals)
   - [5.5 Storekeeper Issuance & Goods Receipt Modals](#55-storekeeper-issuance--goods-receipt-modals)
   - [5.6 Inventory Management & Quick Restock](#56-inventory-management--quick-restock)
   - [5.7 Immutable Stock Movement Audit Trail](#57-immutable-stock-movement-audit-trail)
   - [5.8 Department Budget Tracking](#58-department-budget-tracking)
   - [5.9 Filterable Reports, PDF & CSV Export](#59-filterable-reports-pdf--csv-export)
   - [5.10 Seamless User Account Administration](#510-seamless-user-account-administration)
   - [5.11 Hotel Settings: Departments & Permissions](#511-hotel-settings-departments--permissions)
6. [Cloud Functions Trigger](#6-cloud-functions-trigger)
7. [Database Security Rules](#7-database-security-rules)
8. [Configuration & Constants](#8-configuration--constants)
9. [Deployment & Operations Guide](#9-deployment--operations-guide)

---

## 1. Overview & Core Architecture

The **Hotel Purchase Order & Requisition System** is an enterprise-grade web application built specifically for hospitality operations. It manages the entire lifecycle of goods moving into and within a hotel, eliminating paper chits, spreadsheets, and lost inventory.

### Key Architectural Principles
1. **Segregation of Duties (Internal Controls):**
   - **Purchasing** selects suppliers, negotiates prices, and places orders. Purchasing **never** edits warehouse inventory numbers.
   - **Storekeeper** physically counts incoming deliveries and dispenses stock to staff. Only Storekeepers and Administrators can alter warehouse stock quantities.
   - **General Manager** authorizes financial commitments. GM approval **never** increases or decreases stock.
2. **Dual-Flow Procurement:** Internal hotel consumption (requisitions from the store) is logically and mechanically separated from external commercial procurement (vendor purchases).
3. **Pure Vanilla ES Modules (Zero Build Step):** Uses native modern browser ES Modules loaded directly from Firebase Hosting. No slow bundling, Webpack, or Vite compile steps.
4. **Real-time Synchronization:** Firestore `onSnapshot` listeners automatically sync data across all active terminals in real time.

---

## 2. Dual Procurement & Fulfillment Workflows

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HOTEL STAFF REQUEST                             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         Submits Request (Pending)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        GENERAL MANAGER APPROVAL                        │
│                 (Approval alters NO inventory stock)                   │
└──────────────────┬──────────────────────────────────┬──────────────────┘
                   │                                  │
         Flow A: Requisition                 Flow B: Purchase Order
                   │                                  │
                   ▼                                  ▼
┌──────────────────────────────────────┐ ┌───────────────────────────────┐
│        STOREKEEPER DISPENSES         │ │    PURCHASING PLACES ORDER    │
│  • Storekeeper inspects store stock  │ │  • Enters supplier & quote ref│
│  • Issues items to department staff  │ │  • Sets expected delivery date│
│  • Store stock DECREASES (-)         │ │  • Status becomes "Ordered"   │
│  • Cost charged to department budget │ │  • Stock is NOT altered       │
│  • Logs 'OUT' movement entry         │ └──────────────┬────────────────┘
└──────────────────┬───────────────────┘                │
                   │                             Shipment Arrives
                   ▼                                    │
      Status: "Partially Issued"                        ▼
             or "Issued"               ┌─────────────────────────────────┐
                                       │    STOREKEEPER RECEIVES GOODS   │
                                       │  • Inspects physical delivery   │
                                       │  • Enters actual delivered qty  │
                                       │  • Enters actual invoice price  │
                                       │  • Store stock INCREASES (+)    │
                                       │  • Recalculates Weighted Avg Cost│
                                       │  • Logs 'IN' movement entry     │
                                       └────────────────┬────────────────┘
                                                        │
                                                        ▼
                                           Status: "Partially Received"
                                                  or "Received"
```

---

### 2.1 Flow A: Department Requisition (Stock Goes DOWN)
* **Goal:** A department (e.g., Kitchen, Housekeeping) requests items currently held in the central hotel store.
* **Lifecycle:** `Pending` ➔ `Approved` ➔ `Partially Issued` ➔ `Issued` (or `Rejected`).
* **Step 1 (Submission):** Staff selects *Department Requisition*, specifies items and quantities needed.
* **Step 2 (Approval):** GM reviews and approves. **Stock does not change.**
* **Step 3 (Storekeeper Fulfillment):**
  * Storekeeper clicks **Issue Items** from the Requisition table or Request Details modal.
  * System displays requested units, already issued units, and available warehouse stock.
  * Storekeeper inputs the quantity to issue and the recipient's name.
  * **Database Transaction:**
    $$\text{New Stock} = \text{Current Stock} - \text{Quantity Issued}$$
    * Requisition item is updated with `issuedQuantity`.
    * If all items are fulfilled, status becomes **`Issued`**; if partial, status becomes **`Partially Issued`**.
    * An immutable `OUT` record is added to `stock_movements`.

---

### 2.2 Flow B: Vendor Purchase Order (Stock Goes UP)
* **Goal:** The hotel buys goods from external suppliers to replenish the store or procure capital assets.
* **Lifecycle:** `Pending` ➔ `Approved` ➔ `Ordered` ➔ `Partially Received` ➔ `Received` (or `Rejected`).
* **Step 1 (Submission):** Purchasing or Store submits a *Purchase Order* request.
* **Step 2 (Approval):** GM reviews and approves. **Stock does not change.**
* **Step 3 (Purchasing Commitment):**
  * Purchasing team clicks **Place Order**.
  * Enters Supplier Name, Quote/PO Reference, Expected Delivery Date, and Terms.
  * Status updates to **`Ordered`**. **Inventory stock is not touched.**
* **Step 4 (Storekeeper Goods Receipt):**
  * When the delivery truck arrives, the Storekeeper clicks **Receive Goods**.
  * Storekeeper inspects the shipment, enters actual delivered quantities, actual unit invoice prices, and the delivery note number.
  * **Database Transaction:**
    $$\text{New Stock} = \text{Current Stock} + \text{Quantity Received}$$
    * The item's valuation is recalculated using the **Weighted Average Cost**.
    * Purchase Order item is updated with `receivedQuantity` and `actualPrice`.
    * If fully delivered, status becomes **`Received`**; if partial, status becomes **`Partially Received`**.
    * An immutable `IN` record is added to `stock_movements`.

---

### 2.3 Weighted Average Cost Formula
When receiving inventory from external vendors at varying market prices, unit costs are dynamically updated so financial reports reflect accurate inventory asset valuation:

$$\text{New Unit Price} = \frac{(\text{Current Stock} \times \text{Old Price}) + (\text{Qty Received} \times \text{Actual Unit Price})}{\text{Current Stock} + \text{Qty Received}}$$

* If current stock is 0, the new price is simply the actual unit price delivered.

---

## 3. User Roles & Permissions Matrix

The system provides 5 standard roles configured in [`public/js/config.js`](public/js/config.js). Administrators can customize permissions for any role at runtime via the **Settings** screen:

| Permission ID | Description | User | Purchasing | Storekeeper | General Manager | System Admin |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `create_request` | Submit new requisitions or purchase requests | ✅ | ✅ | ✅ | ✅ | ✅ |
| `view_all_requests` | View requests across all hotel departments | ❌ | ✅ | ✅ | ✅ | ✅ |
| `approve_requests` | Review, approve, or reject pending requests | ❌ | ❌ | ❌ | ✅ | ✅ |
| `manage_inventory` | Issue items, receive goods, edit SKUs, fill store | ❌ | ❌ | ✅ | ❌ | ✅ |
| `manage_budgets` | Set monthly departmental budget limits | ❌ | ❌ | ❌ | ✅ | ✅ |
| `view_reports` | Generate reports, export PDF & CSV summaries | ❌ | ✅ | ❌ | ✅ | ✅ |
| `manage_users` | Add, edit, suspend, and reset staff accounts | ❌ | ❌ | ❌ | ❌ | ✅ |
| `manage_settings` | Add/delete departments, customize permissions | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 4. Firestore Data Model & Schemas

### 4.1 Collection: `requests`
| Field | Type | Description |
| :--- | :--- | :--- |
| `requestType` | string | `'Requisition'` (Flow A) or `'Purchase Order'` (Flow B) |
| `department` | string | Requesting department (e.g. `'Kitchen'`, `'Housekeeping'`) |
| `priority` | string | `'Normal'`, `'High'`, or `'Urgent'` |
| `requiredBy` | string | Required delivery date (`YYYY-MM-DD`) |
| `notes` | string | Requester justification notes |
| `items` | array | Array of item tracking objects: |
| ↳ `name` | string | Item name |
| ↳ `quantity` | number | Requested / ordered quantity |
| ↳ `unit` | string | Measurement unit (`Each`, `Box`, `Kg`, `Liter`, `Set`) |
| ↳ `price` | number | Estimated unit price |
| ↳ `issuedQuantity` | number | Cumulative quantity dispensed by Storekeeper |
| ↳ `receivedQuantity` | number | Cumulative quantity received by Storekeeper |
| ↳ `actualPrice` | number | Actual price paid per unit on vendor invoice |
| `totalCost` | number | Sum of `(quantity * price)` across all items |
| `status` | string | One of: `Pending`, `Approved`, `Ordered`, `Partially Issued`, `Issued`, `Partially Received`, `Received`, `Rejected` |
| `supplier` | string | Vendor / supplier name (populated by Purchasing) |
| `orderRef` | string | Supplier quote or order reference number |
| `expectedDeliveryDate` | string | Expected delivery date (`YYYY-MM-DD`) |
| `purchasingNotes` | string | Purchasing terms and delivery instructions |
| `orderedAt` | timestamp | Server timestamp when marked as Ordered |
| `orderedBy` | string | UID of purchasing staff |
| `approvalNotes` | string | Optional GM approval or rejection remarks |
| `lastIssuedAt` | timestamp | Timestamp of last store issuance |
| `lastIssuedRecipient` | string | Staff recipient who collected goods |
| `lastReceivedAt` | timestamp | Timestamp of last goods receipt |
| `deliveryNote` | string | Vendor invoice or delivery note number |
| `createdAt` | timestamp | Server timestamp of creation |
| `createdBy` | string | UID of requesting user |
| `createdByEmail` | string | Email of requesting user |

### 4.2 Collection: `inventory`
| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | string | Item name (unique key) |
| `category` | string | Department or item classification |
| `stock` | number | Current physical units on hand in store |
| `min` | number | Minimum safety stock threshold |
| `price` | number | Current unit valuation (weighted average cost) |

### 4.3 Collection: `stock_movements` (Immutable Audit Ledger)
| Field | Type | Description |
| :--- | :--- | :--- |
| `itemId` | string | ID of the inventory document |
| `itemName` | string | Item name |
| `category` | string | Category |
| `type` | string | `'IN'` (Goods Receipt) or `'OUT'` (Department Issue) |
| `quantity` | number | Number of units moved |
| `previousStock` | number | Stock before transaction |
| `newStock` | number | Stock after transaction |
| `unitPrice` | number | Actual unit price (for `IN` receipts) |
| `department` | string | Destination department (for `OUT`) or `'Store'` (for `IN`) |
| `recipient` | string | Staff member or warehouse receiving location |
| `supplier` | string | External supplier name (for `IN` receipts) |
| `deliveryNote` | string | Invoice or delivery note reference |
| `reason` | string | Transaction reason and request ID cross-reference |
| `issuedBy` | string | UID of user who authorized the movement |
| `issuedByEmail` | string | Email of user who authorized the movement |
| `timestamp` | timestamp | Exact server timestamp |

### 4.4 Collection: `departments`
| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | string | Department name (e.g. `'Kitchen'`, `'Housekeeping'`, `'Store'`) |
| `createdAt` | timestamp | Creation time |
| `createdBy` | string | UID of user who created the department |

### 4.5 Collection: `settings` (`settings/permissions`)
* Contains a single document where keys are role names (e.g., `'Storekeeper'`, `'Purchasing'`) and values are arrays of granted permission strings.

---

## 5. Feature Walkthrough

### 5.1 Dashboard & Live Analytics
* **Top Metric Cards:** Real-time counters for Pending, Approved, Rejected, and Low Stock items.
* **Interactive Filtering:** Clicking any stat card filters recent requests by that status.
* **Charts:**
  * Monthly Request Volume bar chart (last 12 months).
  * Request Status Overview doughnut chart (Pending / Approved / Rejected).

### 5.2 New Requisition / Purchase Order Creation
* **Order Type Selector:** Visual radio card toggle to select between:
  * **Department Requisition (Stock Out):** Supplies needed for internal departmental use.
  * **Purchase Order (Stock In):** Replenishing store warehouse stock from external vendors.
* **Auto Identity:** Detects signed-in user and department automatically.
* **Autocomplete & Auto-Pricing:** Typing an item name autocompletes from inventory and pre-populates standard unit price.

### 5.3 Tabbed Requests View & Action Buttons
* **Filter Pills with Live Counts:**
  * **All Requests** (`#count-all-requests`)
  * **Dept Requisitions** (`#count-req-requests`)
  * **Purchase Orders** (`#count-po-requests`)
* **8-Column Grid:** Date, Type, Department, Items Summary, Total, Priority, Status, Actions.
* **Contextual Action Buttons:**
  * For Requisitions in `Approved` or `Partially Issued` status: Storekeepers see **`Issue Items`**.
  * For Purchase Orders in `Approved` status: Purchasing sees **`Place Order`**.
  * For Purchase Orders in `Ordered` or `Partially Received` status: Storekeepers see **`Receive Goods`**.

### 5.4 General Manager Approvals
* Displays approval cards with clear colored banners distinguishing Requisitions (store stock out) from Purchase Orders (vendor procurement).
* Approval notes input field for conditions or instructions.
* **Stock Safety Guarantee:** Approving a request never changes inventory quantities.

### 5.5 Storekeeper Issuance & Goods Receipt Modals
* **Issue Requisition Modal:** Shows item list, requested vs. already issued, available store stock, max issuable constraints, recipient name input, and "Issue All Available" helper.
* **Place Order Modal:** Purchasing enters supplier, quotation number, expected delivery date, and purchasing terms.
* **Receive PO Goods Modal:** Storekeeper enters actual delivered quantities, actual unit invoice prices, invoice/delivery note number, and "Receive All Remaining" helper.

### 5.6 Inventory Management & Quick Restock
* Complete SKU tracking with real-time stock status (In Stock, Low Stock, Out of Stock).
* **"Restock Low Items" 1-Click Button:** Scans for items below `min` and auto-generates a pre-filled Purchase Order.
* **Ad-Hoc Issue & Receive:** Standalone modals for walk-up staff issuances or direct off-PO vendor deliveries.

### 5.7 Immutable Stock Movement Audit Trail
* Accessible via the **Stock Movement Log** button in the Inventory view.
* Displays chronological history of every `IN` and `OUT` transaction with staff details, quantities, and delivery references.

### 5.8 Department Budget Tracking
* Set monthly spending caps per department.
* Real-time progress bars highlight budget consumption (< 75% green, 75-90% yellow, > 90% red).

### 5.9 Filterable Reports, PDF & CSV Export
* Filter by date range, department, status, and requester.
* **Download PDF:** High-resolution formatted procurement summary report via `jsPDF` and `AutoTable`.
* **Download Excel/CSV:** UTF-8 BOM encoded CSV export ready for Microsoft Excel.

### 5.10 Seamless User Account Administration
* Create staff accounts with role and department assignments without interrupting administrator sessions.
* Real-time user search, password resets, account suspension toggles, and deletion.

### 5.11 Hotel Settings: Departments & Permissions
* **Department Management:** Add or delete hotel departments dynamically with instant propagation.
* **Role Permissions Matrix:** Checkbox grid configuring capabilities per role with permanent fail-safe Admin protection.

---

## 6. Cloud Functions Trigger

### `updateBudgetOnApproval`
Located in [`functions/index.js`](functions/index.js):
* **Trigger:** `onDocumentUpdated("requests/{requestId}")`
* **Condition:** Fires only when `before.status !== 'Approved' && after.status === 'Approved'`.
* **Action:** Incrementally adds the request's `totalCost` to the department's monthly budget in Firestore.

---

## 7. Database Security Rules

Configured in [`firestore.rules`](firestore.rules):

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    
    function isStorekeeperOrAdmin() {
      return isAuthenticated() && (
        getUserData().role in ['Storekeeper', 'Store Keeper', 'System Administrator']
      );
    }

    // Inventory: Only Storekeeper and Admin can write stock quantities
    match /inventory/{itemId} {
      allow read: if isAuthenticated();
      allow write: if isStorekeeperOrAdmin();
    }

    // Stock movements audit log: Only Storekeeper and Admin can write
    match /stock_movements/{movementId} {
      allow read: if isAuthenticated();
      allow create, update, delete: if isStorekeeperOrAdmin();
    }

    // Requests: Authenticated access; deletions restricted to GM / Admin
    match /requests/{requestId} {
      allow read, create, update: if isAuthenticated();
      allow delete: if isStorekeeperOrAdmin() || getUserData().role in ['General Manager'];
    }

    // All other collections
    match /{document=**} {
      allow read, write: if isAuthenticated();
    }
  }
}
```

---

## 8. Configuration & Constants

Centralized in [`public/js/config.js`](public/js/config.js):
* `DEPARTMENTS`: Default department list.
* `ROLES`: `'User'`, `'Purchasing'`, `'Storekeeper'`, `'General Manager'`, `'System Administrator'`.
* `REQUEST_TYPES`: `{ REQUISITION: 'requisition', PURCHASE: 'purchase' }`.
* `REQUISITION_STATUSES`: `['Pending', 'Approved', 'Partially Issued', 'Issued', 'Rejected']`.
* `PURCHASE_STATUSES`: `['Pending', 'Approved', 'Ordered', 'Partially Received', 'Received', 'Rejected']`.
* `DEFAULT_ROLE_PERMISSIONS`: Fallback permission arrays.

---

## 9. Deployment & Operations Guide

### Local Emulation
```powershell
Set-Location "a:\Personal\Abel\hotel-po-firebase-v2"
firebase emulators:start --only hosting
```

### Production Deployment
```powershell
# Quote multi-target arguments on Windows PowerShell:
firebase deploy --only "hosting,firestore:rules"
```

### Health Verification
* Check live URL: [https://purchase-70a3f.web.app](https://purchase-70a3f.web.app)
* Check console for clean execution (0 errors).
* Background migration helper `runOneTimeRequestAudit()` automatically ensures historical data is upgraded.
