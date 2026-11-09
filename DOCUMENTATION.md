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
| `unit` | string | Base measurement unit (`Kg`, `Liter`, `Each`, `Bottle`, `Box`, `Bag`, etc.) |
| `packageSize` | number | Base units per package (e.g. 25 for 25 Kg/bag, 24 for 24 bottles/carton) |
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

### 4.6 Collection: `notifications`
| Field | Type | Description |
| :--- | :--- | :--- |
| `recipientRole` | string | Target role (`'General Manager'`, `'Storekeeper'`, `'Purchasing'`, or `'All'`) |
| `recipientUserId` | string | Target user UID (or null for role broadcast) |
| `title` | string | Alert headline |
| `message` | string | Notification detail |
| `type` | string | Event type: `'new_request'`, `'approved'`, `'rejected'`, `'ordered'`, `'issued'`, `'received'` |
| `requestId` | string | Associated request document ID |
| `requestType` | string | `'requisition'` or `'purchase'` |
| `department` | string | Associated department |
| `readBy` | array | Array of user UIDs who have marked this notification read |
| `createdAt` | timestamp | Server timestamp |

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
* **Autocomplete & Auto-Pricing:** Typing an item name autocompletes from inventory, pre-populating base unit and unit price.
* **Dynamic Package Pricing & Unit Conversions:** Selecting packaging units (e.g., `Box`, `Bag`, `Carton`) automatically scales the unit price by the item's configured `packageSize` (e.g. 25 kg per bag of sugar) or default conversion multiplier.
* **Editable Unit Price Column:** The unit price is displayed in an editable number input on each item row, allowing staff to adjust prices or input negotiated vendor rates directly before submission.
* **Live Calculations:** Subtotal (`quantity * unitPrice`) and estimated total cost recalculate immediately on quantity, unit, or price change.

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

### 5.12 Real-Time In-App Notification System & Sidebar Badges
* **Notification Bell:** Header bell icon with an unread badge counter and real-time dropdown feed.
* **Automated Workflow Notifications:**
  * **New Requests:** Instantly alerts General Manager / Approval Manager.
  * **Approved Requisitions:** Alerts Storekeeper to dispense items.
  * **Approved Purchase Orders:** Alerts Purchasing team to place external orders.
  * **Ordered POs:** Alerts Storekeeper that goods have been ordered and will arrive.
  * **Issued / Received Goods:** Alerts requesting department staff and purchasing.
* **Interactive Controls:** Mark all as read, click-to-route directly to the relevant request.
* **Sidebar Activity Badges:** Real-time numerical badges indicating pending approvals for General Manager and pending warehouse actions (issuance/receiving) for Storekeeper.

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

    function getUserRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }

    function isAdmin() {
      return isAuthenticated() && getUserRole() == 'System Administrator';
    }

    function isGM() {
      return isAuthenticated() && getUserRole() == 'General Manager';
    }

    function isAdminOrGM() {
      return isAuthenticated() && (getUserRole() in ['System Administrator', 'General Manager']);
    }

    function isStorekeeper() {
      return isAuthenticated() && (getUserRole() in ['Storekeeper', 'Store Keeper']);
    }

    function isPurchasing() {
      return isAuthenticated() && getUserRole() == 'Purchasing';
    }

    function isStorekeeperOrAdmin() {
      return isStorekeeper() || isAdmin();
    }

    // users: read for signed-in; only Admin changes role/department; users can edit non-privileged fields
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && (
        isAdmin() ||
        (userId == request.auth.uid && (!('role' in request.resource.data) || request.resource.data.role == 'User'))
      );
      allow update: if isAuthenticated() && (
        isAdmin() ||
        (userId == request.auth.uid &&
         !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'department', 'status']))
      );
      allow delete: if isAdmin();
    }

    // requests: create only as Pending with createdBy == own uid.
    // Approve/Reject only GM or Admin. Place order (Ordered) only Purchasing or Admin.
    // Issue/receive only Storekeeper or Admin.
    match /requests/{requestId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() &&
        request.resource.data.status == 'Pending' &&
        request.resource.data.createdBy == request.auth.uid;
      allow update: if isAuthenticated() && (
        isAdmin() ||
        (isGM() && request.resource.data.status in ['Approved', 'Rejected']) ||
        (isPurchasing() && request.resource.data.status == 'Ordered') ||
        (isStorekeeper() && (
          request.resource.data.status in ['Issued', 'Partially Issued', 'Received', 'Partially Received'] ||
          request.resource.data.received == true
        ))
      );
      allow delete: if isAdmin();
    }

    // inventory: Storekeeper or Admin only
    match /inventory/{itemId} {
      allow read: if isAuthenticated();
      allow write: if isStorekeeperOrAdmin();
    }

    // stock_movements: Storekeeper or Admin only; immutable ledger (never update or delete)
    match /stock_movements/{movementId} {
      allow read: if isAuthenticated();
      allow create: if isStorekeeperOrAdmin();
      allow update, delete: if false;
    }

    // budgets, departments, settings: read for signed-in users; write for Admin and GM only
    match /budgets/{budgetId} {
      allow read: if isAuthenticated();
      allow write: if isAdminOrGM();
    }

    match /departments/{deptId} {
      allow read: if isAuthenticated();
      allow write: if isAdminOrGM();
    }

    match /settings/{settingId} {
      allow read: if isAuthenticated();
      allow write: if isAdminOrGM();
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
