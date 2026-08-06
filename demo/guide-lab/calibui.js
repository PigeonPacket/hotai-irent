/**
 * guide-lab / calibui.js —— 鏡頭視野校正的 UI（畫面上兩條線 + 抽屜面板）
 *
 * 分成獨立一支的理由：main.js 已經 700 行，而這段的職責很乾淨 ——
 * 「把畫面上的兩條線換算成串流像素，丟給 calib.js，再把結果講成人話」。
 * 計算一律在 calib.js（純函式、可離線驗算），這裡只負責 DOM 與座標換算。
 *
 * ── 這支檔案最容易寫錯的地方：座標空間 ─────────────────────────────
 *   使用者的手指在 **CSS 像素** 的畫框上拖，但公式要的是 **串流像素**。
 *   兩者在手機上差 3–4 倍（例如 CSS 360 px 顯示 1440 px 的串流）。
 *   拿 CSS 尺寸去算就會得到差 4 倍的焦距 —— 這正是這類 bug 的經典來源，
 *   所以本檔所有標線位置都存成「串流寬度的比例」，只在畫的時候才換成 CSS px。
 *
 * ── 第二個容易寫錯的地方：cover 裁切 ────────────────────────────────
 *   驗證模式的背景是 object-fit: cover，串流不是 4:3 時左右會被裁掉，
 *   使用者根本看不到被裁掉的部分，也就無法在那裡標線。
 *   所以校正模式改用 contain（完整串流 + 上下留黑），
 *   並用虛線標出「驗證模式其實只看得到這一段」。
 */

import {
  assess, syntheticEdges, frameCrop, ASSUMED_FOCAL_MM, ASSUMED_HFOV_DEG, DEFAULT_SIGMA,
} from "./calib.js";

const LS_CALIB = "guideLab.calib.v1";

/** 常見的已知寬度物件。都是「隨手就有、邊緣清楚」的東西。 */
const PRESETS = [
  { label: "A4 直放", cm: 21.0 },
  { label: "A4 橫放", cm: 29.7 },
  { label: "A3 橫放", cm: 42.0 },
  { label: "13\" 筆電", cm: 30.5 },
  { label: "室內門", cm: 80.0 },
];

const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const fmt = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : "—");

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* 隱私模式 */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }

/**
 * 讀出上次「採用」的校正結果（不需要建立整個 UI）。
 * 主頁用它在 HUD 顯示「這支手機校過了沒」—— 校正的價值就在於下次不用再做一次。
 */
export function savedCalibration() {
  try {
    const o = JSON.parse(lsGet(LS_CALIB) || "null");
    return o && o.locked && o.summary ? o.summary : null;
  } catch { return null; }
}

/**
 * @param {object} o
 * @param {HTMLElement} o.frame        .frame（4:3 畫框）
 * @param {HTMLVideoElement} o.video
 * @param {HTMLCanvasElement} o.mockCanvas
 * @param {HTMLCanvasElement} o.freezeCanvas
 * @param {HTMLElement} o.overlay      校正專用的疊層容器（畫框內）
 * @param {()=>string} o.getCamMode    'live' | 'mock' | 'idle'
 * @param {()=>object} o.getSettings   track.getSettings() 的內容（可能為 null）
 * @param {(mm:number)=>void} o.onApply 把量到的焦距套進主頁的焦距滑桿
 * @param {(r:object|null)=>void} o.onChange 校正結果變動（給 HUD 與 snapshot 用）
 * @param {number} o.baseDistanceM     基準站位
 */
export function createCalibrator({
  frame, video, mockCanvas, freezeCanvas, overlay,
  getCamMode, getSettings, onApply, onChange = () => {}, baseDistanceM = 3.85,
}) {
  const saved = (() => { try { return JSON.parse(lsGet(LS_CALIB) || "null"); } catch { return null; } })();

  const st = {
    widthCm: saved?.widthCm ?? 80,
    distanceCm: saved?.distanceCm ?? 150,
    fL: saved?.fL ?? 0.25,        // 標線位置：串流寬度的比例（不是 CSS px！）
    fR: saved?.fR ?? 0.75,
    frozen: false,
    active: false,
    locked: !!saved?.locked,      // 已按下「採用這次校正」
  };

  /* ── 疊層 ─────────────────────────────────────────────── */
  overlay.innerHTML = `
    <div class="cal-shade" data-side="l"></div>
    <div class="cal-shade" data-side="r"></div>
    <div class="cal-crop" data-side="l"></div>
    <div class="cal-crop" data-side="r"></div>
    <div class="cal-line" data-side="l"><b>左</b></div>
    <div class="cal-line" data-side="r"><b>右</b></div>
    <div class="cal-chip" id="calChip"></div>`;
  const q = (s) => overlay.querySelector(s);
  const lineL = q('.cal-line[data-side="l"]');
  const lineR = q('.cal-line[data-side="r"]');
  const shadeL = q('.cal-shade[data-side="l"]');
  const shadeR = q('.cal-shade[data-side="r"]');
  const cropL = q('.cal-crop[data-side="l"]');
  const cropR = q('.cal-crop[data-side="r"]');
  const chip = q("#calChip");

  /* ── 面板 ─────────────────────────────────────────────── */
  const section = el("section", "cal-sec");
  section.dataset.mode = "calib";
  section.innerHTML = `
    <h2>鏡頭視野校正 <span class="hint">B7</span></h2>
    <div class="note">量的是<b>這支手機的視訊串流</b>實際視野，不是相機 App 的視野（兩者常常不一樣）。
      整套輪廓假設 <b>26 mm / ${fmt(ASSUMED_HFOV_DEG, 2)}°</b>；只要差 8%，你就會把鏡頭問題誤判成輪廓錯。</div>
    <div class="cal-src" id="calSrc"></div>

    <div class="cal-step">① 拿一個<b>已知寬度</b>的東西正對鏡頭（門框、紙箱、A4、筆電），用捲尺量它到手機的距離</div>
    <div class="seg cal-presets" id="calPreset"></div>
    <label class="row"><span>物件實寬</span><input id="calW" type="number" inputmode="decimal" min="1" max="500" step="0.1"><em>cm</em></label>
    <label class="row"><span>量測距離</span><input id="calD" type="number" inputmode="decimal" min="10" max="2000" step="1"><em>cm</em></label>

    <div class="cal-step">② 把畫面上兩條線拖到物件的<b>左右外緣</b>（點畫面也會把最近的一條移過去）</div>
    <div class="row2">
      <button class="ghost" id="calFreeze">凍結畫面</button>
      <button class="ghost" id="calDemo">填 26 mm 範例</button>
    </div>
    <div class="cal-nudge">
      <div><span>左緣</span><button data-n="l:-5">−5</button><button data-n="l:-1">−1</button><button data-n="l:1">+1</button><button data-n="l:5">+5</button></div>
      <div><span>右緣</span><button data-n="r:-5">−5</button><button data-n="r:-1">−1</button><button data-n="r:1">+1</button><button data-n="r:5">+5</button></div>
    </div>
    <div class="fine">微調單位是<b>串流像素</b>，不是螢幕像素。</div>

    <div class="cal-step">③ 結果</div>
    <div id="calOut"></div>
    <button class="big primary" id="calApply" hidden></button>
    <div class="row2">
      <button class="ghost" id="calKeep" hidden>採用這次校正（記住）</button>
      <button class="ghost" id="calClear">清除校正</button>
    </div>

    <details class="sens">
      <summary>這個數字有多準？（先看這個再相信它）</summary>
      <div id="calUnc" class="fine"></div>
      <p class="fine">f = 36·D·w /(W·w_total)：對距離 D 與像素寬 w 是<b>線性</b>、對物寬 W 是反比，
        所以相對誤差可以直接拆開看，上表就是拆給你看的。三項用平方和合成（各自獨立）。</p>
      <p class="fine">沒有被算進去的誤差：<b>鏡頭桶狀變形</b>（物件越靠畫面邊緣越嚴重，會讓量到的視野偏廣）、
        物件平面沒有正對鏡頭的 cos 誤差、以及「感光元件在手機殼內哪個位置」（約 ±1 cm，已含在距離項）。
        所以這是一個<b>約略值</b>，不要當成標定資料。</p>
    </details>

    <details class="sens">
      <summary>什麼時候該用這個？</summary>
      <p><b>出門前，在室內先量一次。</b>找一道門框或桌上的 A4，一分鐘的事。
        校正值會記在這支手機上，之後到車前直接看疊圖就好。</p>
      <p><b>到了車前覺得「怎麼喬都對不上」時，再量一次。</b>拿 A4 紙貼在車門上當已知寬度就行。</p>
      <p class="fine">沒有捲尺就用 A4 的長邊（29.7 cm）接力量距離 —— 不要用步伐。
        距離的相對誤差會<b>一比一</b>變成焦距的相對誤差，步伐差 10% 就直接白做。</p>
      <p class="fine">換手機、換瀏覽器、或串流解析度變了，就要重量 —— 同一支手機不同瀏覽器給的裁切可能不一樣。</p>
    </details>`;

  const $ = (s) => section.querySelector(s);
  const inW = $("#calW"), inD = $("#calD");
  const out = $("#calOut"), srcBox = $("#calSrc"), uncBox = $("#calUnc");
  const btnApply = $("#calApply"), btnKeep = $("#calKeep"), btnFreeze = $("#calFreeze");

  inW.value = String(st.widthCm);
  inD.value = String(st.distanceCm);

  const presetHost = $("#calPreset");
  for (const p of PRESETS) {
    const b = el("button", "", `${p.label} ${p.cm}`);
    b.onclick = () => { st.widthCm = p.cm; inW.value = String(p.cm); update(); };
    presetHost.appendChild(b);
  }

  /* ── 目前的媒體來源與它的「真實像素」尺寸 ───────────────── */
  /* ⚠ 只認 videoWidth / canvas.width（真實畫格像素），永遠不用 CSS 尺寸。
     也刻意不在 mode!=='mock' 時退回 mockCanvas —— 空的 <canvas> 預設是 300×150，
     拿它當串流寬度會安靜地算出完全錯誤的焦距。寧可回報「還沒有畫面」。 */
  function media() {
    if (st.frozen && freezeCanvas.width > 0) {
      return { node: freezeCanvas, w: freezeCanvas.width, h: freezeCanvas.height, kind: "frozen" };
    }
    const mode = getCamMode?.() || "idle";
    if (mode === "live" && video.videoWidth > 0) {
      return { node: video, w: video.videoWidth, h: video.videoHeight, kind: "live" };
    }
    if (mode === "mock" && mockCanvas.width > 1) {
      return { node: mockCanvas, w: mockCanvas.width, h: mockCanvas.height, kind: "mock" };
    }
    return { node: null, w: 0, h: 0, kind: "none" };
  }

  /** 校正模式用 contain 排版：整個串流都看得到，才標得到邊緣 */
  function layout(m) {
    const r = frame.getBoundingClientRect();
    if (!m.w || !m.h || !r.width) return { ox: 0, oy: 0, s: 1, dw: r.width, dh: r.height, r };
    const s = Math.min(r.width / m.w, r.height / m.h);
    const dw = m.w * s, dh = m.h * s;
    return { ox: (r.width - dw) / 2, oy: (r.height - dh) / 2, s, dw, dh, r };
  }

  /** 明確擺放媒體元素，不依賴 object-fit 在 <canvas> 上的行為差異 */
  function placeMedia(m, L) {
    for (const n of [video, mockCanvas, freezeCanvas]) {
      if (n === m.node) {
        n.style.left = `${L.ox}px`; n.style.top = `${L.oy}px`;
        n.style.width = `${L.dw}px`; n.style.height = `${L.dh}px`;
        n.style.objectFit = "fill";
      } else {
        n.style.left = n.style.top = n.style.width = n.style.height = n.style.objectFit = "";
      }
    }
  }

  function clearMediaStyle() {
    for (const n of [video, mockCanvas, freezeCanvas]) {
      n.style.left = n.style.top = n.style.width = n.style.height = n.style.objectFit = "";
    }
  }

  /* ── 繪製 ─────────────────────────────────────────────── */
  function draw() {
    const m = media();
    const L = layout(m);
    placeMedia(m, L);
    const xOf = (f) => L.ox + f * L.dw;
    const xl = xOf(Math.min(st.fL, st.fR));
    const xr = xOf(Math.max(st.fL, st.fR));
    lineL.style.left = `${xOf(st.fL)}px`;
    lineR.style.left = `${xOf(st.fR)}px`;
    shadeL.style.left = `${L.ox}px`; shadeL.style.width = `${Math.max(0, xl - L.ox)}px`;
    shadeR.style.left = `${xr}px`; shadeR.style.width = `${Math.max(0, L.ox + L.dw - xr)}px`;

    // 驗證模式（cover）實際看得到的範圍 —— 用 calib.js 同一支 frameCrop，不另寫一份公式
    const frameAspect = L.r.height > 0 ? L.r.width / L.r.height : 4 / 3;
    const visible = m.h ? frameCrop({ streamW: m.w, streamH: m.h, frameAspect }).visibleFrac : 1;
    const show = visible < 0.995;
    cropL.hidden = cropR.hidden = !show;
    if (show) {
      cropL.style.left = `${L.ox + ((1 - visible) / 2) * L.dw}px`;
      cropR.style.left = `${L.ox + ((1 + visible) / 2) * L.dw}px`;
    }
    return { m, L, visible, frameAspect };
  }

  /* ── 換算 + 結果 ───────────────────────────────────────── */
  function compute(ctx) {
    const { m, frameAspect } = ctx;
    return assess({
      widthCm: st.widthCm,
      distanceCm: st.distanceCm,
      xL: Math.min(st.fL, st.fR) * m.w,      // ← 串流像素，不是 CSS px
      xR: Math.max(st.fL, st.fR) * m.w,
      streamW: m.w,
      streamH: m.h,
      frameAspect,
      baseDistanceM,
    });
  }

  let last = null;
  // 已「採用」的結論。刻意跟 last 分開：相機還沒暖機、或使用者正在改輸入時，
  // 畫面上會暫時算不出東西 —— 那不該把上次辛苦量到的校正值抹掉。
  let kept = saved?.locked ? saved.summary || null : null;

  function update(persistNow = true) {
    if (!st.active) return;
    const ctx = draw();
    const m = ctx.m;
    renderSource(m, ctx);

    const r = compute(ctx);
    last = r.ok ? r : null;

    if (!r.ok) {
      chip.innerHTML = "";
      out.innerHTML = `<div class="cal-verdict warn">${r.error}</div>`;
      uncBox.innerHTML = "";
      btnApply.hidden = true; btnKeep.hidden = true;
      if (persistNow) persist();
      return;
    }

    chip.innerHTML =
      `<b>${r.widthPx.toFixed(0)} px</b> / ${m.w} px　→　<b>${fmt(r.frame.focalMm, 1)} mm</b>　hFOV ${fmt(r.frame.hfovDeg, 1)}°`;

    out.innerHTML = renderResult(r, m);
    uncBox.innerHTML = renderUnc(r);

    const invalid = r.verdict.level === "invalid";
    btnApply.hidden = invalid;
    btnKeep.hidden = invalid;
    if (!invalid) {
      const f = r.suggestedSliderFocal;
      const clamped = Math.abs(f - r.frame.focalMm) > 0.05;
      btnApply.textContent = `套用 ${fmt(f, 1)} mm 到焦距滑桿${clamped ? "（已夾到滑桿上下限）" : ""}`;
      btnKeep.textContent = st.locked ? "✓ 已採用（再按取消）" : "採用這次校正（記住）";
      btnKeep.classList.toggle("on", st.locked);
    }
    if (st.locked && !invalid) { kept = summary(r); onChange(kept); }
    if (persistNow) persist();
  }

  /** 給 HUD / snapshot 用的精簡結果 */
  function summary(r) {
    return {
      measuredAt: new Date().toISOString(),
      object_width_cm: st.widthCm,
      distance_cm: st.distanceCm,
      stream_px: [r.stream.w, r.stream.h],
      object_px: +r.widthPx.toFixed(1),
      stream_hfov_deg: +r.stream.hfovDeg.toFixed(2),
      stream_focal_equiv_mm: +r.stream.focalMm.toFixed(2),
      frame_visible_frac: +r.frame.visibleFrac.toFixed(4),
      frame_hfov_deg: +r.frame.hfovDeg.toFixed(2),
      frame_focal_equiv_mm: +r.frame.focalMm.toFixed(2),
      // 焦距滑桿實際能設到的值（夾在滑桿上下限內）—— HUD 判斷「套用了沒」要比對這個，
      // 不然被夾過的值會永遠顯示「未套用」
      slider_focal_mm: +r.suggestedSliderFocal.toFixed(1),
      assumed_focal_mm: ASSUMED_FOCAL_MM,
      deviation_pct: +r.impact.focalDevPct.toFixed(2),
      uncertainty_1sigma_pct: +r.unc.pctTotal.toFixed(2),
      uncertainty_1sigma_mm: +r.unc.focalSigmaMm.toFixed(2),
      within_measurement_noise: r.withinNoise,
      suggested_distance_m: +r.impact.suggestedDistanceM.toFixed(2),
      verdict: r.verdict.level,
      verdict_text: r.verdict.headline,
      source: media().kind,
      caveats: [
        "針孔模型，未校正桶狀變形",
        "量的是 getUserMedia 串流的視野，非相機 App 拍照視野",
      ],
    };
  }

  function renderSource(m, ctx) {
    const s = getSettings?.() || null;
    const cssW = Math.round(ctx.L.r.width);
    if (m.kind === "none") {
      const html = '<span class="badge danger">還沒有畫面</span> 等相機啟動中…（非 HTTPS/localhost 時會降級成模擬畫面）';
      if (srcBox._last !== html) { srcBox._last = html; srcBox.innerHTML = html; }
      return;
    }
    const kindTag = {
      live: '<span class="badge ok">即時串流</span>',
      frozen: '<span class="badge ok">已凍結的串流畫格</span>',
      mock: '<span class="badge danger">模擬畫面</span>',
    }[m.kind];
    // CSS 顯示寬跟串流寬差 3–4 倍是常態，攤開來提醒「計算用的是右邊那個」
    let html = `${kindTag} 串流 <b>${m.w}×${m.h}</b>　CSS 顯示寬 ${cssW} px（計算一律用串流像素）`;
    // 這兩個不一致正是這類 bug 的來源 —— 直接攤開來讓使用者看到用的是哪一個
    if (m.kind !== "mock" && s?.width && (s.width !== m.w || s.height !== m.h)) {
      html += `<div class="fine warn">⚠ track.getSettings() 說 ${s.width}×${s.height}，
        但實際解碼畫格是 ${m.w}×${m.h}。<b>以 videoWidth 為準</b>（那才是你看到的像素）。</div>`;
    }
    if (m.kind === "mock") {
      html += `<div class="fine bad">這是模擬畫面，量出來的視野<b>沒有物理意義</b>。
        可以拿它練操作、或按「填 26 mm 範例」驗算公式；要真的校正請用 HTTPS/localhost 開啟真相機。</div>`;
    }
    if (ctx.visible < 0.995) {
      html += `<div class="fine warn">串流是 ${(m.w / m.h).toFixed(2)}:1，驗證模式的 4:3 畫框會裁掉左右
        ${((1 - ctx.visible) * 100).toFixed(0)}%（畫面上的橘色虛線）。疊圖只看得到虛線之間那一段。</div>`;
    }
    if (srcBox._last !== html) { srcBox._last = html; srcBox.innerHTML = html; }
  }

  /** verdict 的 level → 既有配色 class（ok 在既有 CSS 叫 good） */
  const tone = (lvl) => ({ ok: "good", warn: "warn", bad: "bad", invalid: "bad" }[lvl] || "");

  function renderResult(r, m) {
    const i = r.impact;
    const dev = i.focalDevPct;
    const wider = dev < 0;
    const rows = [
      ["串流原始", `${fmt(r.stream.focalMm, 1)} mm　hFOV ${fmt(r.stream.hfovDeg, 1)}°`, ""],
      ["4:3 畫框（疊圖看到的）", `<b>${fmt(r.frame.focalMm, 1)} mm</b>　hFOV ${fmt(r.frame.hfovDeg, 1)}°`,
        r.frame.cropped ? `串流被裁掉 ${fmt(r.frame.croppedPct, 0)}%` : "串流即畫框，未裁切"],
      ["輪廓的假設", `${ASSUMED_FOCAL_MM} mm　hFOV ${fmt(r.assumed.hfovDeg, 2)}°`, ""],
      ["偏差", `<b class="${tone(r.verdict.level)}">${dev >= 0 ? "+" : ""}${fmt(dev, 1)}%</b> ± ${fmt(r.unc.pctTotal, 1)}%（1σ）`,
        `hFOV ${i.hfovDevDeg >= 0 ? "+" : ""}${fmt(i.hfovDevDeg, 1)}°`],
    ];

    // 疊圖輪廓大約佔畫框 80% 寬（iRent 版），換成 500 寬 viewBox 上的 px 差
    const overlayPx = 0.8 * 500 * Math.abs(i.sizePct) / 100;

    let actionable = "";
    if (r.verdict.level !== "invalid") {
      actionable = `
        <div class="cal-impact">
          <div>你的${r.frame.cropped ? "鏡頭＋畫框裁切後的實際視野" : "鏡頭"}比假設<b>${wider ? "廣" : "窄"} ${fmt(Math.abs(dev), 1)}%</b>。
            站在基準 ${fmt(baseDistanceM, 2)} m 時，實車在畫面上會比輪廓<b>${wider ? "小" : "大"} ${fmt(Math.abs(i.sizePct), 1)}%</b>
            —— 疊圖上約 <b>${overlayPx.toFixed(0)} px</b>（500 寬 viewBox，輪廓約佔 80% 畫框寬估算）。</div>
          <ol>
            <li><b>建議做法：把焦距滑桿設成 ${fmt(r.frame.focalMm, 1)} mm</b>，站位維持 ${fmt(baseDistanceM, 2)} m。
              焦距那一軸是<b>精確解</b>（純 FOV 變化），改它不會引入近似誤差。</li>
            <li>不想改疊圖的話：改站 <b>${fmt(i.suggestedDistanceM, 2)} m</b>（${i.deltaDistanceM < 0 ? "往前" : "往後"} ${fmt(Math.abs(i.deltaDistanceM) * 100, 0)} cm）。
              大小會對上，但<b>透視不完全一樣</b>（走位會改變前後端的縮短程度，改焦距不會），所以這是次選。</li>
            ${r.frame.cropped ? `<li>更根本的：這段偏差主要不是鏡頭，是<b>畫框裁切</b> ——
              鏡頭本身是 ${fmt(r.stream.focalMm, 1)} mm，但 ${(r.stream.w / r.stream.h).toFixed(2)}:1 的串流被 4:3 畫框
              cover 裁掉左右 ${fmt(r.frame.croppedPct, 0)}%，等效才變成 ${fmt(r.frame.focalMm, 1)} mm。
              若能讓瀏覽器給 4:3 串流，就會回到 ${fmt(r.stream.focalMm, 1)} mm。</li>` : ""}
          </ol>
        </div>`;
    }

    const notes = [];
    if (r.plaus.level !== "ok") notes.push(`<li class="${r.plaus.level === "invalid" ? "bad" : "warn"}">${r.plaus.message}</li>`);
    for (const nq of r.quality) notes.push(`<li class="${nq.level}">${nq.text}</li>`);
    if (r.withinNoise && r.verdict.level === "ok" && Math.abs(dev) > 1) {
      notes.push(`<li class="warn">偏差 ${fmt(Math.abs(dev), 1)}% 比本次量測誤差 ${fmt(r.unc.pctTotal, 1)}% 還小 ——
        <b>不能宣稱有偏差</b>。要分辨更小的差異，就得把距離量得更準、或用更寬的物件。</li>`);
    }

    return `
      <div class="cal-verdict ${r.verdict.level}">
        <b>${r.verdict.headline}</b>
        <div>${r.verdict.advice}</div>
      </div>
      <div class="cal-big">${fmt(r.frame.focalMm, 1)} <small>mm</small>
        <span class="pm">± ${fmt(r.unc.focalSigmaMm, 2)} mm</span>
        <span class="sep">·</span> hFOV ${fmt(r.frame.hfovDeg, 1)}<small>°</small>
        <span class="pm">± ${fmt(r.unc.hfovSigmaDeg, 1)}°</span></div>
      <table class="cal-tbl">${rows.map(([a, b, c]) =>
        `<tr><td>${a}</td><td>${b}</td><td class="fine">${c}</td></tr>`).join("")}</table>
      ${actionable}
      ${notes.length ? `<ul class="cal-notes">${notes.join("")}</ul>` : ""}
      <div class="fine">物件在畫面上佔 ${(r.frac * 100).toFixed(0)}% 寬（${r.widthPx.toFixed(0)} / ${m.w} 串流 px）。</div>`;
  }

  function renderUnc(r) {
    const rows = r.unc.terms.map((t) =>
      `<tr><td>${t.label}</td><td>±${fmt(t.pct, 2)}%</td><td class="fine">±${fmt(r.frame.focalMm * t.rel, 2)} mm</td></tr>`).join("");
    return `
      <table class="cal-tbl">
        ${rows}
        <tr class="tot"><td>合成（平方和）</td><td>±${fmt(r.unc.pctTotal, 2)}%</td><td class="fine">±${fmt(r.unc.focalSigmaMm, 2)} mm</td></tr>
      </table>
      <p><b>單邊的標線多／少 5 串流 px → 焦距差 ${fmt(r.unc.per5px.mm, 2)} mm（${fmt(r.unc.per5px.pct, 2)}%）。</b>
        物件在畫面上越寬，這一項越小。</p>
      <p>假設值：標邊緣 ±${DEFAULT_SIGMA.edgePx} px／邊、距離 ±${DEFAULT_SIGMA.distanceCm} cm、物寬 ±${DEFAULT_SIGMA.widthCm} cm。
        這是「誠實的悲觀」，不是實驗室規格。</p>`;
  }

  /* ── 互動 ─────────────────────────────────────────────── */
  function xToFrac(clientX) {
    const m = media();
    const L = layout(m);
    if (!L.dw) return 0.5;
    return clamp01((clientX - L.r.left - L.ox) / L.dw);
  }

  let dragging = null;
  function onDown(e) {
    const f = xToFrac(e.clientX);
    // 點畫面 = 把最近的那條線移過來（「點兩下標左右緣」的操作也走這條路）
    dragging = Math.abs(f - st.fL) <= Math.abs(f - st.fR) ? "fL" : "fR";
    st[dragging] = f;
    try { overlay.setPointerCapture(e.pointerId); } catch { /* 某些瀏覽器會拒絕 */ }
    overlay.classList.add("dragging");
    update(false);
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    st[dragging] = xToFrac(e.clientX);
    update(false);
    e.preventDefault();
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = null;
    overlay.classList.remove("dragging");
    try { overlay.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    update();
  }
  overlay.addEventListener("pointerdown", onDown);
  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onUp);
  overlay.addEventListener("pointercancel", onUp);

  for (const b of section.querySelectorAll(".cal-nudge button")) {
    b.onclick = () => {
      const [side, d] = b.dataset.n.split(":");
      const m = media();
      if (!m.w) return;
      const k = side === "l" ? "fL" : "fR";
      st[k] = clamp01(st[k] + Number(d) / m.w);   // 一格 = 一個串流像素
      update();
    };
  }

  inW.oninput = () => { st.widthCm = parseFloat(inW.value) || 0; update(); };
  inD.oninput = () => { st.distanceCm = parseFloat(inD.value) || 0; update(); };

  btnFreeze.onclick = () => {
    if (st.frozen) {
      st.frozen = false;
      freezeCanvas.hidden = true;
      if ((getCamMode?.() || "") === "live") video.hidden = false;
      btnFreeze.textContent = "凍結畫面";
    } else {
      if ((getCamMode?.() || "") !== "live" || !video.videoWidth) return;
      freezeCanvas.width = video.videoWidth;
      freezeCanvas.height = video.videoHeight;
      freezeCanvas.getContext("2d").drawImage(video, 0, 0);
      st.frozen = true;
      video.hidden = true;
      freezeCanvas.hidden = false;
      btnFreeze.textContent = "回到即時畫面";
    }
    update();
  };

  // 純計算的自我檢查：把兩條線放到「26 mm 應該長成的樣子」，讀數必須回到 26.0 mm
  $("#calDemo").onclick = () => {
    st.widthCm = 80; st.distanceCm = 100;
    inW.value = "80"; inD.value = "100";
    const m = media();
    if (m.w) {
      // 80 cm 的物件在 100 cm 外，若鏡頭真的是 26 mm，兩緣就會落在這裡。讀數必須回到 26.0 mm。
      const e = syntheticEdges({ focalMm: ASSUMED_FOCAL_MM, widthCm: 80, distanceCm: 100, streamW: m.w });
      st.fL = clamp01(e.xL / m.w);
      st.fR = clamp01(e.xR / m.w);
    }
    update();
  };

  btnApply.onclick = () => {
    if (!last) return;
    // 套用就等於採用 —— 不然滑桿被改了、HUD 卻說「未校正」，那更容易誤導
    st.locked = true;
    kept = summary(last);
    onChange(kept);
    persist();
    onApply(last.suggestedSliderFocal);
  };
  btnKeep.onclick = () => {
    st.locked = !st.locked;
    if (!st.locked) { kept = null; onChange(null); }
    update();
  };
  $("#calClear").onclick = () => {
    st.locked = false;
    kept = null;
    st.widthCm = 80; st.distanceCm = 150; st.fL = 0.25; st.fR = 0.75;
    inW.value = "80"; inD.value = "150";
    lsDel(LS_CALIB);
    onChange(null);
    update();
  };

  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      lsSet(LS_CALIB, JSON.stringify({
        widthCm: st.widthCm, distanceCm: st.distanceCm, fL: st.fL, fR: st.fR, locked: st.locked,
        // 存下結論本身，這樣下次開頁不用進校正模式也知道「這支手機校過了沒」
        summary: st.locked ? kept : null,
      }));
    }, 250);
  }

  /* ── 對外 ─────────────────────────────────────────────── */
  return {
    section,
    get result() { return kept; },
    activate() {
      st.active = true;
      overlay.hidden = false;
      frame.classList.add("calibrating");
      update();
      // 相機剛啟動時 videoWidth 還是 0，重畫幾次比綁 loadedmetadata 更省事也更耐用
      for (const t of [120, 400, 1000]) setTimeout(() => { if (st.active) update(false); }, t);
    },
    deactivate() {
      st.active = false;
      st.frozen = false;
      freezeCanvas.hidden = true;
      overlay.hidden = true;
      frame.classList.remove("calibrating");
      btnFreeze.textContent = "凍結畫面";
      clearMediaStyle();
    },
    refresh() { if (st.active) update(false); },
  };
}
