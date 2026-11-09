# 🏨 Hotel Purchase Order System

A full-featured **Hotel Procurement, Inventory, & Requisition Management** web application built for hotel operations, powered by **Firebase** (Authentication, Firestore, Cloud Functions, Hosting).

![Firebase](https://img.shields.io/badge/Firebase-v11.6.1-FFCA28?logo=firebase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-CDN-06B6D4?logo=tailwindcss&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-v4-FF6384?logo=chartdotjs&logoColor=white)
![License](https://img.shields.io/badge/License-Private-red)

---

## ✨ Features

### 🔄 Dual-Lifecycle Procurement & Fulfillment Engine
The system enforces strict separation between internal store usage and vendor purchasing:

* **Flow A: Department Requisitions (Stock Decreases)**
  * **Submit:** Hotel departments (Kitchen, Housekeeping, Maintenance, etc.) request supplies from the hotel store (`Pending`).
  * **Approval:** General Manager reviews and approves (`Approved`). *Approval never alters inventory stock.*
  * **Dispense / Issue:** Storekeeper fulfills requested items from store stock. Supports partial issue (`Partially Issued`) and full issue (`Issued`).
  * **Stock Impact:** Store inventory **decreases** atomically, cost is recorded against the department, and an audit trail entry (`OUT`) is logged.

* **Flow B: Purchase Orders (Stock Increases)**
  * **Submit:** Purchasing or Store creates restock requests for depleted items or capital goods (`Pending`).
  * **Approval:** General Manager reviews and approves (`Approved`). *Approval never alters inventory stock.*
  * **Place Order:** Purchasing team places the order with external suppliers and marks it as **`Ordered`** (vendor name, quote ref, expected delivery date). *Purchasing never edits inventory stock.*
  * **Receive Goods:** When goods arrive at the loading dock, the Storekeeper inspects and checks in the shipment. Supports partial receipt (`Partially Received`) and complete receipt (`Received`).
  * **Stock Impact:** Store inventory **increases** using the quantity physically received, the **Weighted Average Unit Cost** is dynamically recalculated, and an audit trail entry (`IN`) is logged.

---

### Core Modules
* **📊 Interactive Dashboard** — Real-time metrics (Pending, Approved, Rejected, Low Stock items), status breakdown doughnut charts, monthly request volume bar charts, and quick-filter stat cards.
* **📝 Requisition & Purchase Order Management** — Tabbed request tracking with live count pills (**All**, **Dept Requisitions**, **Purchase Orders**); itemized line items with auto-complete from inventory; priority tags; required-by dates; and real-time status badges.
* **✅ General Manager Approvals** — Dedicated approval center with distinct badges for Dept Requisitions (store stock out) vs. Purchase Orders (vendor spend), item breakdown, estimated total, requester profile, and optional approval/rejection notes.
* **📦 Hotel Store & Warehouse Management** — Track warehouse stock on hand, minimum reorder thresholds, unit prices, and category assignments. Includes **Receive / Fill Store (Stock In)** for direct vendor deliveries, **Issue Stock (Stock Out)** for walk-up staff issuances, and **1-Click "Restock Low Items"** quick ordering.
* **📜 Immutable Movement Audit Trail** — Full ledger recording every `IN` (vendor receipt) and `OUT` (department issuance) transaction with timestamps, staff IDs, department, and delivery references.
* **💰 Department Budgeting** — Allocate monthly departmental budgets; real-time visual progress bars track spent vs. allocated funds; automated Cloud Function integration.
* **📈 Reports & Document Export** — Date range and department filtering; generate professional, print-ready PDF summaries or download standard CSV data files.
* **👤 User & Staff Management** — Administrators can add staff accounts seamlessly without logging out; update user roles and departments; toggle account status (Active / Suspended); send password reset links; and search users in real time.
* **⚙️ Dynamic Settings & Role Permissions** — Add or delete hotel departments with real-time propagation across all dropdowns; customize the granular 8-point permission matrix per role with fail-safe Administrator protection.

---

## 🔑 User Roles & Permissions

Strict segregation of duties enforced both in the UI and at the Firestore security rule level:

| Role | Requisitions | Purchase Orders | Approve / Reject | Place Order | Issue Items | Receive Goods | Inventory Stock Edit | Budgets | Settings & Users |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **User (Dept)** | Create & View Own | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Purchasing** | View All | Create & View All | ❌ | ✅ (`Ordered`) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Storekeeper** | View All | View All | ❌ | ❌ | ✅ (`Issue`) | ✅ (`Receive`) | ✅ (+ / -) | ❌ | ❌ |
| **General Manager** | View All | View All | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **System Admin** | Full | Full | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 🏗️ Project Structure

```
hotel-po-firebase-v2/
├── public/                          # Hosted frontend files
│   ├── index.html                   # Semantic HTML5 shell with Tailwind utility classes
│   ├── css/
│   │   └── styles.css               # Custom theme styles, scrollbars, animations
│   └── js/
│       ├── config.js                # Firebase configuration, departments, roles, permissions matrix
│       ├── state.js                 # Central reactive state object (caches, filters, active user)
│       ├── firebase.js              # Firebase Modular SDK initialization & re-exports
│       ├── ui.js                    # DOM rendering, modals (Issue, Order, Receive), charts, theme
│       ├── actions.js               # CRUD mutations, transactions, stock adjustments, weighted average cost
│       ├── auth.js                  # Auth state listener, profile hydration, real-time Firestore listeners
│       └── app.js                   # Application entry point & centralized event delegation
├── functions/                       # Firebase Cloud Functions (Node.js 20+)
│   ├── index.js                     # Firestore trigger: auto-increments budget spent on approval
│   ├── package.json
│   └── .eslintrc.js
├── firebase.json                    # Firebase deployment configuration (Hosting, Firestore, Functions)
├── firestore.rules                  # Role-based Firestore security rules
├── firestore.indexes.json           # Composite index definitions
├── .firebaserc                      # Firebase project aliases
├── DOCUMENTATION.md                 # Full technical system architecture and operational manual
├── HANDOVER.md                      # Operational handover, credential guide, and runbook
└── README.md                        # Project summary
```

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) v18+ (v20 or v22 recommended)
* [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
* Active Firebase project with **Authentication**, **Cloud Firestore**, and **Firebase Hosting**

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/avel0a/hotel-po-firebase.git
cd hotel-po-firebase

# 2. Install Cloud Functions dependencies
cd functions
npm install
cd ..

# 3. Authenticate with Firebase
firebase login

# 4. Link project
firebase use purchase-70a3f
```

### Local Testing

```bash
# Run local emulator
firebase emulators:start --only hosting
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

### Deployment

```bash
# Deploy both web application and security rules
firebase deploy --only "hosting,firestore:rules"

# Deploy Cloud Functions
firebase deploy --only functions
```

---

## 🗄️ Firestore Collections

| Collection | Key Fields | Purpose |
| :--- | :--- | :--- |
| **`users`** | `email`, `role`, `department`, `status` ('Active' / 'Suspended'), `createdAt` | Staff accounts and RBAC profiles |
| **`requests`** | `requestType` ('Requisition' / 'Purchase Order'), `department`, `items[]`, `totalCost`, `priority`, `status`, `supplier`, `orderRef`, `expectedDeliveryDate`, `issuedQuantity`, `receivedQuantity`, `approvalNotes`, `createdAt`, `createdBy` | Central procurement and requisition documents |
| **`inventory`** | `name`, `category`, `stock`, `min`, `price` | Warehouse SKUs, stock levels, and weighted average cost |
| **`stock_movements`** | `itemId`, `itemName`, `category`, `type` ('IN' / 'OUT'), `quantity`, `previousStock`, `newStock`, `department`, `recipient`, `reason`, `issuedBy`, `timestamp` | Immutable audit trail of every stock change |
| **`budgets`** | `department`, `month` (YYYY-MM), `amount`, `year`, `month_num` | Monthly departmental spending allocations |
| **`departments`** | `name`, `createdAt`, `createdBy` | Dynamic list of hotel departments |
| **`settings`** | `settings/permissions` document storing role-to-permission arrays | Live custom role permission matrix |

---

## 🛡️ Security Architecture

Security is enforced at the database layer via [`firestore.rules`](firestore.rules):
* **Strict Authentication:** Anonymous access is rejected across all collections.
* **Storekeeper / Admin Exclusivity:** Only users with `Storekeeper`, `Store Keeper`, or `System Administrator` roles can create, update, or delete records in `/inventory/{itemId}` and `/stock_movements/{movementId}`.
* **Workflow Integrity:** Request creation and status transitions are governed by role-specific validation checks.

---

## 📄 Documentation

* **[DOCUMENTATION.md](DOCUMENTATION.md)** — Complete developer and architectural manual, including detailed state flows, formulas, and UI specifications.
* **[HANDOVER.md](HANDOVER.md)** — Operational handover guide, administration checklist, and maintenance instructions.

---

## 📜 License
Proprietary hotel operations software. All rights reserved.
