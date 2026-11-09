# 🔄 Project Handover Document

**Project:** Hotel Purchase Order System  
**Date:** November 2026  
**Author:** Abel  
**Status:** Production (Live on Firebase Hosting)

---

## 1. Project Overview

This is a **web-based inventory and purchase request management system** designed for hotel operations. Staff members submit purchase requests, which are reviewed and approved by General Managers. The system tracks inventory levels, department budgets, and generates reports.

**Live URL:** Hosted on Firebase Hosting under the project `purchase-70a3f`  
**Firebase Console:** https://console.firebase.google.com/project/purchase-70a3f

---

## 2. Access & Credentials

### Firebase Project
| Item              | Value                          |
|-------------------|--------------------------------|
| Project ID        | `purchase-70a3f`               |
| Auth Domain       | `purchase-70a3f.firebaseapp.com` |
| Hosting URL       | `https://purchase-70a3f.web.app` |
| Region            | Default (us-central1)          |

### Firebase Services in Use
- ✅ **Firebase Authentication** — Email/password sign-in
- ✅ **Cloud Firestore** — Primary database (6 collections: users, requests, inventory, budgets, stock_movements, departments + settings)
- ✅ **Firebase Hosting** — Static file hosting
- ✅ **Cloud Functions** — 1 function (`updateBudgetOnApproval`)

### Default Admin Account
> The System Administrator account was created manually during initial setup. Credentials are managed separately — contact the original project owner.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Browser (Client)               │
│                                                 │
│  index.html ──► app.js (entry)                  │
│                  ├── auth.js (login/listeners)   │
│                  ├── ui.js (rendering)           │
│                  ├── actions.js (CRUD)           │
│                  ├── state.js (shared state)     │
│                  ├── firebase.js (SDK init)      │
│                  └── config.js (constants)       │
│                                                 │
│  css/styles.css (custom styles)                 │
│  Tailwind CSS (CDN), Chart.js, jsPDF (CDN)      │
└────────────────────┬────────────────────────────┘
                     │ Firebase SDK (CDN)
                     ▼
┌─────────────────────────────────────────────────┐
│              Firebase Backend                    │
│                                                 │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │    Auth      │  │   Cloud Firestore        │  │
│  │ (email/pwd)  │  │                          │  │
│  └─────────────┘  │  • users                  │  │
│                    │  • requests               │  │
│  ┌─────────────┐  │  • users                  │  │
│  │  Hosting    │  │  • requests               │  │
│  │ (static)    │  │  • inventory              │  │
│  └─────────────┘  │  • budgets                │  │
│                   │  • stock_movements        │  │
│                   │  • departments            │  │
│                   │  • settings/permissions   │  │
│                   └──────────────────────────┘  │
│  └─────────────┘                                │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │  Cloud Functions                          │   │
│  │  • updateBudgetOnApproval                 │   │
│  │    (triggers on requests/{id} update)     │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### No Build Step Required
The app uses **vanilla JavaScript ES Modules** loaded directly by the browser. There is no webpack, Vite, or npm build step for the frontend. Simply deploy the `public/` folder.

---

## 4. Codebase Map

### File Responsibilities

| File | Lines | What it does | When to modify |
|------|-------|-------------|----------------|
| `public/index.html` | ~515 | HTML structure, CDN links, Tailwind config | Adding new sections/pages |
| `public/css/styles.css` | ~660 | Custom CSS (glassmorphism, dark mode, forms) | Visual changes |
| `public/js/config.js` | ~30 | Firebase config, department/role/unit lists | Config changes, adding departments |
| `public/js/state.js` | ~45 | Single mutable state object (caches, charts, user) | Adding new global state |
| `public/js/firebase.js` | ~40 | Firebase SDK init, re-exports all SDK functions | Upgrading Firebase SDK version |
| `public/js/ui.js` | ~1060 | ALL rendering: dashboard, tables, charts, modals, notifications, theme, navigation | Changing how data is displayed |
| `public/js/actions.js` | ~670 | ALL data mutations: user CRUD, request CRUD, approve/reject with notes, restock, PDF/CSV export, low-stock quick order | Changing business logic |
| `public/js/auth.js` | ~150 | Auth state listener, profile loading, account suspension check, Firestore subscriptions | Changing auth flow or data subscriptions |
| `public/js/app.js` | ~320 | `DOMContentLoaded` handler, all event listener wiring | Adding new buttons/interactions |
| `functions/index.js` | ~70 | Cloud Function: auto-update budget when request is approved | Changing approval side-effects |

### Dependency Graph (no circular dependencies)

```
config.js ─────┐
               ├──► firebase.js ──┐
state.js ──────┘                  │
                                  ├──► ui.js ──────┐
                                  │                ├──► actions.js ──┐
                                  │                │                │
                                  │                ├──► auth.js     ├──► app.js (entry)
                                  │                │                │
                                  └────────────────┘                │
                                                                    │
                                  (no module imports actions ←─── auth)
```

---

## 5. Firestore Collections

### `users`
| Field        | Type      | Description                        |
|--------------|-----------|------------------------------------|
| `email`      | string    | User's email address               |
| `role`       | string    | One of: User, Store Keeper, Purchasing, General Manager, System Administrator |
| `department` | string    | User's assigned department          |
| `status`     | string    | Account status: 'Active' or 'Suspended' |
| `createdAt`  | timestamp | Account creation time               |

### `requests`
| Field            | Type      | Description                             |
|------------------|-----------|-----------------------------------------|
| `requestType`    | string    | 'Requisition' (decreases store stock on receipt) or 'Purchase Order' (restocks store stock) |
| `department`     | string    | Requesting department                    |
| `priority`       | string    | Normal, High, or Urgent                  |
| `requiredBy`     | string    | Required delivery date (YYYY-MM-DD)      |
| `notes`          | string    | Optional requester notes                 |
| `items`          | array     | `[{name, quantity, unit, price}]`        |
| `totalCost`      | number    | Sum of (price × quantity) for all items  |
| `status`         | string    | Pending, Approved, or Rejected           |
| `approvalNotes`  | string    | Optional notes from GM / Admin approval  |
| `createdAt`      | timestamp | When the request was submitted           |
| `createdBy`      | string    | UID of the requesting user               |
| `createdByEmail` | string    | Email of the requesting user             |
| `processedAt`    | timestamp | When approved/rejected (nullable)        |
| `received`       | boolean   | Whether items were received (nullable)   |
| `receivedAt`     | timestamp | When marked as received (nullable)       |

### `inventory`
| Field      | Type   | Description                |
|------------|--------|----------------------------|
| `name`     | string | Item name (unique)         |
| `category` | string | Category (Housekeeping, Kitchen, etc.) |
| `stock`    | number | Current stock quantity      |
| `min`      | number | Minimum acceptable level   |
| `price`    | number | Unit price in USD           |

### `budgets`
| Field        | Type   | Description                          |
|--------------|--------|--------------------------------------|
| `department` | string | Department name                      |
| `month`      | string | Period in YYYY-MM format             |
| `amount`     | number | Allocated budget in USD              |
| `year`       | string | Year extracted from month            |
| `month_num`  | string | Month number extracted from month    |

**Document ID pattern:** `{YYYY-MM}_{department-name}` (e.g., `2026-11_Front-Desk`)

### `stock_movements`
| Field           | Type      | Description                               |
|-----------------|-----------|-------------------------------------------|
| `itemId`        | string    | Inventory item ID                         |
| `itemName`      | string    | Item name                                 |
| `category`      | string    | Item category                             |
| `type`          | string    | Movement type: 'IN' (PO Receipt) or 'OUT' (Issuance) |
| `quantity`      | number    | Units moved                               |
| `previousStock` | number    | On-hand stock before movement             |
| `newStock`      | number    | On-hand stock after movement              |
| `department`    | string    | Receiving department                      |
| `recipient`     | string    | Staff member who received the items       |
| `reason`        | string    | Purpose, room number, or PO reference     |
| `issuedBy`      | string    | UID of user authorizing movement          |
| `issuedByEmail` | string    | Email of user authorizing movement        |
| `timestamp`     | timestamp | Server timestamp                          |

### `departments`
| Field        | Type      | Description                               |
|--------------|-----------|-------------------------------------------|
| `name`       | string    | Department name (e.g., 'Laundry', 'SPA')   |
| `createdAt`  | timestamp | When department was created                |
| `createdBy`  | string    | UID of the user who created it             |

**Document ID pattern:** `{DepartmentName}` (e.g., `Kitchen`, `Laundry`)

### `settings` (`settings/permissions` document)
| Field                 | Type     | Description                                      |
|-----------------------|----------|--------------------------------------------------|
| `[RoleName]`          | array    | Array of permission ID strings granted to role    |

Available granular permissions: `create_request`, `view_all_requests`, `approve_requests`, `manage_inventory`, `manage_budgets`, `view_reports`, `manage_users`, `manage_settings`.

### Required Composite Index
Firestore requires a composite index for the requests query:
- **Collection:** `requests`
- **Fields:** `createdAt` (Ascending)
- **Query scope:** Collection

> If this index is missing, the browser console will show an error with a direct link to create it.

---

## 6. Cloud Function

**Name:** `updateBudgetOnApproval`  
**Trigger:** `onDocumentUpdated("requests/{requestId}")`  
**Logic:** When a request's status changes to "Approved", it creates/updates a budget document in the `budgets` collection, incrementing the `spentAmount` by the request's `totalCost`.

> **Note:** The Cloud Function uses a different budget document ID format (`Department_YYYY-MM`) than the client-side budget UI (`YYYY-MM_Department`). These are effectively separate budget tracking mechanisms. The client UI calculates spending by querying approved requests directly.

---

## 7. Known Issues & Technical Debt

1. **Firestore security rules are permissive** — Any authenticated user can read/write all collections. Should be role-based.
2. **User management** — Full user management (Edit role/department/status, Delete, Reset Password, Search) is implemented client-side with a secondary Firebase app instance so admins never get signed out.
3. **No pagination** — All data (up to 120 days) is loaded at once. Will be slow with thousands of requests.
4. **No input sanitization** — HTML is injected via `innerHTML` with user data. Should use `textContent` or a sanitization library.
5. **Budget Cloud Function vs. UI mismatch** — Two different budget doc ID formats exist (see Section 6).
6. **CDN dependencies** — Tailwind CSS, Chart.js, jsPDF, Font Awesome are all loaded from CDNs. Consider bundling for reliability.

---

## 8. Deployment Checklist

When deploying changes:

- [ ] Test locally with `firebase emulators:start`
- [ ] If changing Firestore rules: `firebase deploy --only firestore:rules`
- [ ] If changing functions: `cd functions && npm install && cd .. && firebase deploy --only functions`
- [ ] If changing frontend: `firebase deploy --only hosting`
- [ ] Full deploy: `firebase deploy`
- [ ] Verify the live site loads and login works
- [ ] Check browser console (F12) for any errors

---

## 9. Contacts

| Role            | Name  | Notes                                 |
|-----------------|-------|---------------------------------------|
| Project Owner   | Abel  | Original developer                    |
| Firebase Admin  | Abel  | Has full access to Firebase Console   |

---

*This handover document was generated on November 9, 2026.*
