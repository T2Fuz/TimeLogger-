// journalHtml.js — pure helpers for the Journal's rich-text content.
//
// Journal pages are stored as HTML. Anything that goes INTO the editor or
// into storage passes through sanitizeHtml(): only a small whitelist of tags,
// attributes and CSS properties survives. This matters because the editor is
// a contentEditable element, and pasted/dropped content (from a web page,
// Word, another app) arrives as arbitrary HTML.
//
// Browser-only (uses DOMParser) but has no React/Firebase imports, so it can
// be exercised on its own.

const XHTML = "http://www.w3.org/1999/xhtml";

// Removed together with everything inside them.
const DROP_WITH_CONTENT = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TITLE", "HEAD", "SVG", "MATH",
  "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION", "NOSCRIPT", "TEMPLATE", "VIDEO",
  "AUDIO", "SOURCE", "CANVAS", "APPLET", "FRAME", "FRAMESET", "BASE", "TRACK", "PORTAL",
]);

// Kept (with a filtered set of attributes).
const KEEP_TAGS = new Set([
  "P", "DIV", "BR", "SPAN", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL",
  "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG", "SUB", "SUP", "HR",
]);

// Unknown block-level tags become a plain DIV (so paragraphs don't run
// together); every other unknown tag is simply unwrapped.
const BLOCKISH = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "CENTER", "DD", "DETAILS", "DL", "DT", "FIELDSET", "FIGCAPTION",
  "FIGURE", "FOOTER", "HEADER", "MAIN", "NAV", "SECTION", "SUMMARY", "TABLE", "THEAD", "TBODY",
  "TFOOT", "TR", "TD", "TH", "PRE", "H4", "H5", "H6", "HGROUP", "LEGEND", "CAPTION",
]);

const MEDIA_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*(,\s*\d{1,3}\s*){2}(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i;
const FONT_SIZES = new Set(["xx-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"]);
const FONT_FAMILY_RE = /^[a-z0-9 ,'"_-]{1,80}$/i;
const ALIGNS = new Set(["left", "center", "right", "justify"]);
const SAFE_HREF_RE = /^(https?:|mailto:|tel:)/i;

// Legacy <font size="1..7"> → CSS keyword sizes.
const FONT_TAG_SIZES = { 1: "x-small", 2: "small", 3: "medium", 4: "large", 5: "x-large", 6: "xx-large", 7: "xxx-large" };

function cleanStyle(raw, opts) {
  const out = [];
  for (const decl of String(raw || "").split(";")) {
    const i = decl.indexOf(":");
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, "");
    if (!val) continue;
    switch (prop) {
      case "color":
      case "background-color":
        // Pasted content keeps the editor's own colours: black-on-white text
        // from a web page would be invisible on this app's dark background.
        if (!opts.pasted && COLOR_RE.test(val)) out.push(`${prop}: ${val}`);
        break;
      case "font-size":
        if (!opts.pasted && FONT_SIZES.has(val.toLowerCase())) out.push(`font-size: ${val.toLowerCase()}`);
        break;
      case "font-family":
        if (!opts.pasted && FONT_FAMILY_RE.test(val)) out.push(`font-family: ${val}`);
        break;
      case "font-weight":
        if (/^(bold|bolder|normal|[1-9]00)$/i.test(val)) out.push(`font-weight: ${val.toLowerCase()}`);
        break;
      case "font-style":
        if (/^(italic|normal|oblique)$/i.test(val)) out.push(`font-style: ${val.toLowerCase()}`);
        break;
      case "text-decoration":
      case "text-decoration-line":
        if (/^(none|underline|line-through|underline line-through|line-through underline)$/i.test(val)) {
          out.push(`${prop}: ${val.toLowerCase()}`);
        }
        break;
      case "text-align":
        if (ALIGNS.has(val.toLowerCase())) out.push(`text-align: ${val.toLowerCase()}`);
        break;
      default:
        break;
    }
  }
  return out.join("; ");
}

function replaceWith(el, newEl) {
  while (el.firstChild) newEl.appendChild(el.firstChild);
  el.parentNode.replaceChild(newEl, el);
  return newEl;
}

function unwrap(el, opts) {
  cleanChildren(el, opts);
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function cleanChildren(parent, opts) {
  for (const node of Array.from(parent.childNodes)) cleanNode(node, opts);
}

function cleanNode(node, opts) {
  if (node.nodeType === 3) return; // text
  if (node.nodeType !== 1) { node.parentNode.removeChild(node); return; } // comments, processing instructions…

  let el = node;
  let tag = el.tagName.toUpperCase();

  if (el.namespaceURI !== XHTML || DROP_WITH_CONTENT.has(tag)) {
    el.parentNode.removeChild(el);
    return;
  }

  // Legacy <font color/size/face> (older Safari/Chrome still emit it) → span.
  if (tag === "FONT") {
    const span = el.ownerDocument.createElement("span");
    const parts = [];
    const color = el.getAttribute("color");
    const size = el.getAttribute("size");
    const face = el.getAttribute("face");
    if (color) parts.push(`color: ${color}`);
    if (size && FONT_TAG_SIZES[size]) parts.push(`font-size: ${FONT_TAG_SIZES[size]}`);
    if (face) parts.push(`font-family: ${face}`);
    if (parts.length) span.setAttribute("style", parts.join("; "));
    el = replaceWith(el, span);
    tag = "SPAN";
  }

  // Our own voice-note block: rebuilt from scratch (children are re-created
  // by the editor when the page is displayed).
  if (tag === "DIV" && el.classList.contains("jr-audio")) {
    const mid = el.getAttribute("data-mid") || "";
    if (!MEDIA_ID_RE.test(mid)) { el.parentNode.removeChild(el); return; }
    const dur = /^\d{1,6}$/.test(el.getAttribute("data-dur") || "") ? el.getAttribute("data-dur") : "";
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    el.setAttribute("class", "jr-audio");
    el.setAttribute("data-mid", mid);
    if (dur) el.setAttribute("data-dur", dur);
    el.setAttribute("contenteditable", "false");
    while (el.firstChild) el.removeChild(el.firstChild);
    return;
  }

  if (!KEEP_TAGS.has(tag)) {
    if (BLOCKISH.has(tag)) {
      const div = el.ownerDocument.createElement("div");
      el = replaceWith(el, div);
      tag = "DIV";
    } else {
      unwrap(el, opts);
      return;
    }
  }

  // Images are only ever references to our own stored media; the actual
  // pixels are loaded separately, so any src (http, data:, blob:) is dropped.
  if (tag === "IMG") {
    const mid = el.getAttribute("data-mid") || "";
    if (!MEDIA_ID_RE.test(mid)) { el.parentNode.removeChild(el); return; }
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    el.setAttribute("data-mid", mid);
    el.setAttribute("alt", "");
    return;
  }

  if (tag === "A") {
    const href = (el.getAttribute("href") || "").trim();
    if (!SAFE_HREF_RE.test(href)) { unwrap(el, opts); return; }
    while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
    el.setAttribute("href", href);
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
    cleanChildren(el, opts);
    return;
  }

  // Everything else: keep only whitelisted attributes.
  const style = cleanStyle(el.getAttribute("style"), opts);
  const keepChecked = tag === "LI" && /^[01]$/.test(el.getAttribute("data-checked") || "") ? el.getAttribute("data-checked") : null;
  const keepCheckClass = tag === "UL" && el.classList.contains("jr-check");
  while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
  if (style) el.setAttribute("style", style);
  if (keepChecked !== null) el.setAttribute("data-checked", keepChecked);
  if (keepCheckClass) el.setAttribute("class", "jr-check");

  cleanChildren(el, opts);
}

/**
 * Returns a safe HTML string. `opts.pasted` additionally strips colours,
 * sizes and fonts (structure, bold/italic/underline, lists, links stay).
 */
export function sanitizeHtml(html, opts = {}) {
  const doc = new DOMParser().parseFromString("<!doctype html><body>" + String(html || ""), "text/html");
  cleanChildren(doc.body, opts);
  return doc.body.innerHTML;
}

/** Plain-text one-liner for page lists / search (first ~160 chars). */
export function htmlToPreview(html) {
  const doc = new DOMParser().parseFromString("<!doctype html><body>" + String(html || ""), "text/html");
  doc.body.querySelectorAll("br, p, div, li, h1, h2, h3, blockquote").forEach((n) => n.insertAdjacentText("afterend", " "));
  const text = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 160);
  if (doc.body.querySelector(".jr-audio")) return "Voice note";
  if (doc.body.querySelector("img")) return "Image";
  return "";
}

/** Unique media ids referenced by a page's HTML. */
export function extractMediaIds(html) {
  const doc = new DOMParser().parseFromString("<!doctype html><body>" + String(html || ""), "text/html");
  const ids = new Set();
  doc.body.querySelectorAll("[data-mid]").forEach((n) => {
    const v = n.getAttribute("data-mid");
    if (MEDIA_ID_RE.test(v || "")) ids.add(v);
  });
  return Array.from(ids);
}

/**
 * Editor DOM → storable HTML. Loaded pixels/audio players are stripped (they
 * are re-created from the media store on display), then everything is
 * sanitized.
 */
export function serializeEditor(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll("img[data-mid]").forEach((img) => {
    img.removeAttribute("src");
    img.removeAttribute("style");
  });
  clone.querySelectorAll(".jr-audio").forEach((a) => { a.textContent = ""; });
  return sanitizeHtml(clone.innerHTML);
}

export function isMediaId(v) { return MEDIA_ID_RE.test(v || ""); }
