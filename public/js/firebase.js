/**
 * Firebase SDK initialization and re-exports.
 * All Firebase SDK imports go through this module so version upgrades
 * only need to change URLs in one place.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, doc, collection, addDoc, setDoc, deleteDoc,
    onSnapshot, query, where, serverTimestamp, orderBy, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { firebaseConfig } from './config.js';
import state from './state.js';

/**
 * Initialize Firebase app, Firestore, and Auth instances.
 * Stores instances in shared state.
 */
export function initializeFirebaseApp() {
    state.app = initializeApp(firebaseConfig);
    state.db = getFirestore(state.app);
    state.auth = getAuth(state.app);
}

// Re-export Firebase SDK functions for use by other modules
export {
    signInWithEmailAndPassword, createUserWithEmailAndPassword,
    onAuthStateChanged, signOut,
    doc, collection, addDoc, setDoc, deleteDoc,
    onSnapshot, query, where, serverTimestamp, orderBy, getDoc, getDocs
};
