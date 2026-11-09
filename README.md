# 🏨 Hotel Purchase Order System

A full-featured **Inventory & Purchase Request Management** web application built for hotels, powered by **Firebase** (Authentication, Firestore, Cloud Functions, Hosting).

![Firebase](https://img.shields.io/badge/Firebase-v11.6.1-FFCA28?logo=firebase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-CDN-06B6D4?logo=tailwindcss&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-v4-FF6384?logo=chartdotjs&logoColor=white)
![License](https://img.shields.io/badge/License-Private-red)

---

## ✨ Features

### Core Modules
- **📊 Dashboard** — Real-time stats, charts (requests over time, status breakdown), quick actions, and recent requests feed
- **📝 Purchase Requests** — Create requests with auto-priced items from inventory, department routing, priority levels, and required-by dates
- **✅ Approval Workflow** — General Managers review and approve/reject pending requests with full item details
- **📦 Inventory Management** — Track stock levels, categories, pricing, min-level alerts, sortable/searchable table
- **💰 Department Budgeting** — Set monthly budgets per department, track spending vs. allocation with visual progress bars and charts
- **📈 Reports & PDF Export** — Filter by date, status, user; generate professional PDF reports with jsPDF
- **👤 User Management** — Admins create users with role & department assignments

### Technical Features
- 🔐 Firebase Authentication (email/password)
- 🔄 Real-time data sync with Firestore `onSnapshot` listeners
- 🌙 Dark mode with system preference detection & persistence
- 📱 Fully responsive design (mobile sidebar, touch-friendly)
- ⚡ Optimized: only loads last 120 days of requests
- ☁️ Cloud Function for automatic budget updates on approval

---

## 🏗️ Project Structure

```
hotel-po-firebase-v2/
├── public/                          # Hosted static files
│   ├── index.html                   # HTML structure (no inline JS/CSS)
│   ├── css/
│   │   └── styles.css               # All custom styles (glassmorphism, dark mode, etc.)
│   └── js/
│       ├── config.js                # Firebase config + constants (departments, roles, units)
│       ├── state.js                 # Centralized mutable application state
│       ├── firebase.js              # Firebase SDK initialization + re-exports
│       ├── ui.js                    # All rendering functions, modals, notifications, theme
│       ├── actions.js               # All CRUD operations, form handlers, business logic
│       ├── auth.js                  # Auth state listener + Firestore real-time subscriptions
│       └── app.js                   # Entry point — DOMContentLoaded + event wiring
├── functions/                       # Firebase Cloud Functions
│   ├── index.js                     # Budget update trigger on request approval
│   ├── package.json
│   └── .eslintrc.js
├── firebase.json                    # Firebase project config (hosting + functions + firestore)
├── firestore.rules                  # Firestore security rules
├── firestore.indexes.json           # Firestore composite indexes
├── .firebaserc                      # Firebase project alias
├── .gitignore
├── README.md                        # This file
├── HANDOVER.md                      # Project handover document
└── DOCUMENTATION.md                 # Complete app documentation
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18+ (v22 recommended)
- [Firebase CLI](https://firebase.google.com/docs/cli) installed globally: `npm install -g firebase-tools`
- A Firebase project with **Authentication**, **Firestore**, and **Hosting** enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/avel0a/hotel-po-firebase.git
cd hotel-po-firebase

# Install Cloud Functions dependencies
cd functions
npm install
cd ..

# Login to Firebase (if not already)
firebase login

# Link to your Firebase project
firebase use --add
```

### Local Development

```bash
# Start Firebase emulators for local testing
firebase emulators:start
```

The app will be available at `http://localhost:5000`.

### Deployment

```bash
# Deploy everything (hosting + functions + rules)
firebase deploy

# Deploy only the web app
firebase deploy --only hosting

# Deploy only Cloud Functions
firebase deploy --only functions

# Deploy only Firestore rules
firebase deploy --only firestore:rules
```

---

## 🔑 User Roles & Permissions

| Role                 | Dashboard | New Request | My Requests | Approvals | Budgeting | Inventory | Reports | User Mgmt |
|----------------------|:---------:|:-----------:|:-----------:|:---------:|:---------:|:---------:|:-------:|:---------:|
| **User**             | ✅        | ✅          | Own only    | ❌        | ❌        | ❌        | ❌      | ❌        |
| **Purchasing**       | ✅        | ✅          | All         | ❌        | ❌        | ✅ (CRUD) | ✅      | ❌        |
| **General Manager**  | ✅        | ✅          | All         | ✅        | ✅        | ❌        | ✅      | ❌        |
| **System Admin**     | ✅        | ✅          | All         | ✅        | ✅        | ✅ (CRUD) | ✅      | ✅        |

---

## 🗄️ Firestore Data Model

| Collection    | Document Fields                                                                                        |
|---------------|--------------------------------------------------------------------------------------------------------|
| `users`       | `email`, `role`, `department`, `createdAt`                                                             |
| `requests`    | `department`, `priority`, `requiredBy`, `notes`, `items[]`, `totalCost`, `status`, `createdAt`, `createdBy`, `createdByEmail`, `processedAt`, `received`, `receivedAt` |
| `inventory`   | `name`, `category`, `stock`, `min`, `price`                                                            |
| `budgets`     | `department`, `month` (YYYY-MM), `amount`, `year`, `month_num`                                        |

---

## 🛠️ Tech Stack

| Layer          | Technology                                       |
|----------------|--------------------------------------------------|
| **Frontend**   | Vanilla JavaScript (ES Modules), Tailwind CSS CDN |
| **Backend**    | Firebase Cloud Functions (Node.js)               |
| **Database**   | Cloud Firestore (real-time NoSQL)                |
| **Auth**       | Firebase Authentication (email/password)         |
| **Hosting**    | Firebase Hosting                                 |
| **Charts**     | Chart.js                                         |
| **PDF**        | jsPDF + jspdf-autotable                          |
| **Icons**      | Font Awesome 6                                   |
| **Fonts**      | Google Fonts (Inter, Montserrat)                 |

---

## 📝 Configuration

All app constants are centralized in [`public/js/config.js`](public/js/config.js):

```javascript
// Firebase project credentials
export const firebaseConfig = { /* ... */ };

// Editable lists
export const DEPARTMENTS = ['Housekeeping', 'Kitchen', ...];
export const ROLES = ['User', 'Purchasing', 'General Manager', 'System Administrator'];
export const UNITS = ['Each', 'Box', 'Kg', 'Liter', 'Set'];
```

To point this app at a different Firebase project, update `firebaseConfig` in that file and `.firebaserc`.

---

## 📄 Documentation

- **[DOCUMENTATION.md](DOCUMENTATION.md)** — Complete app guide: architecture, features, data flow, and usage instructions
- **[HANDOVER.md](HANDOVER.md)** — Project handover for new developers or maintainers

---

## 📜 License

This project is proprietary. All rights reserved.
