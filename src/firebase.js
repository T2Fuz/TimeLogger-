import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
} from "firebase/auth";
import {
  initializeFirestore, doc, getDoc, setDoc, persistentLocalCache,
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
export const googleProvider = new GoogleAuthProvider();

// persistentLocalCache = the "offline" magic: writes go to a local cache
// first (works with zero internet) and Firestore syncs them to the cloud
// automatically whenever a connection is available.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({}),
});

export function login() {
  return signInWithPopup(auth, googleProvider);
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
