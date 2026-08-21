import { initializeApp } from "firebase/app";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from "firebase/auth";
import {
  initializeFirestore, getFirestore, doc, getDoc, setDoc, persistentLocalCache,
} from "firebase/firestore";

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

export let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({}) });
} catch (e) {
  console.error("Offline cache unavailable, falling back:", e);
  db = getFirestore(app);
}

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

export async function loadCloudData(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data().payload : null;
}
export async function saveCloudData(uid, data) {
  const ref = doc(db, "users", uid);
  await setDoc(ref, { payload: data, updatedAt: Date.now() });
}
