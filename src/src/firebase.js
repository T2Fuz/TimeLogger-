import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from "firebase/auth";
import {
  initializeFirestore, getFirestore, doc, getDoc, setDoc, onSnapshot, persistentLocalCache,
} from "firebase/firestore";

// Your Firebase project's keys (from Project settings > Your apps)
const firebaseConfig = {
  apiKey: "AIzaSyAdMBUoq21Jkrt4Vq-h9nNVimSGOyftx7Q",
  authDomain: "time-logger-d7e5a.firebaseapp.com",
  projectId: "time-logger-d7e5a",
  storageBucket: "time-logger-d7e5a.firebasestorage.app",
  messagingSenderId: "583786553704",
  appId: "1:583786553704:web:5f959883d086becd96f6dd",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// persistentLocalCache = the "offline" magic: writes go to a local cache
// first (works with zero internet) and Firestore syncs them to the cloud
// automatically whenever a connection is available.
// Some browser contexts (private tabs, restricted storage) can reject this —
// fall back to a normal (memory-only) Firestore instance instead of crashing.
export let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({}) });
} catch (e) {
  console.error("Offline cache unavailable, falling back:", e);
  db = getFirestore(app);
}

// Firebase Auth only understands emails, not usernames. So we turn a
// username into a fake, fixed-domain email behind the scenes — the person
// only ever sees "username" on screen, never this.
function usernameToEmail(username) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  return `${clean}@timelogger.local`;
}

export function signUpWithUsername(username, password) {
  return createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
}
export function signInWithUsername(username, password) {
  return signInWithEmailAndPassword(auth, usernameToEmail(username), password);
}
export function logout() {
  return signOut(auth);
}
export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// One document per user holds the whole app's data (logs, sessions, todos...).
export async function loadCloudData(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().payload : null;
}
export async function saveCloudData(uid, data) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, { payload: data, updatedAt: Date.now() });
}

export function watchCloudData(uid, cb) {
  const ref = doc(db, "users", uid);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) cb(snap.data());
  }, (err) => console.error("Data listener error:", err));
}

// A separate, tiny document just for "is a timer currently running, and
// which one" — kept apart from the big data document so starting/stopping
// a timer is instant on other devices, without waiting for (or triggering)
// a full data re-sync.
export async function setCloudActiveTimer(uid, activeTimer) {
  const ref = doc(db, "users", uid, "meta", "activeTimer");
  await setDoc(ref, { activeTimer: activeTimer || null, updatedAt: Date.now() });
}
export function watchCloudActiveTimer(uid, cb) {
  const ref = doc(db, "users", uid, "meta", "activeTimer");
  return onSnapshot(ref, (snap) => {
    cb(snap.exists() ? (snap.data().activeTimer || null) : null);
  }, (err) => console.error("Active timer listener error:", err));
}
