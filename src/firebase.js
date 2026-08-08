import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Primary app — the signed-in session for whoever is using the app right now.
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Secondary app — used ONLY to register a new login (email+password) for
// someone else without hijacking the current admin's signed-in session on
// the primary app. This is the standard client-only pattern for "admin
// creates another user" when there's no backend / Cloud Functions.
function getSecondaryApp() {
  const name = "Secondary";
  const existing = getApps().find((a) => a.name === name);
  return existing || initializeApp(firebaseConfig, name);
}
export function getSecondaryAuth() {
  return getAuth(getSecondaryApp());
}
export function getSecondaryDb() {
  return getFirestore(getSecondaryApp());
}
export async function resetSecondaryAuth() {
  const a = getSecondaryAuth();
  if (a.currentUser) await signOut(a);
}

// Every staff login is a real Firebase Auth account under a synthetic
// email built from their username, so the PIN is verified by Firebase
// Auth itself rather than compared against a value sitting in Firestore.
export const AUTH_EMAIL_DOMAIN = "staff.sbtraders.app";
export const emailFor = (username) => `${username}@${AUTH_EMAIL_DOMAIN}`;
