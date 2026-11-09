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

### 7. `notifications`
* `recipientRole`: string (`'General Manager'`, `'Storekeeper'`, `'Purchasing'`, `'All'`)
* `recipientUserId`: string (specific user UID, or null for role broadcast)
* `title`: string
* `message`: string
* `type`: string (`'new_request'`, `'approved'`, `'rejected'`, `'ordered'`, `'issued'`, `'received'`, `'info'`)
* `requestId`: string
* `requestType`: string (`'requisition'` or `'purchase'`)
* `department`: string
* `readBy`: array of strings (UIDs of users who marked this notification as read)
* `createdAt`: timestamp

---

## 7. Security & Database Rules

Enforced via `firestore.rules`:
* **Anonymous Access Denied:** All queries require active authentication.
* **Role-Based Users Collection:** Authenticated users can read profiles and self-register on first login, but cannot alter `role`, `department`, or `status`. Only `System Administrator` can create users or alter staff roles and departments.
* **Granular Requests Permissions:**
  - Creation restricted to `status == 'Pending'` and `createdBy == auth.uid`.
  - Approval/Rejection restricted to `General Manager` and `System Administrator`.
  - Vendor ordering (`Ordered`) restricted to `Purchasing` and `System Administrator`.
  - Goods issuance/receipt (`Issued`, `Partially Issued`, `Received`, `Partially Received`) restricted to `Storekeeper` and `System Administrator`.
* **Storekeeper Inventory Lock:** Writes to `/inventory/{itemId}` and `/stock_movements/{movementId}` strictly require `Storekeeper` or `System Administrator`.
* **Immutable Audit Trail:** `/stock_movements/{movementId}` update and delete operations are permanently rejected (`allow update, delete: if false;`).
* **Budgets, Departments, Settings:** Modifiable only by `General Manager` and `System Administrator`.
* **In-App Notifications:** Authenticated users can read, create, and mark read; deletion restricted to `General Manager` and `System Administrator`.

---

## 8. Package Conversions & Dynamic Unit Pricing

The system solves the unit-of-measure pricing mismatch (e.g., 1 Kg of sugar vs. 1 Box or 25 Kg Bag of sugar):
1. **Base Unit & Package Size Configuration:**
   - In **Inventory & Store > Add/Edit Item**, items define their **Base Unit** (`Kg`, `Liter`, `Each`, `Box`, `Bottle`, `Bag`, `Pack`, `Roll`, `Can`, `Set`, `Carton`) and **Units per Package** (e.g. 25 kg per bag, 24 bottles per carton).
2. **Dynamic Request Form Calculation:**
   - In **New Request**, when an item is selected, its base unit price and package multiplier are loaded.
   - When the user selects a package unit (e.g., switching from `Kg` to `Bag` or `Box`), the unit price automatically scales by the package multiplier (`price * packageSize` or default package ratio).
   - The **Unit Price (Birr)** column is visible and directly editable, giving staff full transparency and manual flexibility before submission.
   - Subtotal (`quantity * unitPrice`) and total estimated cost recalculate live in real-time.

---

## 9. Real-Time In-App Notification System

1. **Header Notification Bell:**
   - Real-time Firestore subscription (`/notifications`) with an unread badge counter.
   - Dropdown feed showing recent alerts with distinct color-coded icons (New Request, Approved, Rejected, Ordered, Issued, Received).
   - One-click navigation to the relevant request view.
   - "Mark all read" button.
2. **Automated Cross-Role Workflow Alerts:**
   - **New Request Submitted:** Alerts the **Approval Manager** (`General Manager` / `System Administrator`).
   - **Requisition Approved (Flow A):** Alerts the **Storekeeper** to issue goods from the warehouse.
   - **Purchase Order Approved (Flow B):** Alerts the **Purchasing Team** to place the order with vendors.
   - **PO Marked as Ordered:** Alerts the **Storekeeper** that vendor goods have been ordered and will arrive soon.
   - **Goods Issued / Received:** Alerts the **Requester** and **Purchasing Team**.
3. **Sidebar Badge Counters:**
   - **Approvals Badge:** Displays count of pending requests for General Manager and Admin.
   - **Inventory & Store Badge:** Displays count of pending actions (approved requisitions to issue + ordered POs to receive) for Storekeeper and Admin.

---

## 10. Deployment & Routine Maintenance

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
4. **Physical Stock Audits & Reconciliation:**
   - Click **"Stock Movement Log"** in the Inventory tab to inspect the full timeline of goods entering and leaving the warehouse.
   - Click **"Stock Reconciliation"** (in Inventory or Reports) to compare recorded physical stock against the mathematical sum of all historical movements (`Total IN - Total OUT`), instantly highlighting discrepancies and offering CSV export.

---

*Handover document maintained for Abel Amare — Hotel PO System.*
