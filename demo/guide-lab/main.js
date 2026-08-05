/**
 * guide-lab / main.js —— UI 組裝
 *
 * 這頁只有一個目的：使用者拿手機站在真的 Corolla Cross 前面，
 * 三分鐘內決定 (1) 輪廓對不對得上、哪組相機參數 (2) 細節線要哪級 (3) 交付用哪版。
 * 所有 UI 決定都服從這個場景 —— 橫向、控制項可收、決定要能帶走。
 */

import { VB, makeCam, buildWarp, applyH, fovFromFocal } from "./geom.js";
import {
  CORNERS, IRENT, MONK, PHOTOS, BASE_PARAMS, FALLBACK_META,
  loadIRentGuide, loadMonkGuide, classifyIRent, classifyMonk,
  visibleSet, baseCamFor, TIERS,
} from "./sources.js";
import { createLabCamera, cameraApiAvailable, secureOk } from "./labcam.js";

const $ = (s, r = document) => r.querySelector(s);
const SVGNS = "http://www.w3.org/2000/svg";
const qs = new URLSearchParams(location.search);
const LS_STATE = "guideLab.state.v1";
const LS_NOTES = "guideLab.notes.v1";

const validCorner = (c) => CORNERS.some((x) => x.id === c);

const state = {
  corner: "lf",
  version: "irent",           // irent | monk
  bg: "blank",                // blank | photo | camera
  photoIdx: 0,
  monkIdx: 0,
  monkFit: false,             // true = 縮放對齊 iRent 框架（比形狀）；false = Monk 原始框架
  tier: "all",                // all | medium | minimal | manual
  manualN: 40,
  aligned: false,
  halo: true,
  horizon: true,
  cam: { ...BASE_PARAMS },
};
Object.assign(state, safeParse(lsGet(LS_STATE)) || {});
state.cam = { ...BASE_PARAMS, ...(state.cam || {}) };
if (validCorner(qs.get("corner"))) state.corner = qs.get("corner");
if (!validCorner(state.corner)) state.corner = "lf";

let report = null;            // build-report.json
let guides = {};              // cacheKey -> {outline,detail,ground}
let cur = null;               // 目前使用中的 guide
let baseCam = null;
let camCtl = null;
let notes = (() => { const n = safeParse(lsGet(LS_NOTES)); return Array.isArray(n) ? n : []; })();
let monkFitXf = null;         // Monk 縮放對齊用的 {s, tx, ty}

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
// Safari 無痕模式下 localStorage 會 throw，不能讓它擋住整頁啟動
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
const meta = (corner) => (report?.[corner]?.meta) || FALLBACK_META[corner];

/* ────────────────────────── 建立 DOM ────────────────────────── */

function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

/** render() 每個滑桿 tick 都會跑，內容沒變就別重寫 innerHTML */
function setHTML(sel, html) {
  const n = $(sel);
  if (n && n._last !== html) { n._last = html; n.innerHTML = html; }
}

function build() {
  const root = $("#app");
  root.innerHTML = `
  <div class="stage">
    <div class="frame" id="frame">
      <div class="bg blank" id="bgBlank"></div>
      <img class="bg" id="bgPhoto" alt="" hidden>
      <video class="bg" id="bgVideo" playsinline muted hidden></video>
      <canvas class="bg" id="bgMock" hidden></canvas>
      <!-- halo 與主線各自是獨立的 <g>（不用 <use> 的 shadow tree）。
           多寫一次 d 的成本很低，換掉「某些瀏覽器下 <use> 不更新 → 整個疊圖空白」的風險。 -->
      <svg class="ov" id="ov" viewBox="0 0 ${VB.w} ${VB.h}" preserveAspectRatio="xMidYMid meet"
           xmlns="${SVGNS}" aria-hidden="true">
        <line id="glHorizon" x1="0" x2="${VB.w}" y1="0" y2="0" vector-effect="non-scaling-stroke"></line>
        <g id="h-detail"  class="halo detail"></g>
        <g id="h-ground"  class="halo ground"></g>
        <g id="h-outline" class="halo outline"></g>
        <g id="m-detail"  class="main detail"></g>
        <g id="m-ground"  class="main ground"></g>
        <g id="m-outline" class="main outline"></g>
      </svg>
      <div class="hud hud-tl">
        <div class="stand" id="stand"></div>
        <div class="lic" id="lic"></div>
      </div>
      <div class="hud hud-bl" id="warn"></div>
      <div class="loading" id="loading" hidden>載入中…</div>
    </div>

    <nav class="tabs" id="tabs" aria-label="車輛角度"></nav>
    <button class="drawer-btn" id="drawerBtn" aria-expanded="true">面板</button>
  </div>

  <aside class="drawer open" id="drawer">
    <div class="drawer-in">
      <section>
        <h2>交付版本 <span class="hint">B5</span></h2>
        <div class="seg" id="verSeg"></div>
        <div class="licbox" id="licBox"></div>
        <div class="sub" id="monkBox" hidden>
          <label class="row"><span>Monk 來源</span><select id="monkSel"></select></label>
          <label class="row check"><input type="checkbox" id="monkFit"><span>縮放對齊 iRent 框架（只比形狀）</span></label>
          <div class="fine">Monk 只有 3 個 45° 角 sight（右前・右後・左後），<b>沒有左前</b>；第四張是
            <code>beauty-shot-left</code> 左側全景，不是角度照。左前預設用右前水平鏡射補上（車體左右對稱，幾何等價）。</div>
          <div class="fine">Monk 原始疊圖填滿畫面約 93% 寬，iRent 版只有 80% —— 兩者<b>框架本來就不同</b>，
            直接疊看到的差異有一部分是框架差異不是形狀差異。要比形狀請勾上面那格。</div>
          <div class="fine">Monk 沒有隨附相機參數、基準車也不同（Ford Escape 4.60 m），
            相機滑桿套在它身上是<b>更粗的近似</b>，只能看趨勢。</div>
        </div>
      </section>

      <section>
        <h2>背景 <span class="hint">B2</span></h2>
        <div class="seg" id="bgSeg"></div>
        <label class="row" id="photoRow"><span>照片</span><select id="photoSel"></select></label>
        <div class="note" id="bgNote"></div>
      </section>

      <section>
        <h2>相機參數 <span class="hint">B3</span></h2>
        <div id="sliders"></div>
        <div class="readout" id="readout"></div>
        <button class="ghost" id="resetCam">回到基準（3.85 m / 1.5 m / 45° / 26 mm）</button>
        <details class="sens">
          <summary>拉滑桿時輪廓是「怎麼」重算的（先看這個再下結論）</summary>
          <p>SVG 只有 2D 點、沒有逐點深度，瀏覽器裡沒有 3D 模型可用（GLB 38 MB，會違反零依賴）。
             所以這裡是<b>近似重投影</b>：拿車輛外接框（接地點實測校準過）當代理，
             在基準相機與目前相機各投影一次，解一個單應性矩陣，再套到 SVG 的每個點。</p>
          <p>性質：基準值時<b>完全恆等</b>（誤差 0.0000 px，已驗）；<b>焦距是精確的</b>（純 FOV 變化）；
             距離與相機高只有一階近似；<b>偏擺最弱</b> —— 2D 變換本質上無法把 3D 物體轉過去。</p>
          <p class="fine">實測（車形代理實體對照）：偏擺 ±15° 平均差 16 px、距離 ±0.65 m 差 6 px、
             相機高 ±0.4 m 差 5.7 px（皆為 500 寬 viewBox 上的 px）。上方的「重投影近似誤差」就是照這組係數即時估的。</p>
        </details>
        <details class="sens">
          <summary>站位敏感度 —— 為什麼要「往後退」</summary>
          <table>
            <tr><td>站太近 2.5 m</td><td class="bad">角點偏差 85%</td></tr>
            <tr><td>站太遠 3.8 m</td><td class="good">11%</td></tr>
            <tr><td>相機高 1.3 vs 1.5 m</td><td class="good">11%</td></tr>
            <tr><td>鏡頭 24 vs 26 mm</td><td class="good">8%</td></tr>
          </table>
          <p><b>太近的代價是太遠的八倍。</b>拿不準的時候，退一步。</p>
          <p class="fine">上表為既有分析結論。畫面上的即時讀數是本頁自算的「外接框角點平均位移 ÷ 車寬」，定義不同，看趨勢即可。</p>
        </details>
      </section>

      <section>
        <h2>細節線密度 <span class="hint">B4</span></h2>
        <div class="seg" id="tierSeg"></div>
        <label class="row" id="manualRow" hidden>
          <span>前 N 條</span><input type="range" id="manualN" min="0" max="130" step="1">
          <output id="manualOut"></output>
        </label>
        <div class="note" id="tierNote"></div>
      </section>

      <section>
        <h2>線條 <span class="hint">B6</span></h2>
        <button class="big" id="alignBtn"></button>
        <label class="row check"><input type="checkbox" id="haloChk"><span>白線加深色 halo</span></label>
        <label class="row check"><input type="checkbox" id="horizonChk"><span>畫地平線（= 相機高度）</span></label>
      </section>

      <section>
        <h2>記下目前設定</h2>
        <input id="verdict" placeholder="一句話結論，例：3.6m/1.55m 對得上，中等密度夠用">
        <button class="big primary" id="noteBtn">記下目前設定並複製 JSON</button>
        <div class="note" id="noteStatus"></div>
        <div class="row2">
          <button class="ghost" id="copyAll">複製全部 (<span id="noteCount">0</span>)</button>
          <button class="ghost" id="clearNotes">清空</button>
        </div>
        <textarea id="fallbackTa" hidden readonly rows="6"></textarea>
      </section>
    </div>
  </aside>
  <div class="toast" id="toast" hidden></div>`;
}

/* ────────────────────────── 控制項 ────────────────────────── */

function seg(host, items, get, set) {
  host.innerHTML = "";
  for (const it of items) {
    const b = el("button", "", it.label);
    b.dataset.v = it.v;
    if (it.title) b.title = it.title;
    b.setAttribute("aria-pressed", String(get() === it.v));
    b.onclick = () => { set(it.v); };
    host.appendChild(b);
  }
}
function segSync(host, get) {
  for (const b of host.children) b.setAttribute("aria-pressed", String(get() === b.dataset.v));
}

const SLIDERS = [
  { k: "distance", label: "距離", min: 3.0, max: 4.5, step: 0.05, unit: "m" },
  { k: "height", label: "相機高", min: 1.1, max: 1.8, step: 0.01, unit: "m" },
  { k: "yaw", label: "偏擺", min: 30, max: 60, step: 1, unit: "°", note: "近似最弱的一軸，離 45° 越遠形狀越不可信" },
  { k: "focal", label: "等效焦距", min: 24, max: 28, step: 0.5, unit: "mm", note: "此軸為精確解（純 FOV 變化）；相機串流不是 4:3 時也用它補償" },
];

function buildSliders() {
  const host = $("#sliders");
  host.innerHTML = "";
  for (const s of SLIDERS) {
    const row = el("label", "row slider");
    row.innerHTML = `<span>${s.label}</span>
      <input type="range" id="sl-${s.k}" min="${s.min}" max="${s.max}" step="${s.step}">
      <output id="out-${s.k}"></output>`;
    host.appendChild(row);
    if (s.note) host.appendChild(el("div", "fine slider-note", s.note));
    const inp = $(`#sl-${s.k}`, row);
    inp.value = state.cam[s.k];
    inp.addEventListener("input", () => {
      state.cam[s.k] = +inp.value;
      render();
      persist();
    });
  }
}

function syncSliders() {
  for (const s of SLIDERS) {
    const inp = $(`#sl-${s.k}`);
    if (inp && +inp.value !== state.cam[s.k]) inp.value = state.cam[s.k];
    const o = $(`#out-${s.k}`);
    if (o) o.textContent = `${state.cam[s.k].toFixed(s.step < 0.1 ? 2 : s.step < 1 ? 2 : 0)}${s.unit}`;
  }
}

/* ────────────────────────── 疊圖繪製 ────────────────────────── */

function dOf(pts) {
  let s = "";
  for (let i = 0; i < pts.length; i++) s += (i ? "L" : "M") + pts[i][0].toFixed(2) + " " + pts[i][1].toFixed(2);
  return s;
}

const LAYERS = ["outline", "detail", "ground"];

/** 讓 halo 與主線兩組 <g> 各備妥 n 個 <path>（只在換 guide 時跑） */
function ensurePaths(layer, n) {
  for (const pre of ["h", "m"]) {
    const g = $(`#${pre}-${layer}`);
    while (g.childElementCount < n) {
      const p = document.createElementNS(SVGNS, "path");
      // 不加這個，原始 stroke-width:1 在 500 寬 viewBox 上到 390px 手機只剩 0.78px —— 次像素，看不見
      p.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(p);
    }
    while (g.childElementCount > n) g.lastElementChild.remove();
  }
}

function mountGuide() {
  if (!cur) return;
  ensurePaths("outline", cur.outline.length);
  ensurePaths("detail", cur.detail.length);
  ensurePaths("ground", cur.ground.length);
}

function paint(warp) {
  // 順序很重要：先把 Monk 對齊到 iRent 的「基準框架」，再套相機 warp。
  // 反過來的話，對齊量是拿未變形的 bbox 算的，一拉滑桿就失準。
  const xf = (p) => {
    const q = monkFitXf ? [p[0] * monkFitXf.s + monkFitXf.tx, p[1] * monkFitXf.s + monkFitXf.ty] : p;
    return applyH(warp.h, q);
  };
  const vis = visibleSet(cur.detail, state.tier, state.manualN);
  const sets = { outline: cur.outline, detail: cur.detail, ground: cur.ground };
  for (const layer of LAYERS) {
    const list = sets[layer];
    const gh = $(`#h-${layer}`), gm = $(`#m-${layer}`);
    for (let i = 0; i < list.length; i++) {
      const a = gh.children[i], b = gm.children[i];
      if (!a || !b) continue;
      // 地面線／接地十字是獨立圖層，任何密度級別都全開 —— 它對相機高度最敏感，是垂直校正最有效的線索
      const show = layer !== "detail" || vis.has(list[i].idx ?? i);
      a.style.display = b.style.display = show ? "" : "none";
      if (!show) continue;
      const d = dOf(list[i].pts.map(xf));
      a.setAttribute("d", d);
      b.setAttribute("d", d);
    }
  }
}

/* Monk 原始框架比 iRent 大一圈（填滿 93% 寬 vs 80%）。
   要「比形狀」就得先把兩者的外接框對齊，否則看到的差異其實是框架差異。 */
function computeMonkFit() {
  monkFitXf = null;
  if (state.version !== "monk" || !state.monkFit || !cur) return;
  const ref = guides[`irent:${state.corner}`];
  if (!ref) return;
  const bb = (list) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const m of list) { a = Math.min(a, m.bbox[0]); b = Math.min(b, m.bbox[1]); c = Math.max(c, m.bbox[2]); d = Math.max(d, m.bbox[3]); }
    return [a, b, c, d];
  };
  const A = bb(cur.outline.length ? cur.outline : cur.detail);
  const B = bb(ref.outline);
  if (!isFinite(A[0]) || !isFinite(B[0])) return;
  const s = Math.min((B[2] - B[0]) / (A[2] - A[0]), (B[3] - B[1]) / (A[3] - A[1]));
  monkFitXf = {
    s,
    tx: (B[0] + B[2]) / 2 - ((A[0] + A[2]) / 2) * s,
    ty: (B[1] + B[3]) / 2 - ((A[1] + A[3]) / 2) * s,
  };
}

/* ────────────────────────── 主 render ────────────────────────── */

function render() {
  const m = meta(state.corner);
  baseCam = baseCamFor(state.corner, m);
  const cam = makeCam({ corner: state.corner, ...state.cam, target: m.target_xyz });
  const warp = buildWarp(baseCam, cam);

  if (cur) { computeMonkFit(); paint(warp); }

  // 地平線 —— 相機高度在畫面上的位置，判斷手機拿太高／太低最快的線索
  const hz = $("#glHorizon");
  hz.setAttribute("y1", cam.horizonY.toFixed(2));
  hz.setAttribute("y2", cam.horizonY.toFixed(2));
  hz.style.display = state.horizon ? "" : "none";

  const ov = $("#ov");
  ov.classList.toggle("aligned", state.aligned);
  ov.classList.toggle("nohalo", !state.halo);

  syncSliders();

  const { hfov, vfov } = fovFromFocal(state.cam.focal);
  const steps = Math.round(state.cam.distance / 0.7);
  setHTML("#stand",
    `<b>${CORNERS.find((c) => c.id === state.corner).label} ${state.cam.yaw}°</b>` +
    `　退到 <b>${state.cam.distance.toFixed(2)} m</b>（約 ${steps} 步）　手機 <b>${state.cam.height.toFixed(2)} m</b> 高、橫向持機`);

  const dev = warp.dev.mean;
  const errPct = (warp.approxErrPx / VB.w) * 100;
  const trust = errPct < 1.2 ? "good" : errPct < 3 ? "warn" : "bad";
  setHTML("#readout",
    `<span>hFOV ${hfov.toFixed(1)}° / vFOV ${vfov.toFixed(1)}°</span>` +
    `<span>俯角 ${cam.depression.toFixed(1)}°</span>` +
    `<span class="${dev < 5 ? "good" : dev < 15 ? "warn" : "bad"}">離基準 ${dev.toFixed(1)}%（角點平均位移÷車寬）</span>` +
    `<span class="${trust}">重投影近似誤差 ≈ ${errPct.toFixed(1)}% 畫面寬</span>`);

  const warns = [];
  if (state.cam.distance < 3.5) warns.push("⚠ 站太近 —— 角點誤差成長最快的方向，先退一步");
  if (state.cam.distance > 4.2) warns.push("一般停車格可能退不到這麼遠");
  if (Math.abs(state.cam.height - 1.5) > 0.18) warns.push("機高偏離胸口高度，注意接地點的垂直位置");
  // 這頁只有 45° 的真實渲圖，其餘角度是 2D 近似 —— 偏太多就不能拿來下結論
  if (errPct >= 3) warns.push("⚠ 偏離基準太多，疊圖形狀已不可信（主因是偏擺）。要下結論請先把偏擺拉回 45° 附近");
  setHTML("#warn", warns.map((w) => `<div>${w}</div>`).join(""));

  updateTierNote();
  updateLicence();
  persist();
}

function updateTierNote() {
  if (!cur) return;
  const vis = visibleSet(cur.detail, state.tier, state.manualN);
  const tot = cur.detail.length;
  const byCat = { win: 0, arch: 0, crease: 0 };
  for (const m of cur.detail) if (vis.has(m.idx)) byCat[m.cat] = (byCat[m.cat] || 0) + 1;
  let src = state.version === "monk"
    ? "Monk 版分群是純影像規則（線長排名 + 底部帶），沒有相機參數可用，僅供概略比較。"
    : "分群依基準相機投影出的腰線與輪拱圓判定，屬啟發式；不準時改用「手動」。";
  // Monk 的 overlay 本來就是產品用的引導疊圖，不是邊緣偵測倒出來的 —— 它天生就很稀疏。
  // 這件事本身就是一個交付判斷點，值得直接講出來。
  if (state.version === "monk" && tot <= 30) {
    src += `<br><b>Monk 版總共只有 ${tot} 條細節線</b>（iRent 版 130 條），密度分級對它幾乎沒有作用 ——
            它本來就已經是「產品級的極簡」。這點本身就是交付選版的依據之一。`;
  }
  setHTML("#tierNote",
    `顯示 <b>${vis.size}</b> / ${tot} 條　（車窗帶 ${byCat.win}・輪拱 ${byCat.arch}・摺線 ${byCat.crease}）` +
    `<br>地面線與接地十字 ${cur.ground.length} 條 —— <b>任何級別都全開</b>，它對相機高度最敏感。` +
    `<br><span class="fine">${src}</span>`);
  $("#manualOut").textContent = state.manualN;
}

function updateLicence() {
  const v = state.version === "monk" ? MONK : IRENT;
  const pick = currentMonkEntry();
  let extra = "";
  if (state.version === "monk" && pick) {
    const tag = { native: "原生 sight", mirrored: "鏡射自右前", gap: "無此角度", "not-a-corner": "非 45° 角，不可用於對位" }[pick.origin];
    extra = `<div class="origin ${pick.origin}">此角度來源：<b>${pick.sight || "—"}</b>（${tag}）</div>`;
  }
  setHTML("#licBox",
    `<div class="badge ${v.licenceLevel}">${v.licence}</div>` +
    `<div class="fine">${v.vehicle}</div>${extra}<div class="fine">${v.licenceNote}</div>`);
  setHTML("#lic", `<span class="badge ${v.licenceLevel}">${v.name}・${v.licenceLevel === "ok" ? "可交付" : "不可散布"}</span>`);
}

function currentMonkEntry() {
  const list = MONK.sources[state.corner] || [];
  return list[Math.min(state.monkIdx, list.length - 1)] || null;
}

/* ────────────────────────── 載入 guide ────────────────────────── */

async function loadCurrent() {
  const loading = $("#loading");
  loading.hidden = false;
  loading.textContent = "載入輪廓…";
  try {
    // iRent 版一定要載（Monk 的「縮放對齊」需要它當參照框）
    const ik = `irent:${state.corner}`;
    if (!guides[ik]) {
      const g = await loadIRentGuide(state.corner);
      classifyIRent(g.detail, baseCamFor(state.corner, meta(state.corner)));
      guides[ik] = g;
    }
    if (state.version === "irent") {
      cur = guides[ik];
    } else {
      const e = currentMonkEntry();
      if (!e || e.origin === "gap" || !e.id) { cur = { outline: [], detail: [], ground: [] }; }
      else {
        const mk = `monk:${e.id}:${e.mirror ? "m" : "n"}`;
        if (!guides[mk]) {
          const g = await loadMonkGuide(e);
          classifyMonk(g.detail);
          guides[mk] = g;
        }
        cur = guides[mk];
      }
    }
    // 只調滑桿上限，不改 state.manualN —— 換到細節線較少的版本再換回來時，原本的值才不會被吃掉
    const nDetail = Math.max(1, cur.detail.length);
    $("#manualN").max = String(nDetail);
    $("#manualN").value = String(Math.min(state.manualN, nDetail));
    mountGuide();
    loading.hidden = true;
    if (state.version === "monk" && currentMonkEntry()?.origin === "gap") {
      loading.hidden = false;
      loading.innerHTML = "此角度 <b>無 Monk 原生基準</b><br><span class=\"fine\">Monk 只有 3 個 45° 角 sight，缺 front-lateral-full-left</span>";
    }
  } catch (err) {
    console.error(err);
    cur = null;
    loading.hidden = false;
    loading.innerHTML = `輪廓載入失敗<br><span class="fine">${String(err.message || err)}</span>` +
      `<br><span class="fine">iRent 輪廓在 demo/assets/car-reference/（已 gitignore），此機器上可能沒有這批檔案。</span>`;
  }
  render();
}

/* ────────────────────────── 背景 ────────────────────────── */

function photoList() { return PHOTOS[state.corner] || []; }

function applyBackground() {
  const blank = $("#bgBlank"), img = $("#bgPhoto"), vid = $("#bgVideo"), mock = $("#bgMock");
  blank.hidden = state.bg !== "blank";
  img.hidden = state.bg !== "photo";
  const camOn = state.bg === "camera";
  $("#photoRow").hidden = state.bg !== "photo";

  if (!camOn) { camCtl?.stop(); vid.hidden = true; mock.hidden = true; }

  if (state.bg === "photo") {
    const list = photoList();
    const p = list[Math.min(state.photoIdx, list.length - 1)];
    if (p) {
      img.src = p.src;
      img.onerror = () => { $("#bgNote").innerHTML = `<span class="bad">載不到 ${p.src}</span>（car-reference/ 已 gitignore）`; };
      $("#bgNote").innerHTML = p.kind === "render"
        ? `<b>3D 渲圖</b>：透視與輪廓完全一致 → 判斷「輪廓抽得準不準」用這張。${p.note ? "<br>" + p.note : ""}`
        : `<b class="bad">CC BY-SA 4.0</b>（${p.by}）—— 只能當比對背景，<b>不可描邊產生輪廓</b>（ShareAlike 會感染衍生 SVG）。<br>${p.note || ""}`;
    }
  } else if (state.bg === "blank") {
    $("#bgNote").innerHTML = "空白框一半亮一半暗：白線的 halo 在亮地面上還讀不讀得到，看右半邊。";
  } else {
    $("#bgNote").innerHTML = secureOk
      ? "相機需 HTTPS 或 localhost。串流不是 4:3 時會被裁切，左右視野變窄 → 用焦距滑桿補償。"
      : `<span class="bad">目前不是 HTTPS / localhost</span>，瀏覽器不會給相機，已自動降級成模擬畫面。`;
    camCtl.start({ mock: qs.get("mock") === "1" }).then((r) => {
      const s = r.settings;
      if (r.mode === "live" && s?.width) {
        const ar = s.width / s.height;
        $("#bgNote").innerHTML += `<br>串流 ${s.width}×${s.height}（${ar.toFixed(2)}:1）` +
          (Math.abs(ar - 4 / 3) < 0.05 ? " <span class=\"good\">✓ 4:3</span>" : " <span class=\"warn\">⚠ 非 4:3，畫面已裁切</span>");
      }
    });
  }
}

/* ────────────────────────── 記下設定 ────────────────────────── */

function snapshot() {
  const m = meta(state.corner);
  const cam = makeCam({ corner: state.corner, ...state.cam, target: m.target_xyz });
  const warp = buildWarp(baseCamFor(state.corner, m), cam);
  const vis = cur ? visibleSet(cur.detail, state.tier, state.manualN) : new Set();
  const mk = currentMonkEntry();
  const p = photoList()[state.photoIdx];
  return {
    recordedAt: new Date().toISOString(),
    verdict: $("#verdict").value.trim() || null,
    corner: state.corner,
    version: state.version,
    camera: {
      distance_m: +state.cam.distance.toFixed(2),
      height_m: +state.cam.height.toFixed(2),
      yaw_deg: state.cam.yaw,
      azimuth_deg: +cam.az.toFixed(1),
      focal_equiv_mm: state.cam.focal,
      hfov_deg: +cam.hfov.toFixed(2),
      vfov_deg: +cam.vfov.toFixed(2),
      depression_deg: +cam.depression.toFixed(2),
      eye_xyz: cam.eye.map((v) => +v.toFixed(3)),
      target_xyz: m.target_xyz,
    },
    baseline: { ...BASE_PARAMS },
    delta_from_baseline: {
      distance_m: +(state.cam.distance - BASE_PARAMS.distance).toFixed(2),
      height_m: +(state.cam.height - BASE_PARAMS.height).toFixed(2),
      yaw_deg: state.cam.yaw - BASE_PARAMS.yaw,
      focal_equiv_mm: state.cam.focal - BASE_PARAMS.focal,
      corner_dev_pct_mean: +warp.dev.mean.toFixed(1),
      corner_dev_pct_max: +warp.dev.max.toFixed(1),
      reprojection: {
        method: "homography-from-bbox-proxy",
        approx_error_pct_of_frame_width: +((warp.approxErrPx / VB.w) * 100).toFixed(2),
        exact_at_baseline: true,
        exact_for_focal: true,
        weakest_axis: "yaw",
      },
    },
    detail: {
      tier: state.tier,
      tier_label: state.tier === "manual" ? `手動 前 ${state.manualN} 條` : TIERS[state.tier].label,
      manual_top_n: state.tier === "manual" ? state.manualN : null,
      visible_detail_paths: vis.size,
      total_detail_paths: cur?.detail.length ?? 0,
      ground_paths_always_on: cur?.ground.length ?? 0,
    },
    monk_source: state.version === "monk" && mk
      ? { sight_id: mk.id, sight: mk.sight, origin: mk.origin, fitted_to_irent_bbox: state.monkFit }
      : null,
    style: { aligned: state.aligned, halo: state.halo, horizon: state.horizon, outline_stroke_px: 3, detail_stroke_px: 1.5 },
    background: state.bg === "photo" ? { mode: "photo", src: p?.src ?? null, licence: p?.kind === "render" ? "internal-render" : "CC BY-SA 4.0" }
      : { mode: state.bg, camera_mode: camCtl?.mode ?? null },
    licence: state.version === "monk"
      ? { status: "BSD-3-Clause-Clear", deliverable: true, note: "保留 assets/guides/monk/LICENSE 與 NOTICE.md；Clear 版不授予專利權" }
      : { status: "unverified", deliverable: false, note: "3D Warehouse 模型衍生，內部驗證用，不可散布" },
    env: { ua: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio },
  };
}

async function copyText(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch {
    const ta = $("#fallbackTa");
    ta.hidden = false;
    ta.value = txt;
    ta.focus(); ta.select();
    try { return document.execCommand("copy"); } catch { return false; }
  }
}

function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ────────────────────────── 綁定 ────────────────────────── */

// render() 每個滑桿 tick 都會呼叫 → 節流，別在拖曳時每幀寫一次 localStorage
let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch { /* 隱私模式 */ }
  }, 250);
}
function persistNotes() {
  try { localStorage.setItem(LS_NOTES, JSON.stringify(notes)); } catch { /* ignore */ }
  $("#noteCount").textContent = String(notes.length);
}

function wire() {
  seg($("#tabs"), CORNERS.map((c) => ({ v: c.id, label: c.label, title: c.en })),
    () => state.corner,
    (v) => { state.corner = v; state.photoIdx = 0; state.monkIdx = 0; segSync($("#tabs"), () => state.corner); refreshSelects(); loadCurrent(); applyBackground(); });

  seg($("#verSeg"), [{ v: "irent", label: "iRent 專屬" }, { v: "monk", label: "Monk BSD" }],
    () => state.version,
    (v) => { state.version = v; segSync($("#verSeg"), () => state.version); $("#monkBox").hidden = v !== "monk"; loadCurrent(); });

  seg($("#bgSeg"), [{ v: "blank", label: "空白框" }, { v: "photo", label: "參考照片" }, { v: "camera", label: "即時相機" }],
    () => state.bg,
    (v) => { state.bg = v; segSync($("#bgSeg"), () => state.bg); applyBackground(); persist(); });

  seg($("#tierSeg"), [{ v: "all", label: "全部" }, { v: "medium", label: "中等" }, { v: "minimal", label: "極簡" }, { v: "manual", label: "手動" }],
    () => state.tier,
    (v) => { state.tier = v; segSync($("#tierSeg"), () => state.tier); $("#manualRow").hidden = v !== "manual"; render(); });

  $("#monkSel").onchange = (e) => { state.monkIdx = +e.target.value; loadCurrent(); };
  $("#monkFit").onchange = (e) => { state.monkFit = e.target.checked; render(); };
  $("#photoSel").onchange = (e) => { state.photoIdx = +e.target.value; applyBackground(); persist(); };
  $("#manualN").oninput = (e) => { state.manualN = +e.target.value; render(); };
  $("#haloChk").onchange = (e) => { state.halo = e.target.checked; render(); };
  $("#horizonChk").onchange = (e) => { state.horizon = e.target.checked; render(); };
  $("#resetCam").onclick = () => { state.cam = { ...BASE_PARAMS }; render(); };

  $("#alignBtn").onclick = () => {
    state.aligned = !state.aligned;
    $("#alignBtn").textContent = state.aligned ? "✓ 已對準（全實線・綠）— 再按取消" : "對準了 → 全部轉實線變綠";
    $("#alignBtn").classList.toggle("on", state.aligned);
    render();
  };

  $("#drawerBtn").onclick = () => {
    const d = $("#drawer");
    const open = d.classList.toggle("open");
    $("#drawerBtn").setAttribute("aria-expanded", String(open));
  };

  $("#noteBtn").onclick = async () => {
    notes.push(snapshot());
    persistNotes();
    const ok = await copyText(JSON.stringify(notes, null, 2));
    $("#noteStatus").innerHTML = ok
      ? `已記下第 ${notes.length} 筆，<b>全部 ${notes.length} 筆已複製到剪貼簿</b>。`
      : `已記下第 ${notes.length} 筆。剪貼簿被擋 → 請從下方文字框手動複製。`;
    toast(ok ? `已複製 ${notes.length} 筆設定` : "已記下，請手動複製");
  };
  $("#copyAll").onclick = async () => {
    if (!notes.length) return toast("還沒有記下任何設定");
    const ok = await copyText(JSON.stringify(notes, null, 2));
    toast(ok ? `已複製 ${notes.length} 筆` : "剪貼簿被擋，請從文字框複製");
  };
  $("#clearNotes").onclick = () => {
    if (!notes.length || !confirm(`確定清空 ${notes.length} 筆記錄？`)) return;
    notes = []; persistNotes(); $("#fallbackTa").hidden = true; $("#noteStatus").textContent = "";
  };

  addEventListener("orientationchange", () => setTimeout(render, 300));
}

function refreshSelects() {
  const ps = $("#photoSel");
  ps.innerHTML = "";
  photoList().forEach((p, i) => ps.appendChild(new Option(p.label, String(i), false, i === state.photoIdx)));
  const ms = $("#monkSel");
  ms.innerHTML = "";
  (MONK.sources[state.corner] || []).forEach((e, i) => ms.appendChild(new Option(e.label, String(i), false, i === state.monkIdx)));
}

/* ────────────────────────── 啟動 ────────────────────────── */

async function boot() {
  build();
  buildSliders();
  wire();
  refreshSelects();

  $("#monkFit").checked = state.monkFit;
  $("#haloChk").checked = state.halo;
  $("#horizonChk").checked = state.horizon;
  $("#monkBox").hidden = state.version !== "monk";
  $("#manualRow").hidden = state.tier !== "manual";
  $("#manualN").value = String(state.manualN);
  $("#alignBtn").textContent = state.aligned ? "✓ 已對準（全實線・綠）— 再按取消" : "對準了 → 全部轉實線變綠";
  $("#alignBtn").classList.toggle("on", state.aligned);
  persistNotes();

  camCtl = createLabCamera($("#bgVideo"), $("#bgMock"), (mode, info) => {
    if (mode === "mock") toast(`模擬相機：${info.reasonText || info.reason}`);
  });
  if (!cameraApiAvailable || !secureOk) {
    // 讓使用者一眼知道相機會降級，不用等點下去才發現
    $("#bgSeg")?.querySelector('[data-v="camera"]')?.setAttribute("data-degraded", "1");
  }

  try {
    const r = await fetch("assets/car-reference/generated/build-report.json", { cache: "no-cache" });
    if (r.ok) report = await r.json();
  } catch { /* 用 FALLBACK_META */ }

  await loadCurrent();
  applyBackground();
}

boot();
