// journalMedia.js — image compression, voice recording and base64/Blob helpers
// for the Journal. Pure browser APIs; no React/Firebase imports.
//
// Why base64 strings: Journal media lives in Firestore documents (see
// journalDb.js), and one Firestore document may not exceed ~1 MiB. Anything
// bigger than PART_CHARS is split into several documents.

export const PART_CHARS = 700000;             // chars per Firestore document (safely under 1 MiB incl. overhead)
export const MAX_IMAGE_B64 = 700000;          // a compressed image always fits in ONE document
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // recording auto-stops here (≈ 4+ minutes even at phone bitrates)

export function splitParts(str, size = PART_CHARS) {
  if (str.length <= size) return [str];
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts;
}

export function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : "");
    };
    r.onerror = () => reject(r.error || new Error("Could not read file"));
    r.readAsDataURL(blob);
  });
}

export function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// ---------- in-memory cache of media that has been turned into object URLs ----------
const cache = new Map(); // mediaId -> { url, mime, kind, dur }
export const mediaCache = {
  get: (id) => cache.get(id),
  set: (id, v) => { cache.set(id, v); },
};

export function b64ToObjectUrl(b64, mime) {
  return URL.createObjectURL(b64ToBlob(b64, mime));
}

// ---------- images ----------
function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image format can't be read")); };
    img.src = url;
  });
}

function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

/**
 * Downscale + JPEG-compress an image File until it fits in one Firestore
 * document. Returns { b64, mime, w, h }. Transparent areas become white.
 */
export async function compressImage(file, { maxDim = 1600, maxB64 = MAX_IMAGE_B64 } = {}) {
  const src = await loadBitmap(file);
  const sw = src.width || src.naturalWidth;
  const sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error("This image format can't be read");
  let scale = Math.min(1, maxDim / Math.max(sw, sh));
  try {
    for (let round = 0; round < 8; round++) {
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);
      for (const q of [0.85, 0.72, 0.6, 0.48]) {
        const url = canvas.toDataURL("image/jpeg", q);
        const b64 = url.slice(url.indexOf(",") + 1);
        if (b64 && b64.length <= maxB64) return { b64, mime: "image/jpeg", w, h };
      }
      scale *= 0.75;
    }
    throw new Error("This image is too large to store");
  } finally {
    if (src && typeof src.close === "function") src.close();
  }
}

// ---------- voice recording ----------
export function canRecord() {
  return typeof MediaRecorder !== "undefined" && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// MP4/AAC first: it plays on every device (iPhone Safari can't always play
// WebM). Chrome/Android/iOS all pick the first one their MediaRecorder offers.
export function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* try next */ }
  }
  return "";
}

/**
 * Starts recording from the microphone. Resolves to a controller:
 *   stop()   → Promise<{ blob, mime, durSec, limited }>
 *   cancel() → Promise<null>
 *   elapsedMs()
 * Recording stops itself at MAX_AUDIO_BYTES (onLimit fires; call stop() to collect).
 */
export async function startRecording({ onBytes, onLimit } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickAudioMime();
  let rec;
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
  } catch (e) {
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e2) {
      stream.getTracks().forEach((t) => t.stop());
      throw e2;
    }
  }

  const chunks = [];
  let bytes = 0;
  let limited = false;
  let cancelled = false;
  const t0 = performance.now();
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });

  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    chunks.push(e.data);
    bytes += e.data.size;
    if (onBytes) onBytes(bytes);
    if (bytes >= MAX_AUDIO_BYTES && rec.state === "recording") {
      limited = true;
      if (onLimit) onLimit();
      try { rec.stop(); } catch (err) { /* already stopping */ }
    }
  };
  rec.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    if (cancelled) { finish(null); return; }
    const full = rec.mimeType || mime || "audio/webm";
    finish({
      blob: new Blob(chunks, { type: full }),
      mime: full.split(";")[0],
      durSec: Math.max(1, Math.round((performance.now() - t0) / 1000)),
      limited,
    });
  };
  rec.onerror = () => {
    stream.getTracks().forEach((t) => t.stop());
    cancelled = true;
    finish(null);
  };
  rec.start(1000);

  return {
    stop: () => { if (rec.state !== "inactive") { try { rec.stop(); } catch (e) { /* ignore */ } } return done; },
    cancel: () => {
      cancelled = true;
      if (rec.state !== "inactive") { try { rec.stop(); } catch (e) { /* ignore */ } }
      else stream.getTracks().forEach((t) => t.stop());
      return done;
    },
    elapsedMs: () => performance.now() - t0,
  };
}
