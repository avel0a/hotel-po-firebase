# 🔄 Project Handover Document

**Project:** Hotel Purchase Order & Requisition System  
**Prepared for:** Abel Amare  
**Date:** November 9, 2026  
**Status:** Production (Live on Firebase Hosting)  
**Firebase Project:** `purchase-70a3f`  
**Hosting URL:** [https://purchase-70a3f.web.app](https://purchase-70a3f.web.app)  
**GitHub Repository:** [https://github.com/avel0a/hotel-po-firebase](https://github.com/avel0a/hotel-po-firebase)

---

## 1. Executive Summary

This application is a specialized **Hotel Procurement, Inventory Control, and Requisition Management** system. It streamlines hotel operations across departments (Kitchen, Housekeeping, Maintenance, Front Desk, F&B, etc.) by enforcing strict internal controls and segregation of duties.

The system cleanly bifurcates procurement operations into two separate, auditable workflows:
1. **Flow A — Department Requisitions:** Hotel departments request supplies from the internal hotel store. Approval by the General Manager does not touch inventory. Only the **Storekeeper** issues physical goods, which decrements warehouse stock and logs an `OUT` movement.
2. **Flow B — Vendor Purchase Orders:** Depleted stock or department capital needs trigger external vendor procurement. After GM approval, the **Purchasing Team** places the order (`Ordered`) without altering stock. When goods are delivered to the hotel loading dock, the **Storekeeper** inspects and receives them (`Received`), which increments warehouse stock, recalculates weighted average unit cost, and logs an `IN` movement.

---

## 2. Infrastructure & Access

### Firebase Services Configuration
| Component | Identifier / Detail | Purpose |
| :--- | :--- | :--- |
| **Project ID** | `purchase-70a3f` | Google Cloud / Firebase container |
| **Auth Domain** | `purchase-70a3f.firebaseapp.com` | Email/password authentication handler |
| **Hosting** | `https://purchase-70a3f.web.app` | Global CDN hosting for client SPA |
| **Database** | Cloud Firestore (Default) | Real-time NoSQL document database |
| **Functions** | `updateBudgetOnApproval` | Node.js trigger updating departmental spend on GM approval |
| **Region** | `us-central1` | Primary region |

### Default Administrative Access
* The initial **System Administrator** account was provisioned during setup.
* Administrators can manage staff accounts directly from the **User Management** screen without logging out, using an isolated Firebase secondary app client instance.

---

## 3. System Architecture & Workflows

```
                                  ┌───────────────────────────┐
                                  │   Hotel Staff Requester   │
                                  └─────────────┬─────────────┘
                                                │
                                  Submits Request (Pending)
                                                ▼
                                  ┌───────────────────────────┐
                                  │   General Manager Review  │
                                  └─────────────┬─────────────┘
                                                │
                          ┌─────────────────────┴─────────────────────┐
                          ▼                                           ▼
               [Flow A: Requisition]                        [Flow B: Purchase Order]
                          │                                           │
                    GM Approves                                  GM Approves
            (Inventory Stock Unchanged)                  (Inventory Stock Unchanged)
                          │                                           │
                          ▼                                           ▼
            ┌───────────────────────────┐               ┌───────────────────────────┐
            │   Storekeeper Issue       │               │   Purchasing Places Order │
            │   (Dispenses physical     │               │   (Vendor details entered;│
            │    items to department)   │               │    Status -> 'Ordered';   │
            └─────────────┬─────────────┘               │    Stock Unchanged)       │
                          │                             └─────────────┬─────────────┘
                          │                                           │
                 Stock DECREASES (-)                           Shipment Arrives
              Logs 'OUT' Movement Entry                               │
                          │                                           ▼
                          ▼                             ┌───────────────────────────┐
             Status: 'Partially Issued'                 │   Storekeeper Goods Receipt│
                   or 'Issued'                          │   (Inspects delivery note,│
                                                        │    actual delivered qty)  │
                                                        └─────────────┬─────────────┘
                                                                      │
                                                             Stock INCREASES (+)
                                                        Recalculates Weighted Avg Cost
                                                           Logs 'IN' Movement Entry
                                                                      │
                                                                      ▼
                                                         Status: 'Partially Received'
                                                               or 'Received'
```

---

## 4. Roles & Permissions Matrix

The system provides 5 out-of-the-box roles, customizable at runtime by Administrators through the **Settings > Role Permissions** screen:

| Permission Identifier | Description | User | Purchasing | Storekeeper | General Manager | System Admin |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `create_request` | Submit new requisitions or purchase requests | ✅ | ✅ | ✅ | ✅ | ✅ |
| `view_all_requests` | View requests across all hotel departments | ❌ | ✅ | ✅ | ✅ | ✅ |
| `approve_requests` | Review, approve, or reject pending requests | ❌ | ❌ | ❌ | ✅ | ✅ |
| `manage_inventory` | Issue items, receive goods, edit SKUs, fill store | ❌ | ❌ | ✅ | ❌ | ✅ |
| `manage_budgets` | Set monthly departmental budget limits | ❌ | ❌ | ❌ | ✅ | ✅ |
| `view_reports` | Generate reports, export PDF & CSV summaries | ❌ | ✅ | ❌ | ✅ | ✅ |
| `manage_users` | Add, edit, suspend, and reset staff accounts | ❌ | ❌ | ❌ | ❌ | ✅ |
| `manage_settings` | Add/delete departments, customize permissions | ❌ | ❌ | ❌ | ❌ | ✅ |

* **Fail-Safe Guarantee:** System Administrator permissions cannot be unchecked or revoked in the UI.

---

## 5. Codebase Map

The project uses **vanilla ES Modules** (no compilation or bundler required):

```
public/
├── index.html          # Semantic HTML5 shell with Tailwind utility classes & modal containers
├── css/styles.css      # Dark mode variables, glassmorphism card styling, responsive overrides
└── js/
    ├── config.js       # Firebase SDK config, default roles, departments, permissions map
    ├── state.js        # Reactive centralized state (allRequestsCache, inventoryCache, activeFilter)
    ├── firebase.js     # Modular SDK initialization and re-exported Firestore/Auth primitives
    ├── ui.js           # Modal renderers, data tables, status badges, Chart.js integrations
    ├── actions.js      # Business logic: handleIssueRequisition, handleReceiveGoods, handleMarkAsOrdered
    ├── auth.js         # onAuthStateChanged listener, profile hydration, real-time Firestore sync
    └── app.js          # DOMContentLoaded initialization, event delegation, and form wiring
```

### File Details & Responsibilities
| File | Estimated Lines | Primary Responsibility |
| :--- | :---: | :--- |
| `public/index.html` | ~686 | UI layout, navigation bar, dashboard grids, modal host elements |
| `public/js/config.js` | ~85 | App constants, `ROLES`, `DEPARTMENTS`, `DEFAULT_ROLE_PERMISSIONS` |
| `public/js/state.js` | ~45 | Reactive store: active user profile, cached documents, flow filter |
| `public/js/ui.js` | ~1,680 | Renders tables, charts, badges, and modals (`Issue`, `Order`, `Receive`, `Details`) |
| `public/js/actions.js` | ~1,100 | Mutation logic, stock issue/receive math, weighted average cost, migrations |
| `public/js/auth.js` | ~160 | Handles user sessions, status checks, and Firestore `onSnapshot` listeners |
| `public/js/app.js` | ~460 | Central event delegation for click and submit events across all sections |
| `functions/index.js` | ~71 | Cloud Function: increments department budget spend upon request approval |
| `firestore.rules` | ~48 | Security rules restricting inventory writes strictly to Storekeeper & Admin |

---

## 6. Firestore Database Schema

### 1. `requests`
* `requestType`: string (`'Requisition'` or `'Purchase Order'`)
* `department`: string (e.g. `'Kitchen'`, `'Housekeeping'`)
* `priority`: string (`'Normal'`, `'High'`, `'Urgent'`)
* `requiredBy`: string (delivery deadline, `YYYY-MM-DD`)
* `notes`: string (requester remarks)
* `items`: array of objects:
  * `name`: string
  * `quantity`: number (total units requested/ordered)
  * `unit`: string (`'Each'`, `'Box'`, `'Kg'`, `'Liter'`, `'Set'`)
  * `price`: number (estimated or negotiated unit price)
  * `issuedQuantity`: number (cumulative units dispensed by storekeeper)
  * `receivedQuantity`: number (cumulative units received by storekeeper)
  * `actualPrice`: number (actual delivery invoice unit price)
* `totalCost`: number (sum of `quantity * price`)
* `status`: string (`'Pending'`, `'Approved'`, `'Ordered'`, `'Partially Issued'`, `'Issued'`, `'Partially Received'`, `'Received'`, `'Rejected'`)
* `supplier`: string (vendor name, populated when ordered)
* `orderRef`: string (vendor quote or PO reference)
* `expectedDeliveryDate`: string (`YYYY-MM-DD`)
* `purchasingNotes`: string (order terms entered by Purchasing)
* `orderedAt`: timestamp
* `orderedBy`: string (user ID)
* `approvalNotes`: string (remarks from GM approval)
* `lastIssuedAt`: timestamp
* `lastIssuedBy`: string
* `lastIssuedRecipient`: string (staff member receiving goods)
* `lastReceivedAt`: timestamp
* `lastReceivedBy`: string
* `deliveryNote`: string (vendor invoice or delivery note number)
* `createdAt`: timestamp
* `createdBy`: string (UID)
* `createdByEmail`: string

### 2. `inventory`
* `name`: string (item SKU name, unique)
* `category`: string (e.g. `'Kitchen'`, `'Housekeeping'`, `'Store'`)
* `stock`: number (current physical units in hotel warehouse)
* `min`: number (minimum reorder threshold)
* `price`: number (current weighted average unit valuation)

### 3. `stock_movements` (Immutable Ledger)
* `itemId`: string (references `inventory` doc)
* `itemName`: string
* `category`: string
* `type`: string (`'IN'` for vendor receipt, `'OUT'` for department issuance)
* `quantity`: number (units moved)
* `previousStock`: number (stock prior to transaction)
* `newStock`: number (stock after transaction)
* `unitPrice`: number (applicable for `IN` receipts)
* `department`: string (destination department for `OUT`, or `'Store'` for `IN`)
* `recipient`: string (staff recipient or warehouse location)
* `supplier`: string (vendor for `IN` movements)
* `reason`: string (requisition/PO ID reference and delivery notes)
* `issuedBy`: string (UID of executing user)
* `issuedByEmail`: string
* `timestamp`: timestamp

### 4. `users`
* `email`: string
* `role`: string (`'User'`, `'Purchasing'`, `'Storekeeper'`, `'General Manager'`, `'System Administrator'`)
* `department`: string
* `status`: string (`'Active'` or `'Suspended'`)
* `createdAt`: timestamp

### 5. `departments`
* `name`: string
* `createdAt`: timestamp
* `createdBy`: string

### 6. `settings` (`settings/permissions`)
* Keyed by role name containing array of authorized permission strings.

---

## 7. Security & Database Rules

Enforced via `firestore.rules`:
* **Anonymous Access Denied:** All queries require active authentication.
* **Storekeeper Access Lock:** Writes to `/inventory/{itemId}` and `/stock_movements/{movementId}` strictly require:
  ```javascript
  getUserData().role in ['Storekeeper', 'Store Keeper', 'System Administrator']
  ```
* **Separation of Duties:** Purchasing and general department users are prevented at the database level from manually inflating or adjusting stock numbers.

---

## 8. Deployment & Routine Maintenance

### Deployment Command
Always use quotes when deploying multiple targets on Windows PowerShell:
```powershell
firebase deploy --only "hosting,firestore:rules"
```

### Routine Operational Runbook
1. **Adding a New Department:**
   Navigate to **Settings > Department Management**, enter department name, and click "Add Department". Instantly appears across all dropdowns.
2. **Assigning the Storekeeper Role:**
   Navigate to **User Management**, edit the target staff member, and set Role to **`Storekeeper`** (Department: `Store`).
3. **Restocking Low Items:**
   Storekeepers can click **"Restock Low Items"** in the Inventory tab to automatically generate a pre-filled Purchase Order for all items below their minimum thresholds.
4. **Physical Stock Audits:**
   Click **"Stock Movement Log"** in the Inventory tab to inspect the full timeline of goods entering and leaving the warehouse.

---

*Handover document maintained for Abel Amare — Hotel PO System.*
