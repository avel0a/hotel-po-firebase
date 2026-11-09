# Hotel Purchase Order System — Complete Documentation

> **Version:** 2.0 (Professional Multi-File)
> **Last Updated:** November 2026
> **Platform:** Firebase (Hosting + Firestore + Cloud Functions + Authentication)

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Requirements](#2-system-requirements)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Technology Stack](#5-technology-stack)
6. [User Roles & Permissions](#6-user-roles--permissions)
7. [Firestore Data Model](#7-firestore-data-model)
8. [Authentication Flow](#8-authentication-flow)
9. [Feature Walkthrough](#9-feature-walkthrough)
   - [9.1 Login](#91-login)
   - [9.2 Dashboard](#92-dashboard)
   - [9.3 New Purchase Request](#93-new-purchase-request)
   - [9.4 My Requests](#94-my-requests)
   - [9.5 Approvals](#95-approvals)
   - [9.6 Inventory Management](#96-inventory-management)
   - [9.7 Budgeting](#97-budgeting)
   - [9.8 Reports & PDF Export](#98-reports--pdf-export)
   - [9.9 User Management](#99-user-management)
   - [9.10 Dark Mode](#910-dark-mode)
10. [Request Lifecycle](#10-request-lifecycle)
11. [Real-Time Data Flow](#11-real-time-data-flow)
12. [Cloud Functions](#12-cloud-functions)
13. [Security Rules](#13-security-rules)
14. [Configuration Reference](#14-configuration-reference)
15. [Deployment](#15-deployment)
16. [Mobile Responsiveness](#16-mobile-responsiveness)
17. [Troubleshooting & FAQ](#17-troubleshooting--faq)
18. [Known Limitations](#18-known-limitations)

---

## 1. Overview

The **Hotel Purchase Order System** is a web application designed for hotel operations teams to create, track, approve, and report on internal purchase requests. It replaces paper-based and spreadsheet-driven procurement workflows with a centralized, real-time system.

### What it does

| Capability | Description |
|---|---|
| **Purchase Requests** | Staff submit itemized requests with quantities, estimated costs, and priority levels |
| **Approval Workflow** | The General Manager reviews and approves or rejects requests |
| **Inventory Tracking** | Purchasing staff and admins manage stock levels; stock automatically decreases when items are received |
| **Budget Management** | Monthly budgets are set per department; approved request spending is tracked against them |
| **Reporting** | Filterable reports with summary tables and downloadable PDF export |
| **User Management** | System Administrators create accounts with specific roles and department assignments |

### Key design choices

- **No build step** — All JavaScript is vanilla ES modules loaded directly by the browser.
- **CDN-based dependencies** — Tailwind CSS, Chart.js, jsPDF, and Font Awesome are loaded from CDNs.
- **Real-time updates** — Firestore `onSnapshot` listeners push data changes instantly to all connected clients.
- **Single-page application (SPA)** — Navigation is handled client-side by toggling `<section>` visibility; no page reloads.

---

## 2. System Requirements

### For end users (accessing the app)

- Modern web browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Internet connection (all data is stored in Firebase)
- Account created by a System Administrator

### For developers / deployers

- [Node.js](https://nodejs.org/) 18+ (for Cloud Functions)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- A Firebase project with:
  - Authentication (Email/Password provider enabled)
  - Cloud Firestore
  - Firebase Hosting
  - Cloud Functions (Blaze plan required)

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ HTML/CSS │ │ Chart.js │ │ jsPDF    │ │ Tailwind CSS│ │
│  └─────────┘ └──────────┘ └──────────┘ └─────────────┘ │
│  ┌──────────────────────────────────────────────────────┐│
│  │           JavaScript ES Modules                      ││
│  │  config → firebase → state ← auth                   ││
│  │                          ↕                           ││
│  │                    ui ← actions                      ││
│  │                          ↕                           ││
│  │                        app                           ││
│  └──────────────────────────────────────────────────────┘│
└────────────────────┬──────────────────────────────────────┘
                     │  Firebase SDK (v10.x compat)
                     ▼
┌─────────────────────────────────────────────────────────┐
│                 Firebase Backend                         │
│  ┌──────────────┐ ┌───────────┐ ┌─────────────────────┐ │
│  │ Hosting      │ │ Auth      │ │ Cloud Firestore     │ │
│  │ (static)     │ │ (email/   │ │ (real-time DB)      │ │
│  │              │ │  password)│ │                     │ │
│  └──────────────┘ └───────────┘ └──────────┬──────────┘ │
│                                            │            │
│  ┌─────────────────────────────────────────┘            │
│  │  Cloud Functions (Node.js)                           │
│  │  └─ onRequestStatusChange: Firestore trigger         │
│  │     → Updates budget spending when request approved   │
│  │     → Decreases inventory stock when marked received  │
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Data flow summary

1. **User opens the app** → Firebase Hosting serves static files (HTML, CSS, JS)
2. **User logs in** → Firebase Auth validates credentials, returns auth token
3. **Auth state detected** → App loads user profile from `users` collection, sets up Firestore listeners
4. **Real-time listeners** → `onSnapshot` on `requests`, `inventory`, `budgets`, `users` collections push data updates to all connected clients simultaneously
5. **User submits a request** → Document written to `requests` collection
6. **GM approves a request** → Status field updated, Cloud Function triggers:
   - Calculates total cost and adds to the department's monthly budget `spending` field
7. **User marks request as received** → Status field updated, Cloud Function triggers:
   - Decreases `currentStock` on each item in the `inventory` collection

---

## 4. Project Structure

```
hotel-po-firebase-v2/
├── public/                     # Firebase Hosting root (served to browsers)
│   ├── index.html              # Single-page HTML shell (~407 lines)
│   ├── css/
│   │   └── styles.css          # All custom CSS + Tailwind overrides
│   └── js/
│       ├── config.js           # Firebase config, departments, roles, units
│       ├── firebase.js         # Firebase SDK initialization & re-exports
│       ├── state.js            # Centralized mutable application state
│       ├── ui.js               # DOM rendering, modals, charts, navigation
│       ├── actions.js          # CRUD operations, form handlers, PDF export
│       ├── auth.js             # Auth listener, user profile, data subscriptions
│       └── app.js              # Entry point: DOMContentLoaded, event bindings
├── functions/                  # Cloud Functions (Node.js)
│   ├── index.js                # Firestore trigger: onRequestStatusChange
│   ├── package.json            # Dependencies (firebase-admin, firebase-functions)
│   └── .eslintrc.js            # ESLint configuration
├── firebase.json               # Firebase project configuration
├── .firebaserc                 # Project alias (purchase-70a3f)
├── firestore.rules             # Firestore security rules
├── firestore.indexes.json      # Composite index definitions
├── .gitignore                  # Git ignore patterns
├── README.md                   # Project overview and setup guide
├── HANDOVER.md                 # Technical handover document
└── DOCUMENTATION.md            # This file
```

### Module dependency graph

```
config.js          (no imports — pure constants)
    ↓
firebase.js        (imports config.js — initializes Firebase SDK)
    ↓
state.js           (no imports — exports mutable state object)
    ↓
ui.js              (imports state.js — all rendering and UI manipulation)
    ↓
actions.js         (imports state.js, firebase.js, ui.js — business logic)
    ↓
auth.js            (imports state.js, firebase.js, ui.js — auth + listeners)
    ↓
app.js             (imports auth.js, actions.js, ui.js — wires everything up)
```

> **Why this order matters:** The modules are designed to avoid circular dependencies. `ui.js` never imports `actions.js`, and `actions.js` never imports `auth.js`. All cross-module coordination happens through the shared `state.js` object.

---

## 5. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Markup** | HTML5 | Page structure |
| **Styling** | Tailwind CSS (CDN) | Utility-first responsive styling |
| **Styling** | Custom CSS (`styles.css`) | Animations, glassmorphism, gradients, print styles |
| **Icons** | Font Awesome 6.4 (CDN) | UI icons |
| **Fonts** | Google Fonts (Inter, Montserrat, Pacifico) | Typography |
| **Charts** | Chart.js (CDN) | Dashboard & budget charts |
| **PDF** | jsPDF + AutoTable (CDN) | Report PDF generation |
| **Auth** | Firebase Authentication | Email/password sign-in |
| **Database** | Cloud Firestore | Real-time NoSQL document store |
| **Hosting** | Firebase Hosting | Static file serving with CDN |
| **Backend** | Firebase Cloud Functions (Node.js 18) | Server-side Firestore triggers |

---

## 6. User Roles & Permissions

The system defines four roles, each with specific access to sections and actions:

| Permission | User | Purchasing | General Manager | System Administrator |
|---|:---:|:---:|:---:|:---:|
| View Dashboard | ✅ | ✅ | ✅ | ✅ |
| Create Purchase Requests | ✅ | ✅ | ✅ | ✅ |
| View Own Requests | ✅ | ✅ | ✅ | ✅ |
| View All Requests | ❌ | ❌ | ✅ | ✅ |
| Mark Received | ✅ | ✅ | ✅ | ✅ |
| Approve / Reject Requests | ❌ | ❌ | ✅ | ❌ |
| Manage Inventory | ❌ | ✅ | ❌ | ✅ |
| Set Budgets | ❌ | ❌ | ✅ | ✅ |
| View Reports | ❌ | ✅ | ✅ | ✅ |
| Manage Users | ❌ | ❌ | ❌ | ✅ |

### How roles are assigned

1. A System Administrator creates a new user account via the **User Management** section.
2. The admin selects a **role** and **department** during creation.
3. The role is stored in the user's Firestore document (`users/{uid}`).
4. On login, the app reads the role and shows/hides sidebar links and action buttons using the `requires-role` CSS class and `data-role` attributes.

### Department auto-selection

When a user creates a purchase request, the **Department** dropdown is automatically set to their assigned department. They can change it if needed, but this ensures requests are associated with the correct department by default.

---

## 7. Firestore Data Model

### Collection: `users`

Stores user profile data. Document ID = Firebase Auth UID.

| Field | Type | Description |
|---|---|---|
| `email` | string | User's email address |
| `role` | string | One of: `User`, `Purchasing`, `General Manager`, `System Administrator` |
| `department` | string | Assigned department (e.g., `Kitchen`, `Housekeeping`) |
| `createdAt` | timestamp | Account creation time |

### Collection: `requests`

Stores purchase requests. Document ID = auto-generated.

| Field | Type | Description |
|---|---|---|
| `requestId` | string | Human-readable ID (e.g., `PO-ABC12`) |
| `userId` | string | Auth UID of the requester |
| `userEmail` | string | Email of the requester |
| `department` | string | Department the request is for |
| `priority` | string | `Normal`, `High`, or `Urgent` |
| `requiredByDate` | string | ISO date string (YYYY-MM-DD) |
| `notes` | string | Free-text notes |
| `items` | array | List of item objects (see below) |
| `totalCost` | number | Sum of all item subtotals |
| `status` | string | `Pending`, `Approved`, or `Rejected` |
| `createdAt` | timestamp | Request submission time |
| `approvedBy` | string | (Optional) Email of the approver |
| `approvedAt` | timestamp | (Optional) Approval/rejection time |
| `rejectionReason` | string | (Optional) Reason for rejection |
| `receivedAt` | timestamp | (Optional) Time items were received |

#### Item object structure

```json
{
  "name": "Bed Sheets (King)",
  "quantity": 50,
  "unit": "Each",
  "estimatedPrice": 25.00,
  "subtotal": 1250.00
}
```

### Collection: `inventory`

Stores inventory items. Document ID = auto-generated.

| Field | Type | Description |
|---|---|---|
| `name` | string | Item name |
| `category` | string | Category (matches department names + Office) |
| `price` | number | Unit price |
| `currentStock` | number | Current quantity in stock |
| `minimumStock` | number | Minimum threshold (below = "Low Stock") |
| `unit` | string | Unit of measurement (`Each`, `Box`, `Kg`, `Liter`, `Set`) |
| `createdAt` | timestamp | When the item was added |

### Collection: `budgets`

Stores monthly department budgets. Document ID = `YYYY-MM_Department` (e.g., `2026-11_Kitchen`).

| Field | Type | Description |
|---|---|---|
| `department` | string | Department name |
| `month` | string | Month in `YYYY-MM` format |
| `budget` | number | Allocated budget amount |
| `spending` | number | Total approved spending (updated by Cloud Function) |

---

## 8. Authentication Flow

```
┌─────────┐     ┌──────────────┐     ┌───────────────┐     ┌─────────────┐
│  Login   │────>│ Firebase Auth │────>│ Auth Listener │────>│ Load Profile│
│  Form    │     │ signIn()     │     │ onAuthState() │     │ from /users │
└─────────┘     └──────────────┘     └───────────────┘     └──────┬──────┘
                                                                   │
                                                                   ▼
                                                          ┌─────────────────┐
                                                          │ Setup Firestore │
                                                          │ Listeners       │
                                                          │ (onSnapshot)    │
                                                          └────────┬────────┘
                                                                   │
                                                                   ▼
                                                          ┌─────────────────┐
                                                          │ Show App UI     │
                                                          │ (hide login)    │
                                                          └─────────────────┘
```

### Step-by-step

1. User enters email and password on the login page.
2. `firebase.auth().signInWithEmailAndPassword()` is called.
3. If credentials are valid, `onAuthStateChanged` fires with the user object.
4. The app reads the user's profile document from `users/{uid}` in Firestore.
5. User's role and department are stored in `state.userRole` and `state.userDepartment`.
6. Firestore real-time listeners are set up for all collections.
7. The login page is hidden and the main app container is shown.
8. Navigation items are filtered based on the user's role.

### Logout

1. User clicks **Logout** from the profile dropdown.
2. `firebase.auth().signOut()` is called.
3. `onAuthStateChanged` fires with `null`.
4. All Firestore listeners are unsubscribed (prevents data leaks).
5. The app container is hidden and the login page is shown.

---

## 9. Feature Walkthrough

### 9.1 Login

**Location:** Full-screen overlay — shown by default when no user is authenticated.

**How to use:**
1. Enter your email address (provided by the System Administrator).
2. Enter your password.
3. Click **Login**.
4. If credentials are incorrect, a red notification toast appears at the bottom-right.
5. On success, the login page fades away and the Dashboard is shown.

**Important:** There is no self-registration. All accounts are created by a System Administrator through the User Management section.

---

### 9.2 Dashboard

**Location:** Sidebar → **Dashboard** (default landing page after login)

The Dashboard provides an at-a-glance overview of the system:

#### Stat Cards (top row)
Four cards showing counts:
- **Pending Requests** — Requests awaiting approval
- **Approved Requests** — Requests that have been approved
- **Rejected Requests** — Requests that have been rejected
- **Low Stock Items** — Inventory items where `currentStock < minimumStock`

> **Tip:** Clicking on the **Pending**, **Approved**, or **Rejected** stat cards filters the Recent Requests table below to show only requests with that status. A "Clear Filter" button appears to reset.

#### Charts
- **Requests per Month (Last 12 Months)** — A line chart showing request volume trends.
- **Request Status Overview** — A doughnut chart showing the proportion of Pending / Approved / Rejected requests.

#### Quick Actions
Buttons for common tasks:
- **New Purchase Request** → Navigates to the New Request form
- **View My Requests** → Navigates to My Requests
- **Pending Approvals** → (Visible to General Manager only) Navigates to Approvals
- **Generate Report** → (Visible to GM, Admin, Purchasing) Navigates to Reports

#### Recent Requests Table
Shows the most recent requests with:
- Request ID (e.g., `PO-ABC12`)
- Department
- Number of items
- Status badge (color-coded)

---

### 9.3 New Purchase Request

**Location:** Sidebar → **New Request**, or the Floating Action Button (+ icon, bottom-right)

**How to create a request:**

1. **Department** — Pre-filled with your assigned department. Change if ordering for another department.
2. **Priority** — Select from `Normal`, `High`, or `Urgent`.
3. **Required By Date** — Date picker for when the items are needed.
4. **Notes** — Optional text field for additional context.
5. **Items Requested:**
   - Click **Add Item** to add a line item.
   - **Item Name** — Type to search. An autocomplete datalist suggests items from the inventory.
   - **Quantity** — Number of units needed.
   - **Unit** — Measurement unit (`Each`, `Box`, `Kg`, `Liter`, `Set`).
   - **Estimated Price** — Price per unit. If the item is in inventory, this auto-fills.
   - **Subtotal** — Automatically calculated as `Quantity × Estimated Price`.
   - Click the red ✕ button to remove an item row.
6. **Total Estimated Cost** — Displayed at the bottom, updated in real-time.
7. Click **Submit Request** to save.
8. On success, a green notification appears and you're redirected to My Requests.

#### Item autocomplete behavior

When you type in the Item Name field, the app matches against all inventory items. If you select an inventory item:
- The **Estimated Price** field is automatically filled with the item's inventory price.
- This helps maintain pricing consistency.

#### What happens on submit

- A new document is created in the `requests` collection.
- The `requestId` is auto-generated as `PO-` followed by 5 random alphanumeric characters.
- Status is set to `Pending`.
- The request appears immediately in all connected clients' dashboards.

---

### 9.4 My Requests

**Location:** Sidebar → **My Requests**

Shows all purchase requests submitted by the logged-in user (or all requests for GM/Admin roles).

#### Features

- **Search bar** — Filter requests by typing. Searches across department, request ID, and item names.
- **Table columns:** Date, Department, Total Cost, Priority, Status, Actions.
- **Status badges:** Color-coded — blue for Pending, green for Approved, red for Rejected.
- **Priority badges:** Gray for Normal, orange for High, red for Urgent.

#### Available actions

| Action | When Available | What it does |
|---|---|---|
| **View** (eye icon) | Always | Opens a modal showing full request details including all items, costs, notes, and approval info |
| **Mark Received** (check icon) | When status = `Approved` | Marks the request as received. **This triggers inventory stock decrease** via Cloud Function |

#### Request Details Modal

Clicking **View** opens a modal with:
- Request ID, date, department, priority
- Requester email
- Required-by date and notes
- Full item table (name, qty, unit, price, subtotal)
- Total cost
- Current status with approval/rejection details
- If rejected: the rejection reason
- If received: the received timestamp

---

### 9.5 Approvals

**Location:** Sidebar → **Approvals** (visible to **General Manager** only)

Shows all requests with `status = Pending` as expandable cards.

#### Each approval card shows:
- Request ID and submission date
- Requester's email
- Department and priority
- Items table (name, quantity, unit, price, subtotal)
- Total cost
- Notes

#### Actions per card:

**Approve:**
1. Click the green **Approve** button.
2. A confirmation dialog appears.
3. Confirm to approve.
4. The request status changes to `Approved`.
5. The Cloud Function triggers and adds the request's total cost to the department's monthly budget spending.

**Reject:**
1. Click the red **Reject** button.
2. A prompt appears asking for a rejection reason.
3. Enter the reason and confirm.
4. The request status changes to `Rejected`.
5. The rejection reason is stored on the request document.

---

### 9.6 Inventory Management

**Location:** Sidebar → **Inventory** (visible to **System Administrator** and **Purchasing** roles)

Provides full CRUD management for hotel inventory items.

#### Viewing inventory

- **Search** — Type in the search bar to filter items by name or category.
- **Sortable columns** — Click column headers (Item Name, Category, Price, Stock) to sort ascending/descending. An arrow indicator shows the current sort direction.
- **Stock status indicators:**
  - 🟢 **In Stock** — `currentStock ≥ minimumStock`
  - 🟡 **Low Stock** — `currentStock > 0` but `< minimumStock`
  - 🔴 **Out of Stock** — `currentStock = 0`

#### Adding an item

1. Click **Add Item** (top-right).
2. A modal appears with fields:
   - **Item Name** (required)
   - **Category** — Select from predefined categories
   - **Unit Price** (required)
   - **Current Stock** (required)
   - **Minimum Stock Level** — Threshold for low-stock alerts
   - **Unit** — Measurement unit
3. Click **Save**.
4. The item appears immediately in the inventory table.

#### Editing an item

1. Click the **Edit** (pencil icon) button in the item's row.
2. The same modal opens pre-filled with current values.
3. Modify fields and click **Save**.

#### Deleting an item

1. Click the **Delete** (trash icon) button.
2. A confirmation dialog appears.
3. Confirm to permanently delete the item from Firestore.

---

### 9.7 Budgeting

**Location:** Sidebar → **Budgeting** (visible to **General Manager** and **System Administrator**)

Manages monthly department budgets and tracks spending.

#### Setting a budget

1. Select a **Department** from the dropdown.
2. Select a **Month** (month picker input).
3. Enter a **Budget Amount** in dollars.
4. Click **Set Budget**.
5. If a budget already exists for that department-month combination, it is updated (overwritten).

#### Budgets Overview Table

A table showing all budgets for the current year:

| Column | Description |
|---|---|
| Department | Department name |
| Month | The budget month |
| Budget | Allocated amount |
| Spending | Total approved request cost for that department-month |
| Remaining | Budget − Spending |
| Usage | Progress bar showing percentage spent |

The progress bar changes color based on spending:
- **Green** (< 75%) — Under control
- **Yellow** (75-90%) — Approaching limit
- **Red** (> 90%) — Over or near budget

#### Budget vs Spending Chart

A bar chart at the bottom comparing budget allocations to actual spending for each department-month combination in the current year.

---

### 9.8 Reports & PDF Export

**Location:** Sidebar → **Reports** (visible to **General Manager**, **System Administrator**, **Purchasing**)

#### Filters

All filters are optional and combinable:
- **From Date** / **To Date** — Date range filter
- **Status** — Filter by `Pending`, `Approved`, or `Rejected`
- **Requested By** — Filter by specific user (dropdown populated from user list)

Click **Apply Filters** to update the report.

#### Summary Table

Shows aggregated data grouped by time period:

| Period | Total Requests | Total Cost | Approved | Rejected | Pending |
|---|---|---|---|---|---|
| Week 45, 2026 | 12 | $3,450 | 8 | 2 | 2 |
| November 2026 | 45 | $12,300 | 30 | 10 | 5 |
| 2026 | 180 | $48,000 | 120 | 40 | 20 |

Summaries are computed at three levels: **weekly**, **monthly**, and **yearly**.

#### Detailed Table

A row-per-request table showing:
- Date, Request ID, Requester, Department, Items (comma-separated), Total Cost, Priority, Status

#### PDF Export

Click **Download PDF** to generate a PDF of the currently filtered report.

The PDF includes:
- Report title and generation date
- Filter criteria applied
- Summary table
- Detailed request table
- Auto-formatted with alternating row colors

Generated using **jsPDF** with the **AutoTable** plugin for professional table rendering.

---

### 9.9 User Management

**Location:** Sidebar → **User Management** (visible to **System Administrator** only)

#### Creating a new user

1. Fill in the form:
   - **Email** — The new user's email address
   - **Password** — Temporary password (user should change it)
   - **Role** — Select from `User`, `Purchasing`, `General Manager`, `System Administrator`
   - **Department** — Select the user's primary department
2. Click **Create User**.
3. **Important:** Because Firebase creates the new user by signing in as them (client-side Auth limitation), the system requires the admin to **re-enter their own password** via a prompt to re-authenticate afterward. This is normal behavior.
4. The new user appears in the Existing Users table.

#### Existing Users Table

Displays all registered users with:
- Email
- Role
- Department
- Created At (timestamp)

> **Note:** There is currently no ability to edit or delete users from the UI. User modification must be done directly through the Firebase Console.

---

### 9.10 Dark Mode

**Location:** Toggle button in the top-right header (sun/moon icon)

- Click the **sun icon** (☀️) to switch to dark mode.
- Click the **moon icon** (🌙) to switch back to light mode.
- The preference is saved to `localStorage` and persists across sessions.
- All sections, modals, charts, and tables adapt to the dark theme.
- The Tailwind `dark:` variant classes handle the color switches.

---

## 10. Request Lifecycle

```
   ┌───────────┐
   │  Created   │ ← User submits form
   │  (Pending) │
   └─────┬─────┘
         │
    GM Reviews
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│Approved│ │ Rejected │ ← Reason stored
└───┬────┘ └──────────┘
    │
    │  Cloud Function:
    │  → Adds totalCost to budget spending
    │
    ▼
┌──────────┐
│ Received │ ← User clicks "Mark Received"
└──────────┘
    │
    │  Cloud Function:
    │  → Decreases inventory stock for each item
    │
    ▼
  [Complete]
```

### Status transitions

| From | To | Triggered By | Side Effects |
|---|---|---|---|
| — | `Pending` | User submits request | Request document created |
| `Pending` | `Approved` | GM clicks Approve | Cloud Function adds cost to budget `spending` |
| `Pending` | `Rejected` | GM clicks Reject | Rejection reason saved |
| `Approved` | `Received` | User clicks Mark Received | Cloud Function decreases inventory stock |

---

## 11. Real-Time Data Flow

The application uses Firestore's `onSnapshot` for real-time synchronization. When any user makes a change, all connected clients see it instantly.

### Listeners set up on login

| Collection | Query | Updates |
|---|---|---|
| `requests` | All docs (GM/Admin) or `where('userId', '==', uid)` (User/Purchasing) | Dashboard stats, charts, recent requests, my requests, approvals, reports |
| `inventory` | All docs | Inventory table, item autocomplete datalist, low-stock count |
| `budgets` | All docs | Budget overview table, budget chart |
| `users` | All docs | User management table, report filter dropdown |

### Data caching

All listener data is cached in `state.js`:
- `state.allRequestsCache` — All request documents
- `state.inventoryItemsCache` — All inventory items
- `state.budgetsCache` — All budget documents
- `state.allUsersCache` — All user documents

When a listener fires, the cache is replaced entirely with the new snapshot, and all dependent UI renders are called. This ensures the UI is always consistent with Firestore.

---

## 12. Cloud Functions

### `onRequestStatusChange`

**Trigger:** Firestore document update on `requests/{requestId}`

**Purpose:** Automates side effects when a request's status changes.

#### Behavior

```javascript
// Pseudo-code
if (statusChanged from !== 'Approved' && statusChanged to === 'Approved') {
    // Add total cost to the department's monthly budget spending
    budgetDoc = budgets/{Department}_{YYYY-MM}
    budgetDoc.spending += request.totalCost
}

if (statusChanged from !== 'Received' && statusChanged to === 'Received') {
    // Decrease inventory stock for each item
    for each item in request.items {
        inventoryItem = findByName(item.name)
        inventoryItem.currentStock -= item.quantity
    }
}
```

#### Budget document ID format

The Cloud Function uses the format `Department_YYYY-MM` (e.g., `Kitchen_2026-11`) when writing budget spending updates.

> **Known Issue:** The client-side budget management UI creates budget documents with the format `YYYY-MM_Department` (e.g., `2026-11_Kitchen`). This means the Cloud Function may create a separate document from what the UI shows. See [Known Limitations](#18-known-limitations) for details.

---

## 13. Security Rules

The current Firestore security rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

**What this means:**
- ✅ Any authenticated user can read and write any document in any collection.
- ❌ There is no role-based enforcement at the database level — role checks are purely client-side.
- ❌ A technically savvy user could bypass UI restrictions using the Firebase SDK directly.

**Recommended improvement:** Add granular rules that check user roles from the `users` collection or use Custom Claims. See [Known Limitations](#18-known-limitations).

---

## 14. Configuration Reference

### Firebase Configuration (`config.js`)

```javascript
export const firebaseConfig = {
    apiKey: "...",
    authDomain: "purchase-70a3f.firebaseapp.com",
    projectId: "purchase-70a3f",
    storageBucket: "purchase-70a3f.appspot.com",
    messagingSenderId: "...",
    appId: "...",
    measurementId: "..."
};
```

To connect to a different Firebase project, update all fields in this object.

### Application Constants

| Constant | File | Description |
|---|---|---|
| `DEPARTMENTS` | `config.js` | Array of 11 hotel departments |
| `INVENTORY_CATEGORIES` | `config.js` | Array of inventory categories (similar to departments) |
| `ROLES` | `config.js` | Array of 4 user roles |
| `UNITS` | `config.js` | Array of 5 measurement units |
| `PRIORITIES` | `config.js` | Array of 3 priority levels |

### Tailwind CSS Custom Theme (`index.html`)

Defined inline in `<script>tailwind.config = {...}</script>`:

| Token | Value | Usage |
|---|---|---|
| `hotel-primary` | `#1a365d` | Sidebar, buttons, headings |
| `hotel-secondary` | `#2c5282` | Hover states |
| `hotel-accent` | `#4299e1` | Links, highlights |
| `hotel-glass` | `rgba(255,255,255,0.15)` | Glassmorphism overlays |
| `vibrant-gold` | `#bfa76f` | Accent elements |

### Fonts

| Font | Usage |
|---|---|
| **Inter** | Body text (sans-serif) |
| **Montserrat** | Headings (font-heading) |
| **Pacifico** | Decorative accent text (font-accent) |

---

## 15. Deployment

### Prerequisites

1. Install Firebase CLI: `npm install -g firebase-tools`
2. Login to Firebase: `firebase login`
3. Ensure the Firebase project (`purchase-70a3f`) has Blaze plan (required for Cloud Functions)

### Deploy steps

```bash
# Navigate to the project
cd hotel-po-firebase-v2

# Install Cloud Functions dependencies
cd functions && npm install && cd ..

# Deploy everything (hosting + functions + rules + indexes)
firebase deploy

# Or deploy individually:
firebase deploy --only hosting          # Static files only
firebase deploy --only functions        # Cloud Functions only
firebase deploy --only firestore:rules  # Security rules only
```

### Post-deployment checklist

- [ ] Visit the Hosting URL shown in deployment output
- [ ] Test login with an existing account
- [ ] Create a test purchase request
- [ ] Verify real-time updates by opening the app in two browser tabs
- [ ] Test approval flow (with a GM account)
- [ ] Test inventory stock decrease by marking a request as received
- [ ] Verify PDF export generates correctly

### Firebase Hosting URL

The app is hosted at: `https://purchase-70a3f.web.app` (or `https://purchase-70a3f.firebaseapp.com`)

---

## 16. Mobile Responsiveness

The app is fully responsive and works on mobile devices:

| Feature | Mobile Behavior |
|---|---|
| **Sidebar** | Collapsed by default. Opens as an overlay via the hamburger menu (☰) in the header. |
| **Sidebar close** | ✕ button in the sidebar header, or tapping outside the sidebar. |
| **Tables** | Horizontally scrollable (`overflow-x-auto`) to prevent layout breaking. |
| **Forms** | Stack vertically on small screens (`grid-cols-1`). |
| **Stat cards** | Stack in 1 column on mobile, 2 on tablet, 4 on desktop. |
| **Charts** | Resize within their containers. |
| **Floating Action Button** | Fixed position (bottom-right), always accessible for quick request creation. |

### Breakpoints

Uses Tailwind's default breakpoints:
- `sm` — 640px
- `md` — 768px (sidebar, multi-column grids)
- `lg` — 1024px (4-column stat cards, side-by-side charts)

---

## 17. Troubleshooting & FAQ

### Login Issues

**Q: I can't log in — "Invalid credentials" error.**
- Verify the email and password are correct.
- Accounts are created by the System Administrator — contact them if you don't have credentials.
- Check if the Firebase Auth service is enabled in the Firebase Console (Authentication → Sign-in Method → Email/Password should be **Enabled**).

**Q: After creating a new user, I got logged out.**
- This is expected behavior. Firebase client-side Auth signs in as the new user during creation. The app re-authenticates the admin automatically by prompting for the admin password.

### Data Not Loading

**Q: The dashboard shows zeros / no data appears.**
- Check your internet connection.
- Open the browser developer console (F12) and look for errors.
- Verify Firestore is accessible: check the Firebase Console → Firestore Database.
- Ensure Firestore security rules allow authenticated reads.

**Q: Changes I make don't appear for other users.**
- This should work automatically via real-time listeners. Check if the other user's browser tab is still connected (no offline indicator).
- Hard-refresh the page (Ctrl+Shift+R) to re-establish listeners.

### Inventory

**Q: Stock didn't decrease after marking a request as received.**
- The Cloud Function handles this. Check the Functions log in the Firebase Console for errors.
- The function matches inventory items by **exact name**. If the item name in the request doesn't match any inventory item name, stock won't decrease.

### Budgets

**Q: Budget spending isn't updating after approving a request.**
- The Cloud Function may use a different document ID format than the UI. See [Known Limitations](#18-known-limitations).
- Check the Firebase Console → Firestore → `budgets` collection for duplicate documents with different ID formats.

### PDF Export

**Q: PDF is blank or missing data.**
- Apply report filters first, then click **Download PDF**.
- If no requests match the filters, the PDF will be empty.
- Ensure jsPDF and AutoTable scripts are loading from CDN (check network tab in DevTools).

### Deployment

**Q: `firebase deploy` fails with permission errors.**
- Run `firebase login` to re-authenticate.
- Ensure you have Editor or Owner access on the Firebase project.
- For Cloud Functions: the project must be on the Blaze (pay-as-you-go) plan.

**Q: Cloud Functions fail after deployment.**
- Check the Functions log: Firebase Console → Functions → Logs.
- Run `cd functions && npm install` before deploying to ensure all dependencies are installed.
- Ensure Node.js version matches `engines.node` in `functions/package.json` (currently "18").

---

## 18. Known Limitations

### 1. Budget Document ID Mismatch

The Cloud Function (`functions/index.js`) creates/updates budget documents with the ID format `Department_YYYY-MM` (e.g., `Kitchen_2026-11`), while the client-side UI creates budgets with the format `YYYY-MM_Department` (e.g., `2026-11_Kitchen`).

**Impact:** When the Cloud Function updates spending for an approved request, it may create a separate document from the one the UI displays. The budget overview table may show \$0 spending even though spending has been recorded in a differently-named document.

**Workaround:** Manually check the `budgets` collection in the Firebase Console for duplicate entries.

### 2. Client-Side Security Only

Role-based access is enforced only in the UI (hiding/showing elements). The Firestore rules allow any authenticated user to read/write all collections. A user with developer tools knowledge could bypass UI restrictions.

**Recommendation:** Implement server-side role checking using Firebase Custom Claims or granular Firestore rules.

### 3. No Password Reset Flow

There is no "Forgot Password" link or self-service password reset. Users must contact the System Administrator, who would need to use the Firebase Console to reset passwords.

### 4. No User Edit / Delete from UI

The User Management section only supports creating users. Editing roles/departments or deleting users must be done through the Firebase Console (Authentication for account deletion, Firestore for profile updates).

### 5. No Pagination

Request lists, inventory tables, and user tables load all documents at once. For very large datasets (thousands of records), this could cause performance issues.

### 6. CDN Dependency

All third-party libraries (Tailwind, Chart.js, jsPDF, Font Awesome, Google Fonts) are loaded from CDNs. The app requires an internet connection and will not work offline.

### 7. Single Approver Model

Only the **General Manager** role can approve requests. There is no multi-level approval chain, delegation, or approval thresholds.

### 8. No Audit Log

Status changes, inventory modifications, and user actions are not logged in an audit trail. Only the final state is stored.

---

*This documentation covers the Hotel Purchase Order System v2.0. For the technical handover, see [HANDOVER.md](HANDOVER.md). For setup instructions, see [README.md](README.md).*
