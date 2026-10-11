// journalDb.js — Firestore storage for the Journal.
//
// DESIGN NOTES (read before changing anything — these come from real bugs in
// this project's main sync):
//
// 1. The Journal does NOT live in the main `users/{uid}` data document. That
//    document is one big blob that gets rewritten on every change; putting
//    pages/images in it would make every timer save slower and re-introduce
//    "whole document overwrites the other device" data loss. Instead every
//    section, page, page-content and media item is its OWN small document, so
//    two devices editing different things can never overwrite each other.
//
//      users/{uid}/journalSections/{id}  { name, color, order, createdAt, trashedAt }
//      users/{uid}/journalPages/{id}     { sectionId, title, preview, createdAt, updatedAt, trashedAt }
//      users/{uid}/journalContent/{id}   { html, rev, by }        ← the page body, kept apart so the
//                                                                    page list stays light
//      users/{uid}/journalMedia/{id}     { kind, mime, size, parts, data?, dur?, w?, h?, createdAt }
//      users/{uid}/journalMedia/{id}_p{n}{ data }                 ← extra parts for big recordings
//
// 2. Nothing is ever deleted as a side effect of syncing or saving. Deleting
//    a page/section only moves it to Trash (trashedAt). Real deletion happens
//    only from the Trash screen, on an explicit "Delete forever".
//
// 3. Writes are never awaited for server acknowledgement by the UI: with
//    Firestore's offline cache a write is accepted locally at once and sent
//    when the connection is back (a promise would hang while offline).

import { db } from "./firebase";
import {
  collection, doc, setDoc, getDoc, getDocs, getDocFromCache, onSnapshot, writeBatch, deleteDoc,
} from "firebase/firestore";
import { extractMediaIds } from "./journalHtml.js";
import { splitParts } from "./journalMedia.js";

const col = (uid, name) => collection(db, "users", uid, name);
const ref = (uid, name, id) => doc(db, "users", uid, name, id);

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

let memoryDeviceId = null;
export function getDeviceId() {
  try {
    let d = localStorage.getItem("tl_device_id");
    if (!d) { d = "d" + newId(); localStorage.setItem("tl_device_id", d); }
    return d;
  } catch (e) {
    if (!memoryDeviceId) memoryDeviceId = "d" + newId();
    return memoryDeviceId;
  }
}

// ---------- live listeners ----------
function watchCollection(uid, name, cb, onError) {
  return onSnapshot(col(uid, name), { includeMetadataChanges: true }, (snap) => {
    cb(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache },
    );
  }, onError);
}
export const watchSections = (uid, cb, onError) => watchCollection(uid, "journalSections", cb, onError);
export const watchPages = (uid, cb, onError) => watchCollection(uid, "journalPages", cb, onError);

/** cb(data | null, { pending, fromCache }) */
export function watchContent(uid, pageId, cb, onError) {
  return onSnapshot(ref(uid, "journalContent", pageId), { includeMetadataChanges: true }, (snap) => {
    cb(snap.exists() ? snap.data() : null, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
  }, onError);
}

// ---------- sections ----------
export function createSection(uid, s) {
  return setDoc(ref(uid, "journalSections", s.id), {
    name: s.name, color: s.color, order: s.order, createdAt: s.createdAt || Date.now(), trashedAt: null,
  });
}
export function updateSection(uid, id, patch) {
  return setDoc(ref(uid, "journalSections", id), patch, { merge: true });
}

// ---------- pages ----------
export function createPage(uid, p) {
  const now = p.createdAt || Date.now();
  const b = writeBatch(db);
  b.set(ref(uid, "journalPages", p.id), {
    sectionId: p.sectionId, title: p.title || "", preview: "", createdAt: now, updatedAt: now, trashedAt: null,
  });
  b.set(ref(uid, "journalContent", p.id), { html: p.html || "", rev: now, by: getDeviceId() });
  return b.commit();
}

/** Saves body + list metadata together (one atomic write). */
export function savePage(uid, { id, html, title, preview, rev }) {
  const b = writeBatch(db);
  b.set(ref(uid, "journalContent", id), { html, rev, by: getDeviceId() });
  b.set(ref(uid, "journalPages", id), { title, preview, updatedAt: rev }, { merge: true });
  return b.commit();
}
export function updatePageMeta(uid, id, patch) {
  return setDoc(ref(uid, "journalPages", id), patch, { merge: true });
}

// ---------- trash / restore (soft delete) ----------
export const trashPage = (uid, id) => updatePageMeta(uid, id, { trashedAt: Date.now() });
export const restorePage = (uid, id) => updatePageMeta(uid, id, { trashedAt: null });
export const trashSection = (uid, id) => updateSection(uid, id, { trashedAt: Date.now() });
export const restoreSection = (uid, id) => updateSection(uid, id, { trashedAt: null });

// ---------- media ----------
/** m: { id, kind: "image"|"audio", mime, b64, dur?, w?, h? } — atomic, split into parts when big. */
export function saveMedia(uid, m) {
  const parts = splitParts(m.b64);
  const base = {
    kind: m.kind, mime: m.mime, size: m.b64.length, parts: parts.length, createdAt: Date.now(),
    dur: m.dur || null, w: m.w || null, h: m.h || null,
  };
  const b = writeBatch(db);
  if (parts.length === 1) {
    b.set(ref(uid, "journalMedia", m.id), { ...base, data: parts[0] });
  } else {
    b.set(ref(uid, "journalMedia", m.id), base);
    parts.forEach((p, i) => b.set(ref(uid, "journalMedia", `${m.id}_p${i}`), { data: p }));
  }
  return b.commit();
}

// Media never changes after it is written, so the local cache is always
// right: look there first (instant, works offline), then ask the server.
async function getCacheFirst(r) {
  try {
    const s = await getDocFromCache(r);
    if (s.exists()) return s;
  } catch (e) { /* not cached */ }
  const s = await getDoc(r);
  return s.exists() ? s : null;
}

/** → { kind, mime, b64, dur, w, h } or null when it does not exist. Throws when offline and not cached. */
export async function loadMedia(uid, id) {
  const main = await getCacheFirst(ref(uid, "journalMedia", id));
  if (!main) return null;
  const d = main.data();
  let b64 = d.data;
  if (!b64) {
    const n = d.parts || 0;
    const snaps = await Promise.all(Array.from({ length: n }, (_, i) => getCacheFirst(ref(uid, "journalMedia", `${id}_p${i}`))));
    if (snaps.some((s) => !s)) return null;
    b64 = snaps.map((s) => s.data().data).join("");
  }
  return { kind: d.kind, mime: d.mime, b64, dur: d.dur || null, w: d.w || null, h: d.h || null };
}

// ---------- permanent deletion (only ever called from an explicit "Delete forever") ----------
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
}

/** Media ids referenced by any page body other than `exceptPageIds`. Throws if bodies can't be read. */
async function mediaIdsUsedElsewhere(uid, exceptPageIds) {
  const snap = await getDocs(col(uid, "journalContent"));
  const used = new Set();
  snap.docs.forEach((d) => {
    if (exceptPageIds.has(d.id)) return;
    extractMediaIds(d.data().html || "").forEach((m) => used.add(m));
  });
  return used;
}

export async function deletePagesForever(uid, pageIds) {
  const except = new Set(pageIds);
  // Collect this page set's media first. If anything can't be read (offline),
  // we still delete the pages but leave the media alone — never guess.
  const mine = new Set();
  for (const pid of pageIds) {
    try {
      const s = await getDoc(ref(uid, "journalContent", pid));
      if (s.exists()) extractMediaIds(s.data().html || "").forEach((m) => mine.add(m));
    } catch (e) { /* offline: skip media cleanup */ }
  }
  const mediaRefs = [];
  if (mine.size) {
    try {
      const usedElsewhere = await mediaIdsUsedElsewhere(uid, except);
      for (const mid of mine) {
        if (usedElsewhere.has(mid)) continue; // another page (e.g. a copy) still shows it
        const m = await getDoc(ref(uid, "journalMedia", mid));
        if (!m.exists()) continue;
        mediaRefs.push(ref(uid, "journalMedia", mid));
        const n = m.data().parts || 0;
        if (n > 1) for (let i = 0; i < n; i++) mediaRefs.push(ref(uid, "journalMedia", `${mid}_p${i}`));
      }
    } catch (e) { /* leave media in place */ }
  }
  const pageRefs = [];
  pageIds.forEach((pid) => { pageRefs.push(ref(uid, "journalPages", pid)); pageRefs.push(ref(uid, "journalContent", pid)); });
  await commitInChunks([...pageRefs, ...mediaRefs]);
}

export async function deleteSectionForever(uid, sectionId, pageIds) {
  if (pageIds.length) await deletePagesForever(uid, pageIds);
  await deleteDoc(ref(uid, "journalSections", sectionId));
}
