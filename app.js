"use strict";
/* =====================================================================
   B3313 Unpacked
   Open the site normally to explore. Add ?log to the address to log.

   Data lives in two files:
     data/map.json    rooms, courses, exits and exit pictures
     data/stars.json  all stars, and which place each one is in
   Every exit is written from the place you are STANDING in.
   ===================================================================== */

const LOG_MODE = new URLSearchParams(location.search).has("log");
const KEYS = { progress:"b3313unpacked.progress", draft:"b3313unpacked.draft" };
const FS_OK = "showDirectoryPicker" in window;

/* ============================== helpers ============================== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const slug = s => (s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "place");
const uniqueId = (base, taken) => { let id = base, n = 2; while (taken(id)) id = `${base}_${n++}`; return id; };
const round3 = v => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
const timeNow = () => new Date().toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });

let toastTimer;
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* =====================================================================
   COLORS: a honeycomb picker. White in the middle, pale colors around it,
   vivid colors in the middle rings, dark colors on the outside, plus a
   row of greys. Rooms store plain hex colors.
   ===================================================================== */
const HC_R = 6, HC_S = 12, SQ3 = Math.sqrt(3);
function hslToHex(h, s, l){
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return "#" + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
const HONEY = [];
for (let q = -HC_R; q <= HC_R; q++) for (let r = -HC_R; r <= HC_R; r++){
  const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); if (d > HC_R) continue;
  const x = HC_S * SQ3 * (q + r / 2), y = HC_S * 1.5 * r;
  const hue = ((Math.atan2(y, x) * 180 / Math.PI) + 450) % 360;
  const hex = d === 0 ? "#FFFFFF" : hslToHex(hue, Math.min(75, 40 + 12 * (d - 1)), 92 - (d - 1) * 14);
  HONEY.push({ q, r, x, y, hex });
}
const GREYS = Array.from({ length:11 }, (_, i) => hslToHex(0, 0, 94 - i * 8.6));
const ALL_SWATCHES = [...HONEY.map(c => c.hex), ...GREYS];

function toLab(hex){
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), fy = f(r * 0.2126 + g * 0.7152 + b * 0.0722), fz = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const LABS = {};
const lab = h => LABS[h] || (LABS[h] = toLab(h));
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const snap = hex => ALL_SWATCHES.reduce((best, h) => dE(h, hex) < dE(best, hex) ? h : best, ALL_SWATCHES[0]);
const isHex = v => typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v);

// "Steps" are hexagons on the picker: neighbors are 1 step apart. The grey row
// hangs off the white center, so greys are close to each other and to white.
const SW = {};
HONEY.forEach(c => { SW[c.hex] = SW[c.hex] || { type:"h", q:c.q, r:c.r }; });
GREYS.forEach((g, i) => { SW[g] = SW[g] || { type:"g", i }; });
const swOf = h => SW[h.toUpperCase()] || SW[snap(h.toUpperCase())];
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
function steps(a, b){
  const A = swOf(a), B = swOf(b);
  if (A.type === "h" && B.type === "h") return hexDist(A, B);
  if (A.type === "g" && B.type === "g") return Math.abs(A.i - B.i);
  const g = A.type === "g" ? A : B, h = A.type === "h" ? A : B;
  return g.i + 1 + hexDist(h, { q:0, r:0 });
}

function honeycomb(selected, main, ctx){
  const sel = new Set(selected.map(h => h.toUpperCase()));
  const pts = (cx, cy) => Array.from({ length:6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${(cx + HC_S * Math.cos(a)).toFixed(1)},${(cy + HC_S * Math.sin(a)).toFixed(1)}`; }).join(" ");
  const W = SQ3 * HC_S * (2 * HC_R + 1) + 4, top = HC_S * (1.5 * HC_R + 1) + 2, greyY = top * 2 + HC_S * 0.6;
  const cell = (hex, cx, cy) => `<polygon points="${pts(cx, cy)}" fill="${hex}" class="${hex === main ? "main" : sel.has(hex) ? "sel" : ""}" data-action="hex" data-ctx="${ctx}" data-hex="${hex}"><title>${hex}</title></polygon>`;
  const gx0 = W / 2 - (GREYS.length - 1) * SQ3 * HC_S / 2;
  return `<svg class="honey" viewBox="0 0 ${W.toFixed(0)} ${(greyY + HC_S + 3).toFixed(0)}" role="group" aria-label="Color picker">
    ${HONEY.map(c => cell(c.hex, W / 2 + c.x, top + c.y)).join("")}
    ${GREYS.map((g, i) => cell(g, gx0 + i * SQ3 * HC_S, greyY)).join("")}
  </svg>`;
}

/* ============================== images ============================== */
const LOCAL = {};                     // path -> blob URL, read from your repo folder or loaded this session
const asset = path => LOCAL[path] || path;
const ASPECT = {}, LOADING = new Set(), BROKEN = new Set();
function aspectOf(path){
  const u = asset(path);
  if (ASPECT[u]) return ASPECT[u];
  if (!LOADING.has(u)){
    LOADING.add(u);
    const im = new Image();
    im.onload = () => { ASPECT[u] = (im.naturalWidth && im.naturalHeight) ? im.naturalWidth / im.naturalHeight : 4/3; render(); };
    im.onerror = () => { ASPECT[u] = 4/3; BROKEN.add(path); };
    im.src = u;
  }
  return 4/3;
}

/* Outline drawings: the inside of your black outline is filled with the room's main color. */
const FILLED = {};
// hex can be null: the drawing is still cleaned up and trimmed, just not filled.
function filledDrawing(path, hex){
  const u = asset(path), key = u + "|" + (hex || "none"), v = FILLED[key];
  if (v && v !== "pending") return v;
  if (!v){
    FILLED[key] = "pending";
    const im = new Image();
    im.onload = () => { try { FILLED[key] = fillOutline(im, hex); } catch { FILLED[key] = { fail:true }; } render(); };
    im.onerror = () => { FILLED[key] = { fail:true }; BROKEN.add(path); };
    im.src = u;
  }
  return null;
}
function fillOutline(im, hex){
  const sc = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d"); g.drawImage(im, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), px = img.data, n = w * h;
  const ink = new Uint8Array(n), out = new Uint8Array(n), stack = new Int32Array(n);
  for (let i = 0; i < n; i++){ const o = i * 4; ink[i] = px[o + 3] >= 128 && (0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]) < 170 ? 1 : 0; }
  let sp = 0;
  const push = i => { if (!ink[i] && !out[i]){ out[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++){ push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++){ push(y * w); push(y * w + w - 1); }
  while (sp){
    const i = stack[--sp], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  const c = hex ? parseInt(hex.slice(1), 16) : 0, R = c >> 16 & 255, G = c >> 8 & 255, B = c & 255;
  let inside = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++){
    const o = i * 4;
    if (!ink[i]){
      if (out[i]){ px[o + 3] = 0; continue; }
      if (hex){ px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255; }
      inside++;
    }
    // everything that isn't outside belongs to the drawing; track its bounding box
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  g.putImageData(img, 0, 0);
  const box = x1 < 0 ? { x:0, y:0, w:1, h:1 } : { x:x0 / w, y:y0 / h, w:(x1 - x0 + 1) / w, h:(y1 - y0 + 1) / h };
  return { url:cv.toDataURL("image/png"), leak:!!hex && inside < n * 0.01, box, ar:im.naturalWidth / im.naturalHeight };
}

/* ============================== data ============================== */
// The exit types, in the order they appear in the dropdown.
const TYPE = { door:"Door", doubledoor:"Double door", lockeddoor:"Locked door", pipe:"Pipe", hole:"Hole", deadly:"Deadly dead end", other:"Other" };
// Types from earlier versions. Exits that still use one keep working and show it in their dropdown until you pick a new one.
const OLD_TYPE = { painting:"Painting", trapdoor:"Trapdoor", warp:"Warp", exitcourse:"Exit course", course:"Course" };
const typeName = t => TYPE[t] || OLD_TYPE[t] || t;
// Exits using a type from an earlier version are switched over when the map loads:
// trapdoors become holes, and anything else that's no longer on the list becomes Other.
const RENAMED_TYPE = { trapdoor:"hole", painting:"other", warp:"other", exitcourse:"other", course:"other" };
function upgradeTypes(){
  let changed = false;
  const ta = DATA.typeArt;
  DATA.places.forEach(p => p.exits.forEach(e => {
    const to = RENAMED_TYPE[e.type]; if (!to) return;
    // keep the picture it was showing, e.g. a painting stays a painting on the map
    if (!e.art && ta[e.type] && ta[e.type] !== ta[to] && DATA.art.some(a => a.id === ta[e.type])) e.art = ta[e.type];
    e.type = to; changed = true;
  }));
  Object.entries(RENAMED_TYPE).forEach(([from, to]) => { if (ta[from] && !ta[to]){ ta[to] = ta[from]; changed = true; } });
  Object.keys(ta).forEach(t => { if (!TYPE[t]){ delete ta[t]; changed = true; } });
  if (!ta.lockeddoor && DATA.art.some(a => a.id === "lockeddoor")){ ta.lockeddoor = "lockeddoor"; changed = true; }
  return changed;
}
const COLORS = ["yellow", "red", "green"];
const DEFAULT_SWITCHES = [
  { id:"sw_red", color:"red", name:"Red switch" },
  { id:"sw_green", color:"green", name:"Green switch" },
  { id:"sw_blue", color:"blue", name:"Blue switch" },
  { id:"sw_yellow", color:"yellow", name:"Yellow switch" }
];
const COLOR_NAME = { yellow:"Yellow", red:"Red", green:"Green" };
const STARTER = { version:1, start:"castle_grounds", art:[], typeArt:{},
  places:[{ id:"castle_grounds", name:"Castle Grounds", kind:"room", exits:[] }] };

let DATA = null;
let P = {}, EX = {}, FROM = {}, STAR = {}, ART = {}, SWITCH = {};
function reindex(){
  P = Object.fromEntries(DATA.places.map(p => [p.id, p]));
  EX = {}; FROM = {};
  DATA.places.forEach(p => (p.exits = p.exits || []).forEach(e => { EX[e.id] = e; FROM[e.id] = p.id; }));
  STAR = Object.fromEntries(DATA.stars.map(s => [s.id, s]));
  SWITCH = Object.fromEntries(DATA.switches.map(s => [s.id, s]));
  ART = Object.fromEntries((DATA.art || []).map(a => [a.id, a]));
}
function applyData(map, stars){
  DATA = {
    version:map.version || 1, start:map.start, art:map.art || [], typeArt:map.typeArt || {}, places:map.places || [],
    stars:(stars && stars.stars) || [],
    switches:(stars && stars.switches && stars.switches.length ? stars.switches : JSON.parse(JSON.stringify(DEFAULT_SWITCHES))).map(w => ({ ...w, places:(w.places || []) })),
    starsMeta:{ source:stars && stars.source, saveFormat:stars && stars.saveFormat }
  };
  if (!DATA.places.length) DATA.places = JSON.parse(JSON.stringify(STARTER.places));
  if (!DATA.start || !DATA.places.some(p => p.id === DATA.start)) DATA.start = DATA.places[0].id;
  upgradeTypes();
  reindex();
  if (!P[state.here]) { state.here = DATA.start; state.history = []; state.cameVia = null; }
  state.route = null; state.sel = null;
}
function mapObject(){ return { version:DATA.version, start:DATA.start, art:DATA.art, typeArt:DATA.typeArt, places:DATA.places }; }
const exportMap = () => JSON.stringify(mapObject(), null, 2) + "\n";
function exportStars(){
  // one star per line keeps commits easy to read
  const head = { version:1 };
  if (DATA.starsMeta.source) head.source = DATA.starsMeta.source;
  if (DATA.starsMeta.saveFormat) head.saveFormat = DATA.starsMeta.saveFormat;
  const headText = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  return `{\n${headText},\n  "switches": [\n${DATA.switches.map(w => "    " + JSON.stringify(w)).join(",\n")}\n  ],\n  "stars": [\n${DATA.stars.map(s => "    " + JSON.stringify(s)).join(",\n")}\n  ]\n}\n`;
}

/* ============================== state ============================== */
const state = {
  tab:"explore", here:"castle_grounds", cameVia:null, history:[], checked:new Set(), route:null,
  rsQ:"", rsMin:0, rsConn:[], rsConnQ:"", rsShow:48, starQ:"", starC:"all", starShow:"all", planFrom:null, planTo:"", showIO:false,
  edit:false, sel:null, placing:null, newKind:null, newFor:null, newName:"",
  dirty:false, choose:null, confirm:null, picking:false, pickQ:"", delConfirm:null,
  draft:null, loadError:false, savedHandle:null, folderName:"", saveStatus:""
};

const starsIn = pid => DATA.stars.filter(s => s.place === pid);
const gotIn = pid => starsIn(pid).filter(s => state.checked.has(s.id)).length;
const exitNum = id => P[FROM[id]].exits.findIndex(x => x.id === id) + 1;
const placeName = id => P[id] ? P[id].name : (id ? `${id} (not logged)` : "nowhere yet");
const unplacedStars = () => DATA.stars.filter(s => !P[s.place]);
const switchesIn = pid => DATA.switches.filter(w => w.places.includes(pid));

/* ---------- star progress, saved in this browser ---------- */
function loadProgress(){
  try { const o = JSON.parse(localStorage.getItem(KEYS.progress) || "{}"); state.checked = new Set(o.checked || []); } catch {}
}
function saveProgress(){ try { localStorage.setItem(KEYS.progress, JSON.stringify({ checked:[...state.checked] })); } catch {} }

/* ---------- unsaved-edit backup, saved in this browser ---------- */
function saveDraft(){ try { localStorage.setItem(KEYS.draft, JSON.stringify({ time:Date.now(), map:mapObject(), stars:{ ...DATA.starsMeta, stars:DATA.stars, switches:DATA.switches } })); } catch {} }
function readDraft(){ try { return JSON.parse(localStorage.getItem(KEYS.draft) || "null"); } catch { return null; } }
function clearDraft(){ try { localStorage.removeItem(KEYS.draft); } catch {} }

/* ============================== your repo folder ============================== */
let FOLDER = null;
function idb(){
  return new Promise((ok, no) => {
    const r = indexedDB.open("b3313unpacked", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function idbGet(k){ const db = await idb(); return new Promise((ok, no) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); }
async function idbSet(k, v){ const db = await idb(); return new Promise((ok, no) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => ok(); t.onerror = () => no(t.error); }); }

async function readText(dir, name){ try { const fh = await dir.getFileHandle(name); return await (await fh.getFile()).text(); } catch { return null; } }
async function writeFile(dir, name, data){ const fh = await dir.getFileHandle(name, { create:true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }

async function openFolder(){
  try {
    const h = await window.showDirectoryPicker({ id:"b3313-unpacked", mode:"readwrite" });
    await useFolder(h);
  } catch (e) { if (e && e.name !== "AbortError") toast("Couldn't open that folder."); }
}
async function reconnectFolder(){
  const h = state.savedHandle; if (!h) return openFolder();
  try { if (await h.requestPermission({ mode:"readwrite" }) === "granted") await useFolder(h); }
  catch { toast("Couldn't reconnect. Try Open my repo folder instead."); }
}
async function useFolder(h){
  const dataDir = await h.getDirectoryHandle("data", { create:true });
  const mapText = await readText(dataDir, "map.json"), starsText = await readText(dataDir, "stars.json");
  FOLDER = h; state.folderName = h.name; state.savedHandle = h; state.loadError = false;
  try { await idbSet("folder", h); } catch {}
  if (state.dirty){
    await saveToFolder();
    toast(`Saved your unsaved edits into ${h.name}.`);
  } else if (mapText){
    try { applyData(JSON.parse(mapText), starsText ? JSON.parse(starsText) : { stars:DATA.stars, switches:DATA.switches }); }
    catch { toast("The folder's data/map.json couldn't be read. Nothing was changed."); }
    state.saveStatus = "Connected";
  } else {
    await saveToFolder();
    toast(`${h.name} had no map yet, so the current map was saved into it.`);
  }
  await indexAssets();
  state.draft = null;
  render();
}
// Reads assets/rooms and assets/art from your repo folder. New pictures dropped into
// assets/art are added to the picture list, and deleted files are forgotten.
const FILESIG = {};
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
async function indexAssets(){
  let changed = false, artRead = false;
  const found = new Set();
  for (const sub of ["rooms", "art"]){
    let dir;
    try { dir = await (await FOLDER.getDirectoryHandle("assets")).getDirectoryHandle(sub); } catch { continue; }
    if (sub === "art") artRead = true;
    for await (const [name, fh] of dir.entries()){
      if (fh.kind !== "file" || name.startsWith(".") || !IMAGE_EXT.test(name)) continue;
      const path = `assets/${sub}/${name}`, file = await fh.getFile(), sig = file.size + ":" + file.lastModified;
      found.add(path);
      if (FILESIG[path] !== sig){
        if (LOCAL[path]) URL.revokeObjectURL(LOCAL[path]);
        LOCAL[path] = URL.createObjectURL(file); FILESIG[path] = sig; changed = true;
      }
    }
  }
  Object.keys(FILESIG).forEach(path => {
    if (found.has(path)) return;
    URL.revokeObjectURL(LOCAL[path]); delete LOCAL[path]; delete FILESIG[path]; changed = true;
  });
  const added = [];
  [...found].sort().filter(path => path.startsWith("assets/art/") && !DATA.art.some(a => a.file === path)).forEach(path => {
    const base = path.split("/").pop().replace(/\.[^.]+$/, "");
    const a = { id:uniqueId(slug(base), id => !!ART[id]), name:base.replace(/[_-]+/g, " "), file:path };
    DATA.art.push(a); ART[a.id] = a; added.push(a.name);
  });
  // pictures whose files were deleted from the folder leave the list too
  const gone = artRead ? DATA.art.filter(a => a.file.startsWith("assets/art/") && !found.has(a.file)) : [];
  if (gone.length) removeArt(new Set(gone.map(a => a.id)));
  const msgs = [];
  if (added.length) msgs.push(`Found ${added.length} new picture${added.length > 1 ? "s" : ""}: ${added.join(", ")}.`);
  if (gone.length) msgs.push(`Removed ${gone.length} picture${gone.length > 1 ? "s" : ""} whose file${gone.length > 1 ? "s are" : " is"} gone: ${gone.map(a => a.name).join(", ")}.`);
  if (msgs.length){ markDirty(); toast(msgs.join(" ")); }
  return changed || added.length > 0 || gone.length > 0;
}
function removeArt(ids){
  DATA.art = DATA.art.filter(a => !ids.has(a.id));
  Object.keys(DATA.typeArt).forEach(t => { if (ids.has(DATA.typeArt[t])) delete DATA.typeArt[t]; });
  DATA.places.forEach(x => x.exits.forEach(e => { if (ids.has(e.art)) delete e.art; }));
  reindex();
}
async function writeAsset(sub, file){
  const dir = await (await FOLDER.getDirectoryHandle("assets", { create:true })).getDirectoryHandle(sub, { create:true });
  await writeFile(dir, file.name, file);
}
let saveTimer, saving = false;
function markDirty(){
  state.dirty = true;
  saveDraft();
  if (FOLDER){ clearTimeout(saveTimer); saveTimer = setTimeout(saveToFolder, 700); }
  renderChips();
}
async function saveToFolder(){
  if (!FOLDER) return;
  if (saving){ clearTimeout(saveTimer); saveTimer = setTimeout(saveToFolder, 400); return; }
  saving = true;
  try {
    const dir = await FOLDER.getDirectoryHandle("data", { create:true });
    await writeFile(dir, "map.json", exportMap());
    await writeFile(dir, "stars.json", exportStars());
    state.dirty = false; clearDraft();
    state.saveStatus = `Saved ${timeNow()}`;
  } catch {
    state.saveStatus = "Couldn't save";
    toast("Couldn't save into your repo folder. Click the folder button at the top to reconnect.");
  }
  saving = false;
  renderChips();
}
function download(name, text){
  const url = URL.createObjectURL(new Blob([text], { type:"application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================== routing ============================== */
// Exits a route may use. Deadly dead ends are never used. "Sometimes" outcomes
// are only used when there's no reliable way.
function routeEdges(e, luck){
  if (e.type === "deadly") return [];
  const out = [];
  if (P[e.to]) out.push({ to:e.to, luck:false });
  if (luck) (e.alts || []).forEach(a => { if (P[a.to] && a.to !== e.to) out.push({ to:a.to, luck:true }); });
  return out;
}
function findRoute(from, to, luck){
  if (!P[from] || !P[to]) return null;
  if (from === to) return [];
  const prev = new Map([[from, null]]), queue = [from];
  while (queue.length){
    const cur = queue.shift();
    for (const e of P[cur].exits){
      for (const edge of routeEdges(e, luck)){
        if (prev.has(edge.to)) continue;
        prev.set(edge.to, { e:e.id, to:edge.to, luck:edge.luck, from:cur });
        if (edge.to === to){
          const path = []; let n = to;
          while (prev.get(n)){ const s = prev.get(n); path.unshift({ e:s.e, to:s.to, luck:s.luck }); n = s.from; }
          return path;
        }
        queue.push(edge.to);
      }
    }
  }
  return null;
}
const bestRoute = (from, to) => findRoute(from, to, false) || findRoute(from, to, true);

function nearestRoute(from, targets){
  let best = null;
  targets.filter(t => P[t]).forEach(t => { const r = bestRoute(from, t); if (r && (!best || r.length < best.r.length)) best = { r, t }; });
  return best;
}
function startRoute(target){
  if (Array.isArray(target)){
    const best = nearestRoute(state.here, target);
    if (!best){ toast("There's no logged path from here to there yet."); return false; }
    target = best.t;
  }
  const steps = bestRoute(state.here, target);
  if (!steps){ toast("There's no logged path from here to there yet."); return false; }
  state.route = { target, steps, i:0, done:steps.length === 0, lost:false };
  return true;
}
function reroute(msg){
  const rt = state.route; if (!rt) return;
  if (state.here === rt.target){ Object.assign(rt, { done:true, lost:false, steps:[], i:0 }); return; }
  const s = bestRoute(state.here, rt.target);
  if (s){ Object.assign(rt, { steps:s, i:0, lost:false, done:false }); if (msg) toast(msg); }
  else Object.assign(rt, { lost:true, done:false, steps:[], i:0 });
}
const outcomesOf = e => [e.to, ...(e.alts || []).map(a => a.to)].filter((t, i, arr) => P[t] && arr.indexOf(t) === i);

function takeExit(id, chosen){
  const e = EX[id]; if (!e) return;
  let dest = chosen;
  if (dest === undefined){
    if (e.type === "deadly"){ state.confirm = id; state.choose = null; render(); return; }
    const outs = outcomesOf(e);
    if (!outs.length){ toast(`"${e.label || "This exit"}" doesn't lead anywhere logged yet.`); return; }
    if (outs.length > 1){ state.choose = id; state.confirm = null; render(); return; }
    dest = outs[0];
  }
  if (!P[dest]){ toast("That place isn't logged yet."); return; }
  state.choose = null; state.confirm = null;
  state.history.push({ here:state.here, cameVia:state.cameVia });
  state.here = dest; state.cameVia = (dest === e.to && e.pair) ? e.pair : null;
  state.sel = null; state.placing = null; state.newKind = null; state.newFor = null; state.picking = false; state.delConfirm = null;
  const rt = state.route;
  if (rt){
    const step = rt.steps[rt.i];
    if (rt.done) state.route = null;
    else if (!rt.lost && step && step.e === id && step.to === dest){ rt.i++; if (state.here === rt.target) rt.done = true; }
    else reroute(step && step.e === id ? "That took you somewhere else. Rerouted from here." : "You went off the route. Rerouted from here.");
  }
  render();
}
function goBack(){
  const h = state.history.pop(); if (!h) return;
  Object.assign(state, { here:h.here, cameVia:h.cameVia, sel:null, placing:null, choose:null, confirm:null, picking:false });
  if (state.route) reroute();
  render();
}
function setHere(pid){
  if (pid !== state.here) state.history.push({ here:state.here, cameVia:state.cameVia });
  Object.assign(state, { here:pid, cameVia:null, sel:null, choose:null, confirm:null });
  if (state.route) reroute();
}

/* ============================== drawing ============================== */
function iconSVG(type){
  const inner = {
    door:`<rect x="-11" y="-14" width="22" height="28" rx="3" fill="#C8995A" stroke="#4A3520" stroke-width="2.5"/>`,
    pipe:`<circle r="13" fill="#3D9A4E" stroke="#1F4F28" stroke-width="3"/><circle r="6.5" fill="#183520"/>`,
    deadly:`<rect x="-11" y="-14" width="22" height="28" rx="3" fill="#7A0F18" stroke="#0E0A0C" stroke-width="2.5"/>`,
    doubledoor:`<rect x="-14" y="-14" width="13" height="28" rx="2" fill="#C8995A" stroke="#4A3520" stroke-width="2.5"/><rect x="1" y="-14" width="13" height="28" rx="2" fill="#C8995A" stroke="#4A3520" stroke-width="2.5"/>`,
    lockeddoor:`<rect x="-11" y="-14" width="22" height="28" rx="3" fill="#8A7A6A" stroke="#3A3028" stroke-width="2.5"/><rect x="-5" y="-1" width="10" height="8" rx="1" fill="#E3C160" stroke="#3A3028" stroke-width="1.5"/><path d="M-3 -1 V-4 A3 3 0 0 1 3 -4 V-1" fill="none" stroke="#3A3028" stroke-width="1.5"/>`,
    hole:`<ellipse rx="14" ry="10" fill="#0D0B12" stroke="#000" stroke-width="2"/>`,
    other:`<circle r="12" fill="#B9B3C9" stroke="#241F33" stroke-width="2"/><text y="5" text-anchor="middle" font-size="14" font-weight="700" fill="#241F33">?</text>`
  }[type] || `<circle r="12" fill="#B9B3C9" stroke="#241F33" stroke-width="2"/>`;
  return `<svg viewBox="-16 -16 32 32" aria-hidden="true">${inner}</svg>`;
}
// With your repo folder open, a file that's gone from the folder counts as gone,
// even if the live site still has an older copy.
const missingFile = path => !!(FOLDER && path && path.startsWith("assets/") && !LOCAL[path]);
const artUrl = id => ART[id] && !missingFile(ART[id].file) ? asset(ART[id].file) : null;
// Tiny drawings get crisp pixel scaling; anything bigger than its box gets smooth scaling.
function pixelFit(img){ img.classList.toggle("px", img.naturalHeight > 0 && img.naturalHeight <= img.clientHeight); }
// A picture that can't be loaded is never shown as an empty box.
function artFailed(img){
  const src = img.getAttribute("src");
  const a = (DATA.art || []).find(x => asset(x.file) === src); if (a) BROKEN.add(a.file);
  const tile = img.closest(".artt");
  if (tile){ tile.hidden = true; return; }
  img.outerHTML = iconSVG(img.dataset.type || "other");
}
// An exit shows its own picture first, then the default picture for its type, then a plain icon.
function exitArtUrl(e){
  const own = e.art && artUrl(e.art);
  if (own) return own;
  const def = (DATA.typeArt || {})[e.type];
  return def ? artUrl(def) : null;
}
function exitIcon(e){
  const u = exitArtUrl(e);
  return u ? `<img class="art" src="${esc(u)}" alt="" data-type="${esc(e.type)}" onload="pixelFit(this)" onerror="artFailed(this)">` : iconSVG(e.type);
}

// The part of a drawing to show: its outline's bounding box, widened to include every
// exit pin and label, plus a little breathing room. Positions are still stored relative
// to the whole image, so nothing you've logged moves.
function viewBox(p, filled){
  if (!filled || !filled.box) return { x:0, y:0, w:1, h:1 };
  let { x:x0, y:y0 } = filled.box, x1 = x0 + filled.box.w, y1 = y0 + filled.box.h;
  [...p.exits.filter(e => typeof e.x === "number"), ...(p.labels || [])].forEach(o => {
    x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x); y0 = Math.min(y0, o.y); y1 = Math.max(y1, o.y);
  });
  const padX = (x1 - x0) * 0.04, padY = (y1 - y0) * 0.04;
  x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY); x1 = Math.min(1, x1 + padX); y1 = Math.min(1, y1 + padY);
  return { x:x0, y:y0, w:Math.max(0.01, x1 - x0), h:Math.max(0.01, y1 - y0) };
}
function mapHTML(p, opt = {}){
  if (p.kind === "course"){
    // a course's page shows the picture of the way in, like its painting
    const into = Object.values(EX).find(e => e.to === p.id && FROM[e.id] !== p.id);
    const u = into ? exitArtUrl(into) : null;
    return `<div class="course-art">${u ? `<img src="${esc(u)}" alt="">` : `<div class="blank"></div>`}</div>`;
  }
  const shape = p.shape && !missingFile(p.shape) ? p.shape : null;
  const filled = shape ? filledDrawing(shape, isHex(p.color) ? p.color : null) : null;
  const src = filled && filled.url ? filled.url : (shape ? asset(shape) : null);
  const v = viewBox(p, filled);
  const natural = filled && filled.ar ? filled.ar : (shape ? aspectOf(shape) : 4/3);
  const ar = shape ? natural * v.w / v.h : 4/3;
  const at = (x, y) => `left:${((x - v.x) / v.w * 100).toFixed(2)}%;top:${((y - v.y) / v.h * 100).toFixed(2)}%`;
  const pins = p.exits.filter(e => typeof e.x === "number").map(e => {
    const idx = p.exits.indexOf(e);
    const cls = ["pin",
      opt.next === e.id && "next", opt.next && opt.next !== e.id && "dim",
      opt.cameVia === e.id && "came", opt.sel === e.id && "sel", e.needsPos && "needspos"].filter(Boolean).join(" ");
    const dest = e.type === "deadly" ? "deadly dead end" : placeName(e.to);
    return `<button class="${cls}" data-exit="${e.id}" style="${at(e.x, e.y)}"
      title="${esc(e.label)}: ${esc(typeName(e.type))}, ${esc(dest)}" aria-label="${esc(e.label)}, ${esc(typeName(e.type))}, ${esc(dest)}">
      ${exitIcon(e)}<span class="badge">${idx + 1}</span>${P[e.to] && P[e.to].kind === "course" && e.type !== "deadly" ? `<span class="cap">${esc(P[e.to].name)}</span>` : ""}</button>`;
  }).join("");
  return `<div class="map ${state.placing && opt.live ? "placing" : ""}" data-map="${p.id}" data-view="${v.x},${v.y},${v.w},${v.h}" style="--ar:${ar.toFixed(4)}">
    ${src ? `<div class="drawwrap"><img class="drawing" src="${esc(src)}" alt="" style="width:${(100 / v.w).toFixed(2)}%;height:${(100 / v.h).toFixed(2)}%;left:${(-v.x / v.w * 100).toFixed(2)}%;top:${(-v.y / v.h * 100).toFixed(2)}%"></div>`
          : `<div class="colorbox" style="background:${isHex(p.color) ? p.color : "#8A8D92"}">${opt.live ? `No drawing yet${state.edit ? ". Add one under This room." : ""}` : ""}</div>`}
    ${(p.labels || []).map(l => `<span class="maplabel" style="${at(l.x, l.y)}">${esc(l.text)}</span>`).join("")}
    ${pins}
  </div>`;
}

/* ============================== explore ============================== */
function stepText(step){
  const e = EX[step.e];
  return `take <span class="num">${exitNum(e.id)}</span> ${esc(e.label || typeName(e.type))}${e.floor ? ` <span class="muted">(${esc(e.floor)})</span>` : ""}`
    + (step.luck ? ` <span class="tag warn">only sometimes</span><div class="small muted">This only sometimes leads to ${esc(P[step.to].name)}. If you end up somewhere else, come back and try again.</div>` : "");
}
function banners(){
  const out = [];
  if (state.confirm){
    const e = EX[state.confirm];
    const room = P[e.to], re = P[e.respawn];
    out.push(`<div class="banner deadly"><div class="grow"><b>This is a deadly dead end.</b> Going through it gets you killed.
      ${re ? `<div class="small">After dying you end up in ${esc(re.name)}.</div>` : ""}</div>
      <div class="row">${room ? `<button class="btn" data-action="go-deadly" data-to="${room.id}">See the room</button>` : ""}
      ${re ? `<button class="btn" data-action="go-deadly" data-to="${re.id}">I died, take me to ${esc(re.name)}</button>` : ""}
      <button class="btn" data-action="cancel-choice">Stay here</button></div></div>`);
  }
  if (state.choose){
    const e = EX[state.choose], outs = outcomesOf(e);
    out.push(`<div class="banner ask"><div class="grow"><b>Where did you end up?</b> <span class="muted">${esc(e.label)} doesn't always lead to the same place.</span></div>
      <div class="row">${outs.map(t => {
        const alt = (e.alts || []).find(a => a.to === t);
        return `<button class="btn ${t === e.to ? "primary" : ""}" data-action="choose" data-exit="${e.id}" data-to="${t}" title="${esc(alt && alt.note || "")}">${esc(P[t].name)}${t === e.to ? " (usually)" : ""}</button>`;
      }).join("")}<button class="btn" data-action="cancel-choice">Cancel</button></div></div>`);
  }
  if (!state.edit && state.route) out.push(routeBanner());
  return out.join("");
}
function routeBanner(){
  const rt = state.route, label = P[rt.target].name;
  if (rt.done){
    const left = starsIn(rt.target).length - gotIn(rt.target);
    return `<div class="banner done"><div class="grow"><b>You've arrived at ${esc(label)}.</b>
      ${starsIn(rt.target).length ? `<span class="muted"> ${left ? `${left} star${left > 1 ? "s" : ""} left to collect here.` : "You've collected every star here."}</span>` : ""}
      </div><button class="btn" data-action="clear-route">Clear route</button></div>`;
  }
  if (rt.lost){
    return `<div class="banner lost"><div class="grow"><b>No logged path from here to ${esc(label)}.</b>
      <div class="small muted">Either a connection is missing from the map, or this is a real dead end. Back returns you to the route.</div></div>
      <button class="btn" data-action="clear-route">Clear route</button></div>`;
  }
  const step = rt.steps[rt.i];
  const trail = [P[state.here].name, ...rt.steps.slice(rt.i).map(s => P[s.to].name)];
  return `<div class="banner"><div class="grow">
      <b>Heading to ${esc(label)}.</b> Step ${rt.i + 1} of ${rt.steps.length}: ${stepText(step)}
      <div class="trail">${trail.map((n, k) => `<span class="${k === 0 ? "cur" : ""}">${esc(n)}</span>`).join("")}</div>
    </div><button class="btn" data-action="clear-route">Clear route</button></div>`;
}

function exitRow(e, idx, nextId){
  const d = P[e.to];
  let dest;
  if (e.type === "deadly") dest = `Deadly dead end. You'll be killed.${P[e.respawn] ? ` You end up in ${P[e.respawn].name}.` : ""}`;
  else dest = `${typeName(e.type)}${e.floor ? `, ${e.floor}` : ""} to ${placeName(e.to)}`;
  const stars = d && e.type !== "deadly" && starsIn(d.id).length ? ` <span class="tag">${gotIn(d.id)}/${starsIn(d.id).length}★</span>` : "";
  const alts = (e.alts || []).filter(a => P[a.to]);
  const tags = (!e.pair && e.type !== "deadly" ? `<span class="tag one">one-way</span>` : "")
    + (alts.length ? `<span class="tag warn">varies</span>` : "")
    + (LOG_MODE && e.needsPos ? `<span class="tag warn">not placed</span>` : "")
    + (LOG_MODE && !d && e.type !== "deadly" ? `<span class="tag warn">no destination</span>` : "");
  const cls = [state.edit ? (state.sel === e.id ? "sel" : "") : (nextId ? (nextId === e.id ? "next" : "dim") : ""), e.type === "deadly" ? "deadly" : ""].join(" ");
  return `<button class="exit-row ${cls}" data-exit="${e.id}">
    <span class="num">${idx + 1}</span><span class="ico">${exitIcon(e)}</span>
    <span><span class="ex-label">${esc(e.label || "(no description yet)")}</span>
    <span class="ex-dest">${esc(dest)}${stars}${tags}</span>
    ${alts.length ? `<span class="ex-dest">Sometimes: ${alts.map(a => esc(P[a.to].name) + (a.note ? ` (${esc(a.note)})` : "")).join(", ")}</span>` : ""}
    ${e.arrive && !state.edit ? `<span class="ex-dest"><i>${esc(e.arrive)}</i></span>` : ""}</span>
  </button>`;
}

function welcomeCard(p){
  if (p.id !== DATA.start || p.exits.length || DATA.places.length > 1) return "";
  return LOG_MODE
    ? `<div class="banner info"><div class="grow"><b>This is where the map begins.</b> Press <b>Log this room</b>, load your Castle Grounds outline, and pin every way out you can see. ${FOLDER ? "" : "Open your repo folder first so everything saves as you go."}</div></div>`
    : `<div class="banner info"><div class="grow"><b>The map is still being built.</b> Rooms appear here as they get logged. The star list already works.</div></div>`;
}

function renderExplore(){
  const p = P[state.here], rt = state.route;
  const step = !state.edit && rt && !rt.done && !rt.lost ? rt.steps[rt.i] : null;
  const nextId = step ? step.e : null;
  const here = starsIn(p.id);
  const hint = state.placing ? `<div class="hint"><span>${{ exit:"Click on the drawing where the new exit is.", move:"Click the exit's new spot on the drawing.", label:"Click where the new label should go." }[state.placing] || "Click the label's new spot on the drawing."}</span>
      <button class="btn sm" data-action="cancel-place">Cancel</button></div>` : "";
  return `${welcomeCard(p)}${banners()}
  <div class="explore">
    <section class="stage ${state.edit ? "sticky" : ""}">
      <div class="stage-head">
        <div><div class="kind">${p.kind === "course" ? "Course" : "Room"}</div><h2 id="placename">${esc(p.name)}</h2></div>
        <div class="row">
          <button class="btn" data-action="back" ${state.history.length ? "" : "disabled"}>Back</button>
          ${LOG_MODE ? `<button class="btn ${state.edit ? "primary" : ""}" data-action="edit-toggle">${state.edit ? "Done logging" : `Log this ${p.kind}`}</button>` : ""}
        </div>
      </div>
      ${hint}
      ${mapHTML(p, { live:true, next:nextId, cameVia:state.cameVia, sel:state.edit ? state.sel : null })}
      ${p.view ? `<p class="view-note">${esc(p.view)}</p>` : ""}
      ${p.kind === "room" ? `<div class="legend">
        <span><i style="border:2px dashed var(--ok)"></i>Where you came in</span>
        ${nextId ? `<span><i style="border:3px solid var(--gold)"></i>Your next step</span>` : ""}
        <span>${state.edit ? "Click an exit to edit it" : "Click any exit to go through it"}</span>
      </div>` : ""}
    </section>
    <section class="side">${state.edit ? editorPanel(p) : `
      <div class="card"><h3>Ways out (${p.exits.length})</h3>${p.exits.map((e, i) => exitRow(e, i, nextId)).join("") || `<p class="muted" style="margin:0">None logged yet.</p>`}</div>
      ${here.length ? `<div class="card"><h3>Stars here (${gotIn(p.id)}/${here.length})</h3>${here.map(s => starRow(s, false)).join("")}</div>` : ""}
      ${switchesIn(p.id).length ? `<div class="card"><h3>Switches here</h3>${switchesIn(p.id).map(w => switchRow(w, false)).join("")}</div>` : ""}
      ${LOG_MODE ? `<details class="card"><summary>See this ${p.kind}'s data</summary><pre>${esc(JSON.stringify(p, null, 2))}</pre></details>` : ""}`}
    </section>
  </div>`;
}

/* ============================== logging mode ============================== */
function editorPanel(p){
  const e = state.sel ? EX[state.sel] : null;
  return `
  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0">Ways out (${p.exits.length})</h3>
    <button class="btn sm primary" data-action="add-exit">Add exit</button></div>
    ${p.exits.map((x, i) => exitRow(x, i, null)).join("") || `<p class="muted small" style="margin:0">Nothing logged yet. Add the first door, pipe or painting you see.</p>`}
    ${e ? exitForm(e) : ""}
  </div>
  ${placeForm(p)}
  ${starEditor(p)}
  <div class="card"><h3>Switches here</h3>
    <p class="small muted" style="margin:-4px 0 8px">A switch can be in more than one place. Routes go to the nearest one.</p>
    <div class="row">${DATA.switches.map(w => `<button class="swatch ${w.places.includes(p.id) ? "on" : ""}" data-action="toggle-switch-place" data-sw="${w.id}"><span class="cdot ${w.color}"></span> ${esc(w.name)}</button>`).join("")}</div>
  </div>
  ${saveCard()}`;
}

// A place dropdown that can also create a new room or course on the spot.
// field is "to", "respawn" or "alt"; i is the row number for "alt".
const destKey = (field, i) => field + (i == null ? "" : i);
function destSelect(field, i, current, blank, courses, exclude){
  const forThis = state.newFor === destKey(field, i);
  const pick = forThis ? null : current;
  return `<select data-edit="dest" data-field="${field}"${i == null ? "" : ` data-i="${i}"`}>
      <option value="" ${!pick && !forThis ? "selected" : ""}>${blank}</option>${placeOptions(pick, exclude)}
      <option value="__new_room" ${forThis && state.newKind === "room" ? "selected" : ""}>New room…</option>
      ${courses ? `<option value="__new_course" ${forThis && state.newKind === "course" ? "selected" : ""}>New course…</option>` : ""}</select>`;
}
const newPlaceRow = (field, i) => state.newFor === destKey(field, i)
  ? `<div class="row" style="margin:0 0 10px;flex-wrap:nowrap"><input data-edit="newname" value="${esc(state.newName)}" placeholder="Name of the new ${state.newKind}"><button class="btn sm primary" data-action="create-new">Create</button></div>` : "";
function setDest(e, key, v){
  if (key === "to"){ if (e.to !== v){ unlinkPair(e); e.to = v; } }
  else if (key === "respawn"){ if (v) e.respawn = v; else delete e.respawn; }
  else if (key.startsWith("alt")) e.alts[+key.slice(3)].to = v;
}
// Rooms A to Z, then courses A to Z.
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric:true, sensitivity:"base" });
const sortedPlaces = kind => DATA.places.filter(p => !kind || p.kind === kind).sort((a, b) => (a.kind === "course") - (b.kind === "course") || byName(a, b));
function placeOptions(selected, exclude){
  return sortedPlaces().filter(x => x.id !== exclude).map(x => `<option value="${x.id}" ${selected === x.id ? "selected" : ""}>${esc(x.name)}${x.kind === "course" ? " (course)" : ""}</option>`).join("");
}
function exitForm(e){
  const d = P[e.to], partner = e.pair ? EX[e.pair] : null, deadly = e.type === "deadly";
  return `<div class="exform">
    <h3>Exit ${exitNum(e.id)}</h3>
    <label class="f">What it looks like<input data-edit="ex-label" value="${esc(e.label)}" placeholder="e.g. Blue door left of the stairs"></label>
    <div class="two">
      <label class="f">Type<select data-edit="ex-type">${Object.entries(TYPE).map(([k, v]) => `<option value="${k}" ${e.type === k ? "selected" : ""}>${v}</option>`).join("")}${TYPE[e.type] ? "" : `<option value="${esc(e.type)}" selected>${esc(typeName(e.type))} (old type, pick a new one)</option>`}</select></label>
      <label class="f">Floor (optional)<input data-edit="ex-floor" value="${esc(e.floor || "")}" placeholder="e.g. 2nd floor"></label>
    </div>
    <div class="small" style="font-weight:600">Picture on the map</div>
    <p class="small muted" style="margin:2px 0 0">${e.art ? "Click the selected picture again to go back to the default."
      : exitArtUrl(e) ? `Using the default picture for ${esc(typeName(e.type).toLowerCase())}s. Pick another to use it just for this exit.`
      : "Using a plain icon. Pick or add a picture for it."}</p>
    ${artPicker(e.art || (DATA.typeArt || {})[e.type])}
    ${e.art && (DATA.typeArt || {})[e.type] !== e.art ? `<button class="btn sm" data-action="set-default-art" style="margin:-4px 0 12px">Use this picture for every ${esc(typeName(e.type).toLowerCase())}</button>` : ""}
    <label class="f">${deadly ? "Room where you get killed (optional)" : "Leads to"}${destSelect("to", null, e.to, deadly ? "Not logged" : "Not set yet", !deadly, FROM[e.id])}</label>
    ${newPlaceRow("to", null)}
    ${deadly ? `<label class="f">Where you end up after dying (optional)${destSelect("respawn", null, e.respawn, "Not logged", true, null)}</label>
    ${newPlaceRow("respawn", null)}` : `
    <label class="inline"><input type="checkbox" data-edit="ex-twoway" ${e.pair ? "checked" : ""} ${d && state.newFor !== "to" ? "" : "disabled"}> Two-way: going back through it brings you right here</label>
    ${partner ? `<p class="small muted" style="margin:-4px 0 10px">You come out at <b>${esc(partner.label)}</b> in ${esc(d.name)}${partner.needsPos ? ". It hasn't been placed on that drawing yet." : "."}</p>`
              : `<label class="f">Where you end up (optional)<input data-edit="ex-arrive" value="${esc(e.arrive || "")}" placeholder="e.g. You land on the 2nd floor balcony"></label>`}
    <div class="small" style="font-weight:600;margin-bottom:6px">Sometimes leads somewhere else</div>
    ${(e.alts || []).map((a, i) => `<div class="alt-row">
        ${destSelect("alt", i, a.to, "Choose a place", true, FROM[e.id])}
        <input data-edit="alt-note" data-i="${i}" value="${esc(a.note || "")}" placeholder="When? e.g. rarely, at night">
        <button class="btn sm danger" data-action="del-alt" data-i="${i}" aria-label="Remove">✕</button></div>${newPlaceRow("alt", i)}`).join("")}
    <button class="btn sm" data-action="add-alt" style="margin-bottom:12px" ${d ? "" : "disabled"}>Add another possible destination</button>`}
    <div class="row">
      ${P[FROM[e.id]].kind === "room" ? `<button class="btn sm" data-action="move-exit">Move on drawing</button>` : ""}
      <button class="btn sm" data-action="go-exit" ${outcomesOf(e).length || (deadly && P[e.respawn]) ? "" : "disabled"}>Go through</button>
      <button class="btn sm danger" data-action="del-exit">Delete exit</button>
    </div>
  </div>`;
}

function artPicker(sel){
  const list = (DATA.art || []).filter(a => !missingFile(a.file));
  return `<div class="artgrid">${list.map(a => `<button class="artt ${sel === a.id ? "on" : ""}" data-action="pick-art" data-art="${a.id}" title="${esc(a.name)}" aria-label="${esc(a.name)}"><img src="${esc(asset(a.file))}" alt="" onload="pixelFit(this)" onerror="artFailed(this)"></button>`).join("") || `<span class="small muted">No pictures yet. Add some, or drop them into assets/art.</span>`}</div>
    <label class="btn sm" style="margin-bottom:12px">Add pictures from this computer<input type="file" accept="image/*" multiple data-file="art" hidden></label>`;
}

function roomColorEditor(p){
  const fill = p.shape && isHex(p.color) ? FILLED[asset(p.shape) + "|" + (p.color || "none")] : null;
  return `<div class="small" style="font-weight:600;margin-bottom:2px">Fill color</div>
    <p class="small muted" style="margin:0 0 4px">Fills the inside of the drawing. Click it again to clear it.</p>
    ${honeycomb([], isHex(p.color) ? p.color : null, "edit")}
    ${fill && fill.leak ? `<p class="small" style="color:var(--warn);margin:-4px 0 10px">The outline seems to have a gap, so the inside can't be filled. Close the gap in your drawing and load it again.</p>` : ""}
    ${fill && fill.fail ? `<p class="small" style="color:var(--warn);margin:-4px 0 10px">This drawing couldn't be colored. Open the site from GitHub Pages, or open your repo folder.</p>` : ""}`;
}

function placeForm(p){
  const isRoom = p.kind === "room";
  return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0">This ${p.kind}</h3>
    ${p.id === DATA.start ? `<span class="small muted">The map starts here</span>`
      : `<button class="btn sm danger" data-action="del-place" data-place="${p.id}">${state.delConfirm === p.id ? "Click again to delete" : `Delete this ${p.kind}`}</button>`}</div>
    <label class="f">Name<input data-edit="name" value="${esc(p.name)}"></label>
    <label class="f">Kind<select data-edit="kind"><option value="room" ${isRoom ? "selected" : ""}>Room</option><option value="course" ${!isRoom ? "selected" : ""}>Course (or one-painting room)</option></select></label>
    ${isRoom ? `
      ${roomColorEditor(p)}
      <label class="f" style="margin-top:12px">Drawing file (black outline)<input data-edit="shape" value="${esc(p.shape || "")}" placeholder="assets/rooms/${p.id}.png"></label>
      <label class="btn sm" style="margin:-4px 0 12px">Load a drawing from this computer<input type="file" accept="image/*" data-file="shape" hidden></label>
      <label class="f">How the drawing is oriented<input data-edit="view" value="${esc(p.view || "")}" placeholder="e.g. Drawn as if you came in from the lobby"></label>
      <div class="row" style="justify-content:space-between;margin-bottom:6px"><b class="small">Labels on the drawing</b><button class="btn sm" data-action="add-label">Add label</button></div>
      ${(p.labels || []).map((l, i) => `<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><input data-edit="label" data-i="${i}" value="${esc(l.text)}"><button class="btn sm" data-action="move-label" data-i="${i}">Move</button><button class="btn sm danger" data-action="del-label" data-i="${i}" aria-label="Delete label">✕</button></div>`).join("") || `<p class="small muted" style="margin:0 0 10px">Use labels for floors, like "1st floor".</p>`}
    ` : ""}
  </div>`;
}

function pickListHTML(){
  const q = state.pickQ.trim().toLowerCase();
  const list = unplacedStars().filter(s => !q || s.course.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  if (!list.length) return `<p class="small muted" style="margin:6px 0 0">${unplacedStars().length ? "No unplaced stars match." : "Every star has been placed."}</p>`;
  const groups = [];
  list.forEach(s => { let g = groups.find(x => x.course === s.course); if (!g) groups.push(g = { course:s.course, stars:[] }); g.stars.push(s); });
  const shown = groups.slice(0, 40);
  return shown.map(g => `<div class="pickgroup">
      <div class="row"><b class="small">${esc(g.course)}</b>${g.stars.length > 1 ? `<button class="btn sm" data-action="place-group" data-course="${esc(g.course)}">Place all ${g.stars.length} here</button>` : ""}</div>
      ${g.stars.map(s => `<div class="pickstar"><span class="cdot ${s.color}"></span><span class="grow">${esc(s.name)}</span><button class="btn sm" data-action="place-star" data-star="${s.id}">Place here</button></div>`).join("")}
    </div>`).join("") + (groups.length > shown.length ? `<p class="small muted">${groups.length - shown.length} more groups. Search to narrow it down.</p>` : "");
}
function starEditor(p){
  const list = starsIn(p.id);
  const n = p.name.trim().toLowerCase();
  const match = unplacedStars().filter(s => s.course.toLowerCase() === n);
  return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Stars here (${list.length})</h3>
    <button class="btn sm ${state.picking ? "primary" : ""}" data-action="toggle-picker">${state.picking ? "Done adding" : "Add stars from the star list"}</button></div>
    ${match.length ? `<div class="banner ask" style="margin:0 0 10px"><div class="grow small">${match.length} unplaced star${match.length > 1 ? "s" : ""} in the star list ${match.length > 1 ? "are" : "is"} called "${esc(match[0].course)}".</div>
      <button class="btn sm primary" data-action="place-group" data-course="${esc(match[0].course)}">Place ${match.length > 1 ? "them" : "it"} here</button></div>` : ""}
    ${state.picking ? `<input data-filter="pickq" value="${esc(state.pickQ)}" placeholder="Search unplaced stars" aria-label="Search unplaced stars"><div id="picklist" style="max-height:340px;overflow:auto;margin:6px 0 10px">${pickListHTML()}</div>` : ""}
    ${list.map(s => `<div style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">
      <div class="row" style="flex-wrap:nowrap"><span class="cdot ${s.color}" title="${COLOR_NAME[s.color]}"></span>
      <span class="small muted" style="white-space:nowrap">${esc(s.course)}</span>
      <input data-edit="star-name" data-star="${s.id}" value="${esc(s.name)}" placeholder="Star name, add (ACT1) if needed">
      <button class="btn sm" data-action="unplace-star" data-star="${s.id}" title="Take it off this room">Remove</button></div>
      <input data-edit="star-notes" data-star="${s.id}" value="${esc(s.notes || "")}" placeholder="Notes (optional)" style="margin-top:6px">
    </div>`).join("") || (state.picking ? "" : `<p class="small muted" style="margin:0">No stars placed here.</p>`)}
  </div>`;
}

function saveCard(){
  const conn = FOLDER
    ? `<p class="small" style="margin:-4px 0 10px">Saving automatically into <b>${esc(state.folderName)}</b>. ${esc(state.saveStatus)}</p>`
    : FS_OK ? `<p class="small muted" style="margin:-4px 0 10px">Open your repo folder and every edit saves straight into it. Until then, edits are only backed up in this browser.</p>
        <button class="btn sm primary" data-action="${state.savedHandle ? "reconnect" : "open-folder"}">${state.savedHandle ? `Reconnect to ${esc(state.savedHandle.name)}` : "Open my repo folder"}</button>`
    : `<p class="small muted" style="margin:-4px 0 10px">This browser can't save into a folder. Use Chrome or Edge, or download the files and copy them into data/.</p>`;
  return `<div class="card"><h3>Save your work</h3>${conn}
    <div class="row" style="margin-top:10px"><button class="btn sm" data-action="dl-map">Download map.json</button><button class="btn sm" data-action="dl-stars">Download stars.json</button></div>
  </div>`;
}

function unlinkPair(e){
  if (!e.pair) return;
  const q = EX[e.pair]; if (q && q.pair === e.id) delete q.pair;
  delete e.pair;
}
function linkTwoWay(e){
  if (e.pair) return;
  const here = P[FROM[e.id]], d = P[e.to]; if (!d) return;
  let q = d.exits.find(x => x.to === here.id && !x.pair && x.type !== "deadly");
  if (q) toast(`Linked to "${q.label || "an existing exit"}" in ${d.name}.`);
  else {
    q = { id:uniqueId(`${d.id}_${d.exits.length + 1}`, id => !!EX[id]), type:e.type, label:`Back to ${here.name}`, to:here.id };
    if (d.kind === "room"){ q.x = 0.5; q.y = 0.5; q.needsPos = true; }
    d.exits.push(q); EX[q.id] = q; FROM[q.id] = d.id;
    toast(`Added the way back in ${d.name}.${d.kind === "room" ? " Place it when you get there." : ""}`);
  }
  q.pair = e.id; e.pair = q.id;
}
function deletePlace(p){
  if (p.id === DATA.start) return;
  p.exits.forEach(unlinkPair);
  DATA.places = DATA.places.filter(x => x.id !== p.id);
  DATA.places.forEach(x => x.exits.forEach(e => {
    if (e.to === p.id){ unlinkPair(e); e.to = ""; }
    if (e.respawn === p.id) delete e.respawn;
    if (e.alts) e.alts = e.alts.filter(a => a.to !== p.id);
  }));
  DATA.stars.forEach(s => { if (s.place === p.id) delete s.place; });
  DATA.switches.forEach(w => { w.places = w.places.filter(x => x !== p.id); });
  state.history = state.history.filter(h => h.here !== p.id);
  if (state.here === p.id){
    state.here = state.history.length ? state.history.pop().here : DATA.start;
    Object.assign(state, { cameVia:null, sel:null });
  }
  Object.assign(state, { delConfirm:null, route:null });
  reindex(); markDirty();
  toast(`Deleted ${p.name}.`);
}

/* ============================== stars ============================== */
function checkBtn(s){
  const on = state.checked.has(s.id);
  return `<button class="check ${s.color || "yellow"} ${on ? "on" : ""}" data-action="toggle-star" data-star="${s.id}" aria-pressed="${on}" aria-label="Collected: ${esc(s.course)}, ${esc(s.name)}">★</button>`;
}
function starRow(s, goButton){
  return `<div class="star-row">${checkBtn(s)}
    <div class="grow">${esc(s.name)}${s.notes ? `<div class="small muted">${esc(s.notes)}</div>` : ""}
      ${!P[s.place] ? `<div class="small muted">Location not logged yet</div>` : ""}</div>
    ${goButton && P[s.place] ? `<button class="btn sm" data-action="route-place" data-place="${s.place}">Go to ${esc(P[s.place].name)}</button>` : ""}
  </div>`;
}
function switchRow(w, goButton){
  const on = state.checked.has(w.id);
  const where = w.places.filter(x => P[x]);
  return `<div class="star-row">
    <button class="check sw ${w.color} ${on ? "on" : ""}" data-action="toggle-switch" data-sw="${w.id}" aria-pressed="${on}" aria-label="Pressed: ${esc(w.name)}">■</button>
    <div class="grow">${esc(w.name)}${goButton && !where.length ? `<div class="small muted">Location not logged yet</div>` : ""}${goButton && where.length > 1 ? `<div class="small muted">In ${where.length} places</div>` : ""}</div>
    ${goButton && where.length ? `<button class="btn sm" data-action="route-switch" data-sw="${w.id}">Take me ${where.length > 1 ? "to the nearest" : "here"}</button>` : ""}
  </div>`;
}
function filteredStars(){
  const q = state.starQ.trim().toLowerCase();
  return DATA.stars.filter(s =>
    (state.starC === "all" || s.color === state.starC) &&
    (state.starShow === "all" || (state.starShow === "todo") !== state.checked.has(s.id)) &&
    (!q || [s.name, s.notes, s.course, ...(s.alsoIn || []), P[s.place] && P[s.place].name].some(t => (t || "").toLowerCase().includes(q))));
}
function starListHTML(){
  const list = filteredStars();
  if (!list.length) return `<div class="card"><p class="muted" style="margin:0">No stars match. Try clearing the search or filters.</p></div>`;
  const groups = [];
  const add = (course, s) => { let g = groups.find(x => x.course === course); if (!g) groups.push(g = { course, stars:[] }); g.stars.push(s); };
  list.forEach(s => { add(s.course, s); (s.alsoIn || []).forEach(c => add(c, s)); });
  return `<div class="grid2">${groups.map(g => {
    const all = DATA.stars.filter(s => s.course === g.course || (s.alsoIn || []).includes(g.course));
    const got = all.filter(s => state.checked.has(s.id)).length;
    const places = [...new Set(all.map(s => s.place))];
    const one = places.length === 1 && P[places[0]] ? places[0] : null;
    return `<div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h3 style="margin:0">${esc(g.course)} <span class="muted small">${got}/${all.length}</span></h3>
        ${one ? `<button class="btn sm" data-action="route-place" data-place="${one}">Take me here</button>` : ""}</div>
      ${g.stars.map(s => starRow(s, !one)).join("")}</div>`;
  }).join("")}</div>`;
}
function renderStars(){
  const tot = c => DATA.stars.filter(s => s.color === c).length;
  const got = c => DATA.stars.filter(s => s.color === c && state.checked.has(s.id)).length;
  return `<div class="card" style="margin-bottom:16px">
    <div class="row" style="justify-content:space-between"><h3 style="margin:0">${DATA.stars.filter(s => state.checked.has(s.id)).length} of ${DATA.stars.length} stars collected</h3>
    <button class="btn sm" data-action="io">${state.showIO ? "Hide backup" : "Back up or restore progress"}</button></div>
    ${state.showIO ? `<p class="small muted">Your checkmarks are saved in this browser. Copy this text somewhere safe to move them to another browser, or paste a backup and press Restore.</p>
      <textarea id="io">${esc(JSON.stringify({ checked:[...state.checked] }))}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-action="import-progress">Restore from text</button></div>` : ""}
    <div class="totals" style="margin-top:12px">${COLORS.map(c => `<div><span class="sc-${c}">★</span> ${COLOR_NAME[c]} <b>${got(c)}/${tot(c)}</b>
      <div class="progress"><div style="width:${tot(c) ? got(c) / tot(c) * 100 : 0}%;background:var(--s${c[0]})"></div></div></div>`).join("")}</div>
    <div class="filters">
      <input data-filter="starq" value="${esc(state.starQ)}" placeholder="Search stars, courses, ACT1…" aria-label="Search stars">
      <select data-change="starC" aria-label="Star color"><option value="all">All colors</option>${COLORS.map(c => `<option value="${c}" ${state.starC === c ? "selected" : ""}>${COLOR_NAME[c]}</option>`).join("")}</select>
      <select data-change="starShow" aria-label="Collected filter"><option value="all">All stars</option><option value="todo" ${state.starShow === "todo" ? "selected" : ""}>Not collected</option><option value="done" ${state.starShow === "done" ? "selected" : ""}>Collected</option></select>
    </div>
  </div>
  <div class="card" style="margin-bottom:16px"><h3>Cap switches <span class="muted small">${DATA.switches.filter(w => state.checked.has(w.id)).length}/${DATA.switches.length}</span></h3>
    ${DATA.switches.map(w => switchRow(w, true)).join("")}</div>
  <div id="starlist">${starListHTML()}</div>`;
}

/* ============================== where am I ============================== */
function neighborsMap(){
  // connections in both directions, including "sometimes" outcomes and deadly dead ends (not respawns)
  const nb = {};
  const link = (a, b) => { if (!P[a] || !P[b] || a === b) return; (nb[a] = nb[a] || new Set()).add(b); (nb[b] = nb[b] || new Set()).add(a); };
  DATA.places.forEach(p => p.exits.forEach(e => { link(p.id, e.to); (e.alts || []).forEach(a => link(p.id, a.to)); }));
  return nb;
}
function roomSelectMatches(){
  const q = state.rsQ.trim().toLowerCase(), nb = neighborsMap();
  return DATA.places.filter(p => p.kind === "room")
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .filter(p => p.exits.length >= state.rsMin)
    .filter(p => state.rsConn.every(c => nb[p.id] && nb[p.id].has(c)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function roomSelectResultsHTML(){
  const list = roomSelectMatches(), shown = list.slice(0, state.rsShow);
  if (!list.length) return `<div class="card"><h3>No rooms match</h3><p class="muted" style="margin:0">Try removing a filter. If you're sure about what you picked, this room may not be logged yet.</p></div>`;
  return `<p class="small muted" style="margin:0 0 10px">${list.length} room${list.length === 1 ? "" : "s"}${list.length > shown.length ? `, showing ${shown.length}` : ""}</p>
    <div class="results">${shown.map(p => `<div class="card result">
      <div class="mini">${mapHTML(p)}</div>
      <b>${esc(p.name)}</b> <span class="match">${p.exits.length} way${p.exits.length === 1 ? "" : "s"} out</span>
      <div class="row" style="margin-top:8px"><button class="btn sm primary" data-action="here" data-place="${p.id}">I'm here</button>
      <button class="btn sm" data-action="route-place" data-place="${p.id}">Take me here</button>
      ${LOG_MODE && p.id !== DATA.start ? `<button class="btn sm danger" data-action="del-place" data-place="${p.id}">${state.delConfirm === p.id ? "Click again to delete" : "Delete"}</button>` : ""}</div></div>`).join("")}</div>
    ${list.length > shown.length ? `<div class="row" style="margin-top:14px;justify-content:center"><button class="btn" data-action="rs-more">Show more rooms</button></div>` : ""}`;
}
function rsConnListHTML(){
  const q = state.rsConnQ.trim().toLowerCase();
  if (!q) return "";
  const list = DATA.places.filter(p => !state.rsConn.includes(p.id) && p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
  return list.map(p => `<button class="swatch" data-action="rs-add" data-place="${p.id}">${esc(p.name)}${p.kind === "course" ? " (course)" : ""}</button>`).join("") || `<span class="small muted">Nothing by that name.</span>`;
}
function renderFind(){
  const minBtn = (v, t) => `<button class="swatch ${state.rsMin === v ? "on" : ""}" data-action="rs-min" data-v="${v}">${t}</button>`;
  return `<div class="explore find">
    <div class="card">
      <div class="field"><span class="lbl">Room name</span>
        <input data-filter="rsq" value="${esc(state.rsQ)}" placeholder="Search by name" aria-label="Search rooms by name"></div>
      <div class="field"><span class="lbl">I see at least this many ways out</span>
        ${minBtn(0, "Any")}${[1, 2, 3, 4, 5, 6, 7, 8].map(n => minBtn(n, String(n))).join("")}</div>
      <div class="field"><span class="lbl">It connects to</span>
        <p class="small muted" style="margin:0 0 6px">Add every room or course you know it leads to or comes from. Only rooms connected to all of them are shown.</p>
        <div class="picked">${state.rsConn.map(id => `<span class="cchip" style="padding-left:10px">${esc(placeName(id))}<button data-action="rs-remove" data-place="${id}" aria-label="Remove ${esc(placeName(id))}">✕</button></span>`).join("")}</div>
        <input data-filter="rsconnq" value="${esc(state.rsConnQ)}" placeholder="Type a room or course name to add it" aria-label="Add a connected room or course">
        <div id="rsconnlist" style="margin-top:6px">${rsConnListHTML()}</div></div>
      <button class="btn sm" data-action="rs-reset">Clear filters</button>
    </div>
    <div id="rsresults">${roomSelectResultsHTML()}</div>
  </div>`;
}

/* ============================== route ============================== */
function stepHTML(step){
  const e = EX[step.e];
  return `<li><b>${esc(P[FROM[step.e]].name)}</b>: take <span class="num">${exitNum(step.e)}</span> ${esc(e.label || typeName(e.type))}${e.floor ? ` on the ${esc(e.floor)}` : ""}
    <span class="muted">(${esc(typeName(e.type))})</span>, arriving in <b>${esc(P[step.to].name)}</b>
    ${step.luck ? `<span class="tag warn">only sometimes</span>` : ""}</li>`;
}
function renderRoute(){
  const from = P[state.planFrom] ? state.planFrom : state.here;
  const to = P[state.planTo] ? state.planTo : null;
  const grp = (kind, label, sel) => `<optgroup label="${label}">${sortedPlaces(kind).map(p => `<option value="${p.id}" ${sel === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</optgroup>`;
  let result = "";
  if (to){
    const steps = bestRoute(from, to);
    if (!steps) result = `<div class="card"><h3>No route found</h3><p class="muted" style="margin:0">Nothing in the map connects these two places yet.</p></div>`;
    else if (!steps.length) result = `<div class="card"><h3>You're already there</h3></div>`;
    else result = `<div class="card"><h3>${steps.length} ${steps.length === 1 ? "step" : "steps"}</h3>
      ${steps.some(s => s.luck) ? `<p class="small muted" style="margin:-4px 0 10px">Part of this route depends on an exit that only sometimes leads the right way.</p>` : ""}
      <ol class="itin">${steps.map(stepHTML).join("")}</ol>
      <button class="btn primary" data-action="start-plan">Guide me step by step</button></div>`;
  }
  return `<div class="card form">
      <label class="f">From<select data-change="planFrom">${grp("room", "Rooms", from)}${grp("course", "Courses", from)}</select></label>
      <label class="f">To<select data-change="planTo"><option value="">Choose a room or course</option>${grp("room", "Rooms", to)}${grp("course", "Courses", to)}</select></label>
    </div>${result}`;
}

/* ============================== data check ============================== */
function reachSet(start, reverse){
  // every edge, including "sometimes" outcomes and deaths, for checking connectivity
  const adj = {};
  const link = (a, b) => { if (!P[a] || !P[b]) return; const [x, y] = reverse ? [b, a] : [a, b]; (adj[x] = adj[x] || []).push(y); };
  DATA.places.forEach(p => p.exits.forEach(e => {
    link(p.id, e.to); (e.alts || []).forEach(a => link(p.id, a.to));
    if (e.type === "deadly") link(p.id, e.respawn);
  }));
  const seen = new Set([start]), queue = [start];
  while (queue.length){ const c = queue.shift(); (adj[c] || []).forEach(n => { if (!seen.has(n)){ seen.add(n); queue.push(n); } }); }
  return seen;
}
function fileMissing(path){ return FOLDER ? !LOCAL[path] : BROKEN.has(path); }

function dataCheck(){
  const issues = [], seenP = new Set(), seenE = new Set();
  const add = (sev, msg) => issues.push([sev, msg]);
  Object.entries(DATA.typeArt || {}).forEach(([t, id]) => { if (!ART[id]) add("error", `The default picture for ${typeName(t)} is "${id}", which isn't in the picture list.`); });
  (DATA.art || []).forEach(a => { if (fileMissing(a.file)) add("warn", `The picture file ${a.file} is missing.`); });
  DATA.places.forEach(p => { if (seenP.has(p.id)) add("error", `Two places share the id "${p.id}".`); seenP.add(p.id); });
  DATA.places.forEach(p => {
    // courses don't need exits: you can always leave by dying, getting a star or fast travel
    if (!p.exits.length && p.kind === "room") add("warn", `${p.name} has no exits logged.`);
    if (p.kind === "room" && !p.shape) add("info", `${p.name} has no drawing yet.`);
    if (p.shape && fileMissing(p.shape)) add("warn", `${p.name}'s drawing ${p.shape} is missing.`);
    if (p.kind === "room" && !p.color) add("info", `${p.name} has no fill color yet.`);
    if (p.color && !isHex(p.color)) add("error", `${p.name} has a fill color "${p.color}" that isn't a #RRGGBB color.`);
    (p.colors || []).forEach(c => { if (!isHex(c)) add("error", `${p.name} has a color "${c}" that isn't a #RRGGBB color.`); });
    if (p.shape && isHex(p.color)){ const fl = FILLED[asset(p.shape) + "|" + (p.color || "none")]; if (fl && fl.leak) add("warn", `${p.name}'s drawing seems to have a gap in its outline, so it can't be filled.`); }
    p.exits.forEach(e => {
      const nm = `${p.name}: "${e.label || e.id}"`;
      if (seenE.has(e.id)) add("error", `Two exits share the id "${e.id}".`); seenE.add(e.id);
      if (e.art && !ART[e.art]) add("error", `${nm} uses picture "${e.art}", which isn't in the picture list.`);
      if (e.needsPos) add("info", `${nm} hasn't been placed on the drawing yet.`);
      if (!TYPE[e.type]) add("warn", `${nm} still uses the old exit type "${typeName(e.type)}". Pick one from the new list.`);
      if (e.type === "deadly"){
        if (e.to && !P[e.to]) add("error", `${nm} leads to "${e.to}", which doesn't exist.`);
        if (e.respawn && !P[e.respawn]) add("error", `${nm} respawns you in "${e.respawn}", which doesn't exist.`);
        if (!e.respawn) add("info", `${nm} is a deadly dead end with no respawn place noted.`);
        return;
      }
      (e.alts || []).forEach(a => {
        if (!a.to) add("warn", `${nm} has a "sometimes" destination that isn't set.`);
        else if (!P[a.to]) add("error", `${nm} sometimes leads to "${a.to}", which doesn't exist.`);
        else if (a.to === e.to) add("warn", `${nm} lists ${P[a.to].name} as both its usual and its "sometimes" destination.`);
      });
      if (!e.to){ add("warn", `${nm} doesn't lead anywhere yet.`); return; }
      if (!P[e.to]){ add("error", `${nm} leads to "${e.to}", which doesn't exist.`); return; }
      if (e.pair){
        const q = EX[e.pair];
        if (!q) add("error", `${nm} says you come out at "${e.pair}", which doesn't exist.`);
        else if (FROM[q.id] !== e.to) add("error", `${nm} goes to ${P[e.to].name}, but its partner is in ${P[FROM[q.id]].name}.`);
        else if (q.to !== p.id) add("warn", `${nm} is marked two-way, but going back through "${q.label}" leads to ${placeName(q.to)}.`);
        else if (q.pair !== e.id) add("warn", `"${e.id}" and "${e.pair}" should name each other as partners.`);
      }
    });
  });
  if (P[DATA.start]){
    const fwd = reachSet(DATA.start, false);
    DATA.places.forEach(p => {
      if (p.id === DATA.start) return;
      if (!fwd.has(p.id)) add("warn", `${p.name} can't be reached from ${P[DATA.start].name} with the current map.`);
      else {
        if (!findRoute(DATA.start, p.id, false) && findRoute(DATA.start, p.id, true)) add("info", `${p.name} can only be reached through an exit that only sometimes leads there.`);
      }
    });
  }
  DATA.switches.forEach(w => {
    if (!w.places.length) add("info", `${w.name} hasn't been placed on the map yet.`);
    w.places.forEach(x => { if (!P[x]) add("error", `${w.name} is placed in "${x}", which doesn't exist.`); });
  });
  DATA.stars.forEach(s => {
    if (s.place && !P[s.place]) add("error", `${s.course}, ${s.name} is placed in "${s.place}", which doesn't exist.`);
    if (!COLORS.includes(s.color)) add("warn", `${s.course}, ${s.name} needs a color (yellow, red or green).`);
    if ((s.alsoIn || []).length) add("info", `${s.course}, ${s.name} shares a save spot with a star in ${s.alsoIn.join(", ")}. Collecting one marks both, and they count as one star.`);
  });
  const un = unplacedStars();
  if (un.length) add("info", `${un.length} of ${DATA.stars.length} stars aren't placed on the map yet: ${un.slice(0, 25).map(s => `${s.course} ${s.name.replace("Star ", "#")}`).join(", ")}${un.length > 25 ? `, and ${un.length - 25} more` : ""}.`);
  const order = { error:0, warn:1, info:2 };
  return issues.sort((a, b) => order[a[0]] - order[b[0]]);
}
function renderCheck(){
  const issues = dataCheck();
  const exits = DATA.places.reduce((n, p) => n + p.exits.length, 0);
  const oneWay = DATA.places.reduce((n, p) => n + p.exits.filter(e => !e.pair && e.type !== "deadly").length, 0);
  const placed = DATA.stars.length - unplacedStars().length;
  return `<div class="card" style="margin-bottom:16px"><div class="stats">
      <div><b>${DATA.places.filter(p => p.kind === "room").length}</b><span class="muted small">rooms</span></div>
      <div><b>${DATA.places.filter(p => p.kind === "course").length}</b><span class="muted small">courses</span></div>
      <div><b>${exits}</b><span class="muted small">exits</span></div>
      <div><b>${oneWay}</b><span class="muted small">one-way</span></div>
      <div><b>${(DATA.art || []).length}</b><span class="muted small">exit pictures</span></div>
      <div><b>${placed}/${DATA.stars.length}</b><span class="muted small">stars placed</span></div>
    </div></div>
    <div class="card"><h3>${issues.length ? `${issues.length} things to look at` : "No problems found"}</h3>
    ${issues.map(([sev, msg]) => `<div class="issue ${sev}">${esc(msg)}</div>`).join("")}</div>`;
}

/* ============================== render ============================== */
function renderChips(){
  if (!DATA) return;
  const tot = c => DATA.stars.filter(s => s.color === c).length;
  const got = c => DATA.stars.filter(s => s.color === c && state.checked.has(s.id)).length;
  let folder = "";
  if (LOG_MODE){
    if (FOLDER) folder = `<span class="chip ok">Saving to <b>${esc(state.folderName)}</b>${state.saveStatus ? `: ${esc(state.saveStatus)}` : ""}</span>`;
    else if (FS_OK) folder = `<button class="chip btnchip ${state.dirty ? "bad" : ""}" data-action="${state.savedHandle ? "reconnect" : "open-folder"}">${state.savedHandle ? `Reconnect to ${esc(state.savedHandle.name)}` : "Open my repo folder"}${state.dirty ? " (unsaved edits)" : ""}</button>`;
    else if (state.dirty) folder = `<span class="chip bad">Unsaved map edits</span>`;
  }
  $("#chips").innerHTML = `${folder}
    <span class="chip">You're in <b>${esc(P[state.here].name)}</b></span>
    ${COLORS.map(c => `<span class="chip"><span class="sc-${c}">★</span> <b>${got(c)}/${tot(c)}</b></span>`).join("")}`;
}
function topNotices(){
  const out = [];
  if (state.loadError) out.push(`<div class="banner lost"><div class="grow"><b>The map data couldn't be loaded.</b> If you opened index.html straight from your computer, open the site from GitHub Pages instead${LOG_MODE && FS_OK ? ", or open your repo folder" : ""}.</div></div>`);
  if (LOG_MODE && !FOLDER && FS_OK) out.push(`<div class="banner ask"><div class="grow"><b>Your repo folder isn't connected.</b> Edits won't be saved there, and pictures you haven't pushed yet won't show.</div>
      <button class="btn primary" data-action="${state.savedHandle ? "reconnect" : "open-folder"}">${state.savedHandle ? `Reconnect to ${esc(state.savedHandle.name)}` : "Open my repo folder"}</button></div>`);
  if (LOG_MODE && state.draft){
    const when = new Date(state.draft.time).toLocaleString([], { dateStyle:"medium", timeStyle:"short" });
    out.push(`<div class="banner ask"><div class="grow"><b>You have map edits from ${esc(when)} that were never saved.</b></div>
      <div class="row"><button class="btn primary" data-action="restore-draft">Restore them</button><button class="btn" data-action="discard-draft">Discard</button></div></div>`);
  }
  return out.join("");
}
function render(){
  if (!DATA) return;
  renderChips();
  $("#nav-check").hidden = !LOG_MODE;
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
  const views = { explore:renderExplore, stars:renderStars, find:renderFind, route:renderRoute, check:renderCheck };
  $("#app").innerHTML = topNotices() + (views[state.tab] || renderExplore)();
}

/* ============================== events ============================== */
document.addEventListener("click", ev => {
  const m = ev.target.closest(".map[data-map]");
  if (state.placing && m){
    const rc = m.getBoundingClientRect(), [vx, vy, vw, vh] = m.dataset.view.split(",").map(Number);
    const x = round3(vx + (ev.clientX - rc.left) / rc.width * vw), y = round3(vy + (ev.clientY - rc.top) / rc.height * vh);
    const p = P[state.here];
    if (state.placing === "exit"){
      const e = { id:uniqueId(`${p.id}_${p.exits.length + 1}`, id => !!EX[id]), type:"door", x, y, label:"", to:"" };
      p.exits.push(e); state.sel = e.id; state.newKind = null; state.newFor = null;
    } else if (state.placing === "move"){ const e = EX[state.sel]; e.x = x; e.y = y; delete e.needsPos; }
    else if (state.placing === "label"){ (p.labels = p.labels || []).push({ text:"New label", x, y }); }
    else if (state.placing.startsWith("label:")){ const l = p.labels[+state.placing.slice(6)]; l.x = x; l.y = y; }
    state.placing = null; reindex(); markDirty(); render(); return;
  }
  const ex = ev.target.closest("[data-exit]:not([data-action])");
  if (ex){
    if (state.edit){ state.sel = state.sel === ex.dataset.exit ? null : ex.dataset.exit; state.newKind = null; state.newFor = null; state.newName = ""; render(); }
    else takeExit(ex.dataset.exit);
    return;
  }
  const el = ev.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action, p = P[state.here];
  const actions = {
    "tab": () => { state.tab = el.dataset.tab; state.placing = null; window.scrollTo(0, 0); },
    "back": () => goBack(),
    "toggle-star": () => { const id = el.dataset.star; state.checked.has(id) ? state.checked.delete(id) : state.checked.add(id); saveProgress(); },
    "route-place": () => { if (startRoute(el.dataset.place)){ state.tab = "explore"; state.edit = false; window.scrollTo(0, 0); } },
    "clear-route": () => { state.route = null; },
    "here": () => { setHere(el.dataset.place); state.tab = "explore"; },
    "choose": () => takeExit(el.dataset.exit, el.dataset.to),
    "go-deadly": () => { const e = EX[state.confirm]; const to = el.dataset.to; if (to === e.respawn && to !== e.to) toast(`You died and ended up in ${P[to].name}.`); takeExit(e.id, to); },
    "cancel-choice": () => { state.choose = null; state.confirm = null; },
    "start-plan": () => {
      const to = state.planTo; if (!P[to]) return;
      const from = P[state.planFrom] ? state.planFrom : state.here;
      if (from !== state.here) setHere(from);
      if (startRoute(to)){ state.tab = "explore"; state.edit = false; }
    },
    "io": () => { state.showIO = !state.showIO; },
    "import-progress": () => {
      try { const obj = JSON.parse($("#io").value); state.checked = new Set((obj.checked || []).filter(id => STAR[id])); saveProgress(); toast(`Restored ${state.checked.size} stars.`); }
      catch { toast("That text isn't a valid backup. Copy all of it, including the curly braces."); }
    },
    "open-folder": () => { openFolder(); },
    "reconnect": () => { reconnectFolder(); },
    "restore-draft": () => {
      const d = state.draft; applyData(d.map, d.stars); state.draft = null; state.dirty = true;
      if (FOLDER) saveToFolder();
      toast(FOLDER ? "Restored and saved into your folder." : "Restored. Open your repo folder to save them.");
    },
    "discard-draft": () => { clearDraft(); state.draft = null; },
    "dl-map": () => download("map.json", exportMap()),
    "dl-stars": () => download("stars.json", exportStars()),
    "edit-toggle": () => { state.edit = !state.edit; Object.assign(state, { sel:null, placing:null, newKind:null, newFor:null, picking:false, delConfirm:null, choose:null, confirm:null }); },
    "cancel-place": () => { state.placing = null; },
    "add-exit": () => {
      if (p.kind === "room"){ state.placing = "exit"; return; }
      const e = { id:uniqueId(`${p.id}_${p.exits.length + 1}`, id => !!EX[id]), type:"door", label:"", to:"" };
      p.exits.push(e); state.sel = e.id; reindex(); markDirty();
    },
    "move-exit": () => { state.placing = "move"; },
    "go-exit": () => {
      const e = EX[state.sel];
      if (e.type === "deadly") takeExit(e.id, P[e.to] ? e.to : e.respawn);
      else { const outs = outcomesOf(e); outs.length > 1 ? takeExit(e.id) : takeExit(e.id, outs[0]); }
    },
    "del-exit": () => {
      const e = EX[state.sel]; unlinkPair(e);
      p.exits = p.exits.filter(x => x.id !== e.id); state.sel = null; state.route = null; reindex(); markDirty();
      toast("Exit deleted.");
    },
    "create-new": () => {
      const e = EX[state.sel], key = state.newFor, name = state.newName.trim() || `Untitled ${state.newKind}`;
      const id = uniqueId(slug(name), x => !!P[x]);
      DATA.places.push({ id, name, kind:state.newKind, exits:[] });
      reindex(); setDest(e, key, id);
      state.newKind = null; state.newFor = null; state.newName = ""; reindex(); markDirty();
      toast(key === "to" && e.type !== "deadly" ? `Created ${name}. Tick two-way if there's a way straight back, then go through to log it.` : `Created ${name}.`);
    },
    "add-alt": () => { const e = EX[state.sel]; (e.alts = e.alts || []).push({ to:"", note:"" }); markDirty(); },
    "del-alt": () => { const e = EX[state.sel]; state.newKind = null; state.newFor = null; e.alts.splice(+el.dataset.i, 1); if (!e.alts.length) delete e.alts; markDirty(); },
    "add-label": () => { state.placing = "label"; },
    "move-label": () => { state.placing = "label:" + el.dataset.i; },
    "del-label": () => { p.labels.splice(+el.dataset.i, 1); markDirty(); },
    "del-place": () => {
      const target = P[el.dataset.place || p.id]; if (!target) return;
      if (state.delConfirm === target.id) deletePlace(target); else state.delConfirm = target.id;
    },
    "hex": () => { const hex = el.dataset.hex; if (p.color === hex) delete p.color; else p.color = hex; markDirty(); },
    "pick-art": () => {
      const id = el.dataset.art, e = EX[state.sel];
      if (e.art === id || (!e.art && (DATA.typeArt || {})[e.type] === id)) delete e.art; else e.art = id;
      markDirty();
    },
    "set-default-art": () => {
      const e = EX[state.sel]; DATA.typeArt[e.type] = e.art; delete e.art; markDirty();
      toast(`Every ${typeName(e.type).toLowerCase()} without its own picture now uses this one.`);
    },
    "toggle-picker": () => { state.picking = !state.picking; state.pickQ = ""; },
    "place-star": () => { STAR[el.dataset.star].place = p.id; markDirty(); },
    "place-group": () => {
      const list = unplacedStars().filter(s => s.course === el.dataset.course);
      list.forEach(s => { s.place = p.id; }); markDirty();
      toast(`Placed ${list.length} star${list.length > 1 ? "s" : ""} in ${p.name}.`);
    },
    "unplace-star": () => { delete STAR[el.dataset.star].place; markDirty(); },
    "toggle-switch-place": () => { const w = SWITCH[el.dataset.sw]; w.places = w.places.includes(p.id) ? w.places.filter(x => x !== p.id) : [...w.places, p.id]; markDirty(); },
    "toggle-switch": () => { const id = el.dataset.sw; state.checked.has(id) ? state.checked.delete(id) : state.checked.add(id); saveProgress(); },
    "route-switch": () => { if (startRoute(SWITCH[el.dataset.sw].places)){ state.tab = "explore"; state.edit = false; window.scrollTo(0, 0); } },
    "rs-min": () => { state.rsMin = Number(el.dataset.v); state.rsShow = 48; },
    "rs-add": () => { if (!state.rsConn.includes(el.dataset.place)) state.rsConn.push(el.dataset.place); state.rsConnQ = ""; state.rsShow = 48; },
    "rs-remove": () => { state.rsConn = state.rsConn.filter(x => x !== el.dataset.place); state.rsShow = 48; },
    "rs-reset": () => { Object.assign(state, { rsQ:"", rsMin:0, rsConn:[], rsConnQ:"", rsShow:48 }); },
    "rs-more": () => { state.rsShow += 48; }
  };
  if (actions[a]){ actions[a](); render(); }
});

// typing: update the data without redrawing, so the cursor stays put
document.addEventListener("input", ev => {
  const el = ev.target;
  if (el.dataset.filter === "starq"){ state.starQ = el.value; $("#starlist").innerHTML = starListHTML(); return; }
  if (el.dataset.filter === "rsq"){ state.rsQ = el.value; state.rsShow = 48; $("#rsresults").innerHTML = roomSelectResultsHTML(); return; }
  if (el.dataset.filter === "rsconnq"){ state.rsConnQ = el.value; $("#rsconnlist").innerHTML = rsConnListHTML(); return; }
  if (el.dataset.filter === "pickq"){ state.pickQ = el.value; $("#picklist").innerHTML = pickListHTML(); return; }
  if (el.dataset.edit && el.tagName === "INPUT" && el.type !== "checkbox") applyEdit(el);
});
// dropdowns, checkboxes and files: apply, then redraw
document.addEventListener("change", ev => {
  const el = ev.target;
  if (el.dataset.file) return handleFile(el);
  if (el.dataset.change){ state[el.dataset.change] = el.value; render(); return; }
  if (el.dataset.edit && (el.tagName === "SELECT" || el.type === "checkbox")){ applyEdit(el); reindex(); render(); }
});

function applyEdit(el){
  const k = el.dataset.edit, v = el.value, p = P[state.here], e = state.sel ? EX[state.sel] : null;
  const s = el.dataset.star ? STAR[el.dataset.star] : null;
  switch (k){
    case "name": { p.name = v; const h = $("#placename"); if (h) h.textContent = v; break; }
    case "kind": p.kind = v; break;
    case "shape": if (v.trim()) p.shape = v.trim(); else delete p.shape; break;
    case "view": p.view = v; break;
    case "label": p.labels[+el.dataset.i].text = v; break;
    case "ex-label": e.label = v; break;
    case "ex-type":
      e.type = v;
      if (v === "deadly"){ unlinkPair(e); delete e.alts; delete e.arrive; } else delete e.respawn;
      break;
    case "ex-floor": if (v.trim()) e.floor = v; else delete e.floor; break;
    case "ex-arrive": if (v.trim()) e.arrive = v; else delete e.arrive; break;
    case "dest": {
      const key = destKey(el.dataset.field, el.dataset.i == null ? null : +el.dataset.i);
      if (v.startsWith("__new")){ state.newKind = v === "__new_room" ? "room" : "course"; state.newFor = key; return; }
      if (state.newFor === key){ state.newKind = null; state.newFor = null; }
      setDest(e, key, v); break;
    }
    case "ex-twoway": el.checked ? linkTwoWay(e) : unlinkPair(e); break;
    case "alt-note": e.alts[+el.dataset.i].note = v; break;
    case "newname": state.newName = v; return;
    case "star-name": s.name = v; break;
    case "star-notes": if (v.trim()) s.notes = v; else delete s.notes; break;
  }
  markDirty();
}

function handleFile(el){
  (async () => {
    const files = [...el.files]; if (!files.length) return;
    const p = P[state.here], kind = el.dataset.file;
    let firstArt = null, writeFailed = false;
    for (const file of files){
      const sub = kind === "shape" ? "rooms" : "art";
      const path = `assets/${sub}/${file.name}`;
      if (FOLDER){ try { await writeAsset(sub, file); } catch { writeFailed = true; } }
      if (LOCAL[path]) URL.revokeObjectURL(LOCAL[path]);
      LOCAL[path] = URL.createObjectURL(file);
      if (FOLDER && !writeFailed) FILESIG[path] = file.size + ":" + file.lastModified;
      if (kind === "shape") p.shape = path;
      else {
        let a = DATA.art.find(x => x.file === path);
        if (!a){
          const base = file.name.replace(/\.[^.]+$/, "");
          a = { id:uniqueId(slug(base), id => !!ART[id]), name:base.replace(/[_-]+/g, " "), file:path };
          DATA.art.push(a); ART[a.id] = a;
        }
        firstArt = firstArt || a.id;
      }
    }
    if (firstArt && EX[state.sel]) EX[state.sel].art = firstArt;
    el.value = "";
    reindex(); markDirty(); render();
    toast(writeFailed ? "Couldn't write the picture into your repo folder. Reconnect and try again."
      : FOLDER ? `Saved into ${state.folderName}/assets/${kind === "shape" ? "rooms" : "art"}.`
      : "Loaded for this session only. Open your repo folder so pictures get saved.");
  })();
}

/* ============================== start ============================== */
async function fetchJSON(url){ const r = await fetch(url, { cache:"no-cache" }); if (!r.ok) throw new Error(url); return r.json(); }
async function init(){
  loadProgress();
  try {
    const [map, stars] = await Promise.all([fetchJSON("data/map.json"), fetchJSON("data/stars.json")]);
    applyData(map, stars);
  } catch {
    applyData(STARTER, { stars:[] });
    state.loadError = true;
  }
  if (LOG_MODE){
    const d = readDraft(); if (d && d.map) state.draft = d;
    if (FS_OK){
      try {
        const h = await idbGet("folder");
        if (h){
          state.savedHandle = h;
          if (await h.queryPermission({ mode:"readwrite" }) === "granted") await useFolder(h);
        }
      } catch {}
    }
  }
  render();
}
window.addEventListener("focus", async () => {
  if (!LOG_MODE || !FOLDER) return;
  try { if (await indexAssets()) render(); } catch {}
});
window.addEventListener("beforeunload", ev => { if (LOG_MODE && state.dirty && !FOLDER){ ev.preventDefault(); ev.returnValue = ""; } });
init();