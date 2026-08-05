/**
 * guide-lab / sources.js —— 素材登錄表 + SVG 載入 / 解析 / 細節線分群
 */

import { VB, makeCam, wheelCenters, beltRing, CAR } from "./geom.js";

export const CORNERS = [
  { id: "lf", label: "左前", en: "front-left" },
  { id: "rf", label: "右前", en: "front-right" },
  { id: "lr", label: "左後", en: "rear-left" },
  { id: "rr", label: "右後", en: "rear-right" },
];

const REF = "assets/car-reference";
const GEN = `${REF}/generated`;

/* ── iRent 專屬版 ───────────────────────────────────────────────────── */

export const IRENT = {
  key: "irent",
  name: "iRent 專屬版",
  vehicle: "Toyota Corolla Cross XG10（4.46 × 1.825 × 1.62 m）",
  licence: "CC BY 4.0 —— 可交付、可商用，僅須標示作者",
  licenceLevel: "ok",
  licenceNote:
    "輪廓與渲圖衍生自 Sketchfab 的 CC BY 4.0 模型 " +
    "「Toyota Corolla Cross」by Nieve5677（https://sketchfab.com/niev）。" +
    "散布時須保留 demo/assets/car-reference/ATTRIBUTION.md §2 的標示；CC BY 無 copyleft 感染性。",
  svg: (corner) => `${GEN}/guide-cuv-${corner}.svg`,
};

/** build-report.json 讀不到時的保底基準值（數字與該檔一致） */
export const FALLBACK_META = {
  lf: { azimuth_deg: 45, target_xyz: [-0.237, 0.436, 0.314] },
  rf: { azimuth_deg: 315, target_xyz: [0.237, 0.436, 0.314] },
  lr: { azimuth_deg: 135, target_xyz: [-0.242, 0.438, -0.321] },
  rr: { azimuth_deg: 225, target_xyz: [0.242, 0.438, -0.321] },
};
export const BASE_PARAMS = { distance: 3.85, height: 1.5, yaw: 45, focal: 26 };

/* ── Monk BSD 基準版 ────────────────────────────────────────────────
 * ⚠ 這四張 overlay 不是四個角。對應關係查自 monk/NOTICE.md §4：
 *      fesc20-0mJeXBDf = front-lateral-full-right  右前 45°
 *      fesc20-EJ0tXYBW = rear-lateral-full-right   右後 45°
 *      fesc20-T4dIGLgy = rear-lateral-full-left    左後 45°
 *      fesc20-bD8CBhYZ = beauty-shot-left          左側全景（非 45° 角）
 *   缺 front-lateral-full-left（左前 45°）。車體左右對稱 → 鏡射右前即可補上，
 *   但畫面上必須標明是鏡射來的。
 *
 * 左右手性已驗證：iRent rf / rr / lr 的「近端」落在畫面 右 / 左 / 右，
 * Monk 對應三張完全一致 → 兩邊命名慣例相同，不需要整體翻面。
 */
const MONK_DIR = "assets/guides/monk";
export const MONK = {
  key: "monk",
  name: "Monk BSD 版",
  vehicle: "fesc20 — Ford Escape SE 2020（4.60 × 2.15 × 1.67 m）",
  licence: "BSD-3-Clause-Clear —— 可交付、可進版控",
  licenceLevel: "ok",
  licenceNote:
    "散布時須保留 assets/guides/monk/LICENSE 與 NOTICE.md。" +
    "注意 Clear 版本明文不授予專利權，商用前須另做 FTO 評估（見 NOTICE.md §5）。",
  sources: {
    rf: [{ id: "fesc20-0mJeXBDf", sight: "front-lateral-full-right", label: "右前 45°（原生 sight）", origin: "native" }],
    rr: [{ id: "fesc20-EJ0tXYBW", sight: "rear-lateral-full-right", label: "右後 45°（原生 sight）", origin: "native" }],
    lr: [{ id: "fesc20-T4dIGLgy", sight: "rear-lateral-full-left", label: "左後 45°（原生 sight）", origin: "native" }],
    lf: [
      { id: "fesc20-0mJeXBDf", sight: "front-lateral-full-right", label: "鏡射自右前（幾何等價）", origin: "mirrored", mirror: true },
      { id: null, label: "不補 —— 顯示缺口", origin: "gap" },
      { id: "fesc20-bD8CBhYZ", sight: "beauty-shot-left", label: "⚠ beauty-shot-left（左側全景，非 45°）", origin: "not-a-corner" },
    ],
  },
  svg: (id) => `${MONK_DIR}/cuv/overlays/${id}.svg`,
};

/* ── 參考底圖 ───────────────────────────────────────────────────────
 * render-*-glb-ccby.png：本專案自渲（來源為 §IRENT 的 CC BY 模型），
 *   相機參數與 guide-cuv-*.svg 逐項相同（build-report.json 的 position/target/fov），
 *   實測畫面填充率誤差 ≤0.3% → 判斷「輪廓抽得準不準」的首選。
 *   ⚠ 舊的 render-*-glb-3dw.png 已從版控移除（授權未確認，見 ATTRIBUTION.md §3）；
 *     那批渲圖的取景與 SVG 相機還差約 3% 畫面，並非「完全一致」。
 * phone-*.jpg ：CC BY-SA 4.0，只能當比對背景，不可描邊。
 */
export const PHOTOS = {
  lf: [
    { src: `${REF}/render-lf-glb-ccby.png`, label: "3D 渲圖（CC BY 模型 · 相機與輪廓同參數）", kind: "render" },
    { src: `${REF}/phone-lf-commons-graphite-A.jpg`, label: "實車 A 石墨灰 · 25mm/4:3 · 3.2–3.6m · 偏擺 33°", kind: "photo", note: "四角素材中最接近目標站位", by: "Celica21gtfour" },
    { src: `${REF}/phone-lf-commons-white-C.jpg`, label: "實車 C 白 · 27mm/16:9 · 3.8–4.2m · 偏擺 40°", kind: "photo", note: "畫面比例是 16:9，非 4:3", by: "Areaseven" },
    { src: `${REF}/phone-lf-commons-black-G.jpg`, label: "實車 G 黑 · 估距 6–8m", kind: "photo", note: "站太遠，僅供視覺參考", by: "Ethan Llamas" },
  ],
  rf: [
    { src: `${REF}/render-rf-glb-ccby.png`, label: "3D 渲圖（CC BY 模型 · 相機與輪廓同參數）", kind: "render" },
    { src: `${REF}/phone-rf-commons-grey-D.jpg`, label: "實車 D 灰 · 27mm/4:3 · ~3.5m · 偏擺 30°", kind: "photo", note: "rf 的最佳選擇", by: "Captainmorlypogi1959" },
    { src: `${REF}/phone-rf-commons-red-B.jpg`, label: "實車 B 紅 · 26mm/4:3 · 2.5–3m", kind: "photo", note: "全車未入鏡，只能看車頭細節", by: "オーバードライブ83" },
  ],
  lr: [
    { src: `${REF}/render-lr-glb-ccby.png`, label: "3D 渲圖（CC BY 模型 · 相機與輪廓同參數）", kind: "render" },
    { src: `${REF}/phone-lr-commons-graphite-A.jpg`, label: "實車 A 石墨灰 · 25mm/4:3 · 3.2–3.5m · 偏擺 28°", kind: "photo", note: "四角素材中最接近目標站位", by: "Celica21gtfour" },
    { src: `${REF}/phone-lr-commons-white-C.jpg`, label: "實車 C 白 · 27mm/16:9 · 偏擺 40°", kind: "photo", note: "畫面比例是 16:9，非 4:3", by: "Areaseven" },
  ],
  rr: [
    { src: `${REF}/render-rr-glb-ccby.png`, label: "3D 渲圖（CC BY 模型 · 相機與輪廓同參數）", kind: "render" },
    { src: `${REF}/phone-rr-commons-silver-E.jpg`, label: "實車 E 銀 · 焦距未知 · 3–4m · 偏擺 40°", kind: "photo", note: "EXIF 被剝除，焦距不明", by: "Captainmorlypogi1959" },
    { src: `${REF}/phone-rr-commons-silver-F.jpg`, label: "實車 F 銀 · 焦距未知 · ~3.5m · 偏擺 50°", kind: "photo", note: "偏擺最接近 45°，但機高偏高 ~1.7m", by: "Captainmorlypogi1959" },
    { src: `${REF}/phone-rr-commons-red-B.jpg`, label: "實車 B 紅 · 29mm · 3–3.5m", kind: "photo", note: "全車未入鏡，只能看車尾細節", by: "オーバードライブ83" },
  ],
};

/* ── SVG 解析 ───────────────────────────────────────────────────────── */

const NUM = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;

/** iRent 的 path 全是 `M x y L x y … [Z]` 單一子路徑，直接抓數字就好 */
function polyFromD(d) {
  const n = d.match(NUM);
  if (!n) return [];
  const pts = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([+n[i], +n[i + 1]]);
  if (/[Zz]\s*$/.test(d) && pts.length > 2) pts.push(pts[0].slice()); // 補回收尾段
  return pts;
}

/**
 * 用瀏覽器原生的 getPointAtLength 取樣任意 path（Monk 的 overlay 全是貝茲曲線）。
 *
 * ⚠ Monk 的每個 <path> 都是**複合路徑**（單一 d 裡最多 10 段 M 子路徑）。
 *   getPointAtLength 走的是「累積弧長」，moveto 本身長度為 0 ——
 *   所以跨越子路徑邊界的兩個取樣點之間會出現一個突跳。
 *   不切開就會把互不相連的線段用直線接起來，畫面上多出一堆幽靈線。
 *   這裡用「相鄰取樣點距離遠大於取樣間距」來切，剛好也涵蓋 Z + M 的情況。
 *
 * @returns {number[][][]} 一個 path 拆成多條折線
 */
function sampleEl(el, stepUU = 1.7) {
  let total = 0;
  try { total = el.getTotalLength(); } catch { return []; }
  if (!(total > 0)) return [];
  const n = Math.max(2, Math.min(1400, Math.ceil(total / stepUU)));
  const step = total / n;
  const gap = Math.max(6, step * 4);
  const out = [];
  let run = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    let p;
    try { p = el.getPointAtLength(step * i); } catch { break; }
    const q = [p.x, p.y];
    if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > gap) {
      if (run.length >= 2) out.push(run);
      run = [];
    }
    run.push(q);
    prev = q;
  }
  if (run.length >= 2) out.push(run);
  return out;
}

function metrics(pts) {
  let len = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    sx += x; sy += y;
  }
  const span = Math.hypot(maxX - minX, maxY - minY);
  return {
    pts, len, span, cx: sx / pts.length, cy: sy / pts.length,
    bbox: [minX, minY, maxX, maxY],
    // 排序分數：用 span 而非 len，避免「來回描同一條邊」的雜訊路徑被高估
    score: Math.max(span, 0.6 * len),
  };
}

async function fetchSvgDoc(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const txt = await res.text();
  const doc = new DOMParser().parseFromString(txt, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error(`SVG 解析失敗：${url}`);
  return doc;
}

/** iRent 的 SVG 是純折線（M…L…），直接讀數字，不需重新取樣 */
export async function loadIRentGuide(corner) {
  const doc = await fetchSvgDoc(IRENT.svg(corner));
  const grab = (id) =>
    Array.from(doc.querySelectorAll(`#${id} path`))
      .map((p) => polyFromD(p.getAttribute("d") || ""))
      .filter((pts) => pts.length >= 2)
      .map(metrics);
  let meta = null;
  const mNode = doc.querySelector("#guide-params");
  if (mNode) { try { meta = JSON.parse(mNode.textContent); } catch { /* 用 build-report 的就好 */ } }
  return { outline: grab("outline"), detail: grab("detail"), ground: grab("ground"), meta };
}

/**
 * Monk 的 overlay 是曲線 + class 決定線重，必須進 DOM 才能取樣與讀 computed style。
 * 主輪廓 = stroke-width ≥ 0.75，細節 = < 0.75。
 */
export async function loadMonkGuide(entry) {
  const doc = await fetchSvgDoc(MONK.svg(entry.id));
  const svg = doc.documentElement;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:500px;height:375px;opacity:0;pointer-events:none";
  const imported = document.importNode(svg, true);
  imported.setAttribute("width", "500");
  imported.setAttribute("height", "375");
  host.appendChild(imported);
  document.body.appendChild(host);

  const outline = [], detail = [];
  try {
    for (const el of imported.querySelectorAll("path")) {
      // 上游用 class 決定線重：st1/st2 = 1（主輪廓）、stroke-width:.5 = 細節
      let w = parseFloat(getComputedStyle(el).strokeWidth);
      if (!Number.isFinite(w)) w = parseFloat(el.getAttribute("stroke-width") || "1") || 1;
      const bucket = w >= 0.75 ? outline : detail;
      for (const pts of sampleEl(el)) bucket.push(metrics(pts));
    }
  } finally {
    host.remove();
  }
  if (entry.mirror) {
    for (const m of [...outline, ...detail]) {
      m.pts = m.pts.map(([x, y]) => [VB.w - x, y]);
      m.cx = VB.w - m.cx;
      m.bbox = [VB.w - m.bbox[2], m.bbox[1], VB.w - m.bbox[0], m.bbox[3]];
    }
  }
  return { outline, detail, ground: [], meta: null };
}

/* ── 細節線分群（B4）───────────────────────────────────────────────── */

/**
 * iRent 版：用基準相機把「腰線」與「輪拱圓」投影到畫面，再依細節線的形心落點分三群。
 *   win   車窗帶  —— 形心在腰線（車身 1.10 m 高）之上
 *   arch  輪拱    —— 形心落在某個輪心的投影半徑內
 *   crease 車身摺線 —— 其餘
 * 每群內再依 score 由大到小排名。
 */
export function classifyIRent(detail, baseCam) {
  const wheels = wheelCenters(baseCam.az).map(({ P, k }) => {
    const c = baseCam.project(P);
    const e = baseCam.project([P[0], P[1] + CAR.archR, P[2]]);
    return c && e ? { c, r: Math.hypot(e[0] - c[0], e[1] - c[1]) * 1.15 * k } : null;
  }).filter(Boolean);

  const ring = beltRing(baseCam.az).map((P) => baseCam.project(P)).filter(Boolean);
  const beltY = (x) => {
    let best = null;
    for (const q of ring) if (Math.abs(q[0] - x) < 30 && (best === null || q[1] > best)) best = q[1];
    return best;
  };

  for (const m of detail) {
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < wheels.length; i++) {
      const d = Math.hypot(m.cx - wheels[i].c[0], m.cy - wheels[i].c[1]);
      if (d < wheels[i].r && d < nd) { nd = d; nearest = i; }
    }
    if (nearest >= 0) { m.cat = "arch"; m.wheel = nearest; }
    else {
      const by = beltY(m.cx);
      m.cat = by !== null && m.cy < by ? "win" : "crease";
    }
  }
  rankWithin(detail);
  return detail;
}

/**
 * Monk 版：沒有隨附相機參數、基準車也不同（Ford Escape），
 * 幾何分群不可靠 → 退回「線長排名 + 底部帶」這種純影像規則，並在 UI 上講明。
 */
export function classifyMonk(detail) {
  let lo = -Infinity, hi = Infinity;
  for (const m of detail) { lo = Math.max(lo, m.bbox[3]); hi = Math.min(hi, m.bbox[1]); }
  const cut = lo - (lo - hi) * 0.18;
  for (const m of detail) m.cat = m.bbox[3] >= cut ? "arch" : m.cy < (hi + lo) / 2 ? "win" : "crease";
  rankWithin(detail);
  return detail;
}

function rankWithin(detail) {
  const groups = {};
  detail.forEach((m, i) => { m.idx = i; (groups[m.cat] ||= []).push(m); });
  for (const cat of Object.keys(groups)) {
    groups[cat].sort((a, b) => b.score - a.score).forEach((m, r) => { m.rank = r; });
  }
  [...detail].sort((a, b) => b.score - a.score).forEach((m, r) => { m.gRank = r; });
}

export const TIERS = {
  all: { label: "全部", quota: null },
  medium: { label: "中等", quota: { win: 14, arch: 12, crease: 10 } },
  minimal: { label: "極簡", quota: { win: 5, arch: 6, crease: 0 }, perWheel: 2 },
};

/**
 * 回傳「這一級要顯示哪些細節線」的 Set。
 * 地面線 / 接地十字是獨立的 group，任何級別都全開，不經過這裡。
 */
export function visibleSet(detail, tier, manualN) {
  const s = new Set();
  if (tier === "manual") {
    for (const m of detail) if (m.gRank < manualN) s.add(m.idx);
    return s;
  }
  const t = TIERS[tier] || TIERS.all;
  if (!t.quota) { detail.forEach((m) => s.add(m.idx)); return s; }
  for (const m of detail) if (m.rank < (t.quota[m.cat] ?? 0)) s.add(m.idx);
  if (t.perWheel) {
    // 極簡級：確保每個輪拱至少留 perWheel 條，不然某個輪子會整個消失
    const byWheel = {};
    for (const m of detail) if (m.cat === "arch") (byWheel[m.wheel ?? 0] ||= []).push(m);
    for (const list of Object.values(byWheel)) {
      list.sort((a, b) => b.score - a.score).slice(0, t.perWheel).forEach((m) => s.add(m.idx));
    }
  }
  return s;
}

/** 目前這組相機參數對應的基準相機（給分群與 warp 用） */
export function baseCamFor(corner, meta) {
  return makeCam({
    corner,
    distance: BASE_PARAMS.distance,
    height: BASE_PARAMS.height,
    yaw: BASE_PARAMS.yaw,
    focal: BASE_PARAMS.focal,
    target: meta.target_xyz,
  });
}
