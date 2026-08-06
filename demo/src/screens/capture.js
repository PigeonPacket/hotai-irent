/**
 * Screen 1 / Screen 4 —— 四角引導拍照（PIG-13 §3 Screen 1 與 Screen 4 共用同一套 UI）。
 *
 * 路由：#/capture?phase=pickup（取車）｜#/capture?phase=return（還車）
 *
 * ── 這個畫面的幾何約定（PIG-13 §1.2，Wave 3 / Track G 回填）──────────────
 *
 * G1 **橫向 4:3，只有這個畫面**
 *    汽車 45° 全車直向要退到 4.2 m 以上，一般停車格退不到 —— 幾何限制，不是偏好。
 *    直向時給轉向提示（`screen.orientation` 為主、視窗長寬比為輔），轉回直向會再出現。
 *    提示**不阻擋操作**：所有按鈕照常可按（§1.1 非阻擋優先）。
 *
 * D2 **畫面來源絕不用 object-fit: cover**
 *    這不是整理性修正，是幾何正確性的前提：16:9 的串流被 cover 裁進 4:3 畫框後，
 *    等效焦距從 26 mm 變成 34.7 mm（+33%）—— 換算成角點偏差是 **19%**，等同「站近 0.5 m」，
 *    而手機鏡頭本身的差異（24 或 28 vs 26 mm）只有 4.4%（PIG-13 §1.2 敏感度表）。
 *    cover 不拿掉，疊圖就永遠跟影像幾何脫鉤，而且存檔照片與預覽不是同一張。
 *
 *    作法：`camera.onStream` 回報**真實串流尺寸**（video.videoWidth 為準，
 *    track.getSettings() 只當備援）→ 設 `--cam-ar` → 畫框長寬比 = 串流長寬比 →
 *    影像 contain 進去剛好填滿、零裁切。疊圖 SVG 用固定的 4:3 viewBox 疊上去，
 *    `preserveAspectRatio="xMidYMid meet"`，所以串流比 4:3 寬時輪廓落在正中央那塊 4:3
 *    區域（= 若要裁成 4:3 會留下的那一塊），左右多出來的畫面壓暗並用虛線標界。
 *
 * D5/D6 **站位提示與正向回饋**
 *    輪廓多邊形交給 quality.js 做內外邊緣密度比對（見該檔）；大致對上就整條輪廓
 *    變綠、快門顯示就緒。判定刻意寬鬆（G6）：疊圖只負責把人哄到大致正確的位置，
 *    合格與否交給拍後檢查與重拍迴圈。**站位類提示一律不進 `quality.ok`**，
 *    因為 points.js 用 ok 決定積分等第。
 */

import { CORNERS, GUIDE_CSS, getGuide } from "../guides.js";
import { createCamera } from "../camera.js";
import { STANDING_GUIDE } from "../quality.js";
import { CAPTURE_CATEGORIES, EVENTS } from "../state.js";
import { escapeHtml } from "../util.js";

export const id = "capture";
export const title = "車況拍照";

/** 跳頁列：同一個畫面兩個入口（order 見 CONTRACT.md 的流程槽位表） */
export const nav = [
  { label: "取車拍照", params: { phase: "pickup" }, order: 20 },
  { label: "還車拍照", params: { phase: "return" }, order: 50 },
];

/**
 * 疊圖畫框：**橫向 4:3**。
 * 座標單位刻意維持與 guides.js 相同（輪廓以原點為中心、約 ±120 單位），
 * 這樣 Track G 換上正式輪廓時 capture.js 不需要改（見 CONTRACT.md §8）。
 */
const GUIDE_VB = { w: 360, h: 270 };
/** 輪廓群組的原點。稍微高於正中央，替 guides.js 畫在 y=130 的副標籤留位置。 */
const GUIDE_ORIGIN = { x: 180, y: 128 };
/** 模擬相機畫布：同樣是橫向 4:3（其他畫面維持 camera.js 的直向預設） */
const MOCK_SIZE = { width: 1440, height: 1080 };
/** 沿輪廓取幾個點當多邊形。夠描出七邊形也夠描出 Track G 的曲線輪廓。 */
const GUIDE_SAMPLES = 48;

const STAND_TEXT =
  `站位：手機<b>橫向</b>、胸口高度（約 ${STANDING_GUIDE.heightM} m），` +
  `退到約 <b>${STANDING_GUIDE.steps} 步（${STANDING_GUIDE.distanceM} m）</b>外，讓全車落進虛線`;

const COPY = {
  pickup: {
    title: "取車 · 車況拍照",
    subtitle: "請依引導拍攝車身四角，建立租前存證",
    motivation: [
      { icon: "🛡️", text: "認真拍照可保護你免於還車爭議" },
      { icon: "⭐", text: "完整四角拍照 <strong>+20 積分</strong>" },
    ],
    finish: "完成取車拍照",
    next: "supplement",
  },
  return: {
    title: "還車 · 車況拍照",
    subtitle: "還車前拍照，證明你交還時車況正常",
    motivation: [
      { icon: "🛡️", text: "還車前拍照，證明你交還時車況正常" },
      { icon: "⭐", text: "完整拍照 <strong>+20 積分</strong>" },
    ],
    finish: "完成還車拍照，開始 AI 比對",
    next: "compare",
  },
};

export const css = `
${GUIDE_CSS}
.motivation {
  background: linear-gradient(135deg, #1e3a4f, #1a2332);
  border: 1px solid #2a3f55;
  border-radius: var(--radius);
  padding: 10px 12px;
  margin: 12px 0;
  font-size: 13px;
}
.motivation p {
  margin: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.motivation strong { color: var(--accent); }

.capture-stand {
  margin: 0 0 8px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text);
  background: rgba(0, 194, 168, 0.1);
  border: 1px solid rgba(0, 194, 168, 0.32);
}
.capture-stand b { color: var(--accent); }

.capture-orient-note {
  margin: 0 0 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
  color: #ffd79a;
  background: rgba(245, 166, 35, 0.14);
  border: 1px solid rgba(245, 166, 35, 0.42);
}

/* 畫框長寬比 = **串流**長寬比（--cam-ar 由 camera.onStream 寫入 .capture-stage）。
   影像用 contain 填進來 → 零裁切、預覽與存檔同一張圖。
   寬度由「可用高度 × 長寬比」反推，橫向時才不會撐破畫面。 */
.capture-stage { --cam-max-h: 52dvh; }
.camera-wrap,
.preview {
  width: min(100%, calc(var(--cam-max-h) * var(--cam-ar, 1.33333)));
  margin-inline: auto;
}
.camera-wrap {
  position: relative;
  aspect-ratio: var(--cam-ar, 1.33333);
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  border: 1px solid #2a3545;
}
.camera-view,
.camera-mock {
  width: 100%;
  height: 100%;
  /* ⚠️ 永遠不要改成 cover —— 見檔頭 D2。 */
  object-fit: contain;
  display: block;
}
.camera-view[hidden],
.camera-mock[hidden] { display: none; }

.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}
/* 4:3 疊圖區以外的畫面（串流比 4:3 寬時才會出現）：壓暗 + 虛線標界。
   它仍然會被存進照片裡，只是輪廓的幾何不涵蓋那一段，所以標出來。 */
.overlay-outside { fill: rgba(0, 0, 0, 0.34); }
.overlay-frame {
  fill: none;
  stroke: rgba(255, 255, 255, 0.34);
  stroke-width: 1;
  stroke-dasharray: 7 7;
  vector-effect: non-scaling-stroke;
}
/* 白線在白車 / 亮地面上會消失 → 加深色 halo（PIG-13 §1.2 G5）。
   non-scaling-stroke 讓線寬等於螢幕 px，不會被 viewBox 縮成次像素。 */
.overlay .guide-stroke,
.overlay .guide-fill {
  vector-effect: non-scaling-stroke;
}
.overlay-guide {
  filter: drop-shadow(0 0 2.5px rgba(0, 0, 0, 0.85));
  transition: opacity 0.2s ease;
}
/* D6 對齊正向回饋：整條輪廓變綠、細節線由虛轉實 */
.overlay.aligned .guide-stroke { stroke: #2bf07a; }
.overlay.aligned .guide-fill {
  stroke: #2bf07a;
  stroke-dasharray: none;
  opacity: 1;
}

.quality-hint {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.35;
  background: rgba(245, 166, 35, 0.92);
  color: #1a1200;
}
.quality-hint.ok {
  background: rgba(0, 194, 168, 0.9);
  color: #002820;
}
.quality-hint.info {
  background: rgba(12, 22, 32, 0.88);
  color: #dbe6f2;
  border: 1px solid rgba(0, 194, 168, 0.4);
}

.mock-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(245, 166, 35, 0.92);
  color: #1a1200;
}

/* 轉向提示：蓋在畫面上，但**不擋按鈕**（按鈕在畫框外） */
.capture-rotate {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  text-align: center;
  background: rgba(8, 12, 18, 0.86);
  backdrop-filter: blur(2px);
}
.capture-rotate-inner { max-width: 300px; }
.capture-rotate-icon {
  display: block;
  font-size: 30px;
  line-height: 1;
  margin-bottom: 8px;
  animation: capture-rotate-spin 2.4s ease-in-out infinite;
}
@keyframes capture-rotate-spin {
  0%, 60%, 100% { transform: rotate(0deg); }
  30% { transform: rotate(90deg); }
}
@media (prefers-reduced-motion: reduce) {
  .capture-rotate-icon { animation: none; }
}
.capture-rotate b { font-size: 15px; display: block; margin-bottom: 6px; }
.capture-rotate p {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted);
}
.capture-rotate .btn { min-width: 0; padding: 8px 14px; }

.preview {
  margin-top: 10px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid #2a3545;
}
.preview img {
  width: 100%;
  display: block;
  aspect-ratio: var(--cam-ar, 1.33333);
  /* 預覽必須跟存檔是同一張圖 —— 這裡用 cover 就等於在騙人 */
  object-fit: contain;
  background: #000;
}
.preview-caption {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  background: var(--surface);
  color: var(--muted);
}

.btn.ready::after { content: " ✓"; }

.capture-gallery { margin-top: 16px; }
.capture-gallery h2 { font-size: 16px; margin: 0 0 8px; }
/* 四角照片是橫向 4:3，用共用 kit 的 1:1 cover 縮圖會把左右切掉 */
.capture-gallery .thumb img {
  aspect-ratio: 4 / 3;
  object-fit: contain;
  background: #000;
}

/* ── 手機橫向：把版面攤開，畫框吃滿高度 ─────────────────────────
   只在 body.capture-active 生效 → App 其餘畫面維持 430px 直向（G1 已定案）。 */
@media (orientation: landscape) and (max-height: 600px) {
  body.capture-active .app {
    max-width: none;
    padding: 6px 12px calc(6px + var(--safe-bottom));
  }
  body.capture-active:not(.capture-done) .header,
  body.capture-active:not(.capture-done) .app-footer,
  body.capture-active:not(.capture-done) .motivation,
  body.capture-active:not(.capture-done) .capture-stand { display: none; }
  body.capture-active .capture-stage { --cam-max-h: calc(100dvh - 84px); }
  /* 簡報跳頁列是 position: fixed，上面那條 padding 覆寫會讓它壓到畫框上 */
  body.capture-active.has-demo-nav .app {
    padding-bottom: calc(62px + var(--safe-bottom));
  }
  body.capture-active.has-demo-nav .capture-stage { --cam-max-h: calc(100dvh - 140px); }
  body.capture-active:not(.capture-done) .capture-stage {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  body.capture-active:not(.capture-done) .capture-stage > .camera-wrap,
  body.capture-active:not(.capture-done) .capture-stage > .preview {
    flex: 0 1 auto;
    margin-inline: 0;
  }
  body.capture-active:not(.capture-done) .capture-stage > .actions {
    flex: 1 1 180px;
    margin-top: 0;
    align-content: flex-start;
  }
  body.capture-active:not(.capture-done) .capture-stage > .actions .btn {
    flex-basis: 100%;
    min-width: 0;
  }
}
`;

export function mount(root, ctx) {
  const { state, points, config } = ctx;
  const phase = ctx.params.phase === "return" ? "return" : "pickup";
  const group = phase; // pickup → pickupCaptures / return → returnCaptures
  const copy = COPY[phase];
  const modelId = state.session.vehicle?.modelId;

  state.setPhase(phase);
  ctx.setHeader({ title: copy.title, subtitle: copy.subtitle });
  document.body.classList.add("capture-active");

  root.innerHTML = `
    <div class="motivation" data-el="motivation">
      ${copy.motivation.map((m) => `<p><span class="icon">${m.icon}</span> ${m.text}</p>`).join("")}
    </div>

    <div class="progress">
      <div class="progress-bar" data-el="progressBar"></div>
      <ol class="steps" data-el="steps"></ol>
    </div>

    <p class="capture-stand" data-el="standHint">📏 ${STAND_TEXT}</p>
    <p class="capture-orient-note hidden" data-el="orientNote">
      ⚠ 目前是直向：全車可能拍不下（直向需退到 4.2 m 以上），建議轉為橫向
    </p>

    <div class="capture-stage" data-el="stage">
      <div class="camera-wrap" data-el="cameraWrap">
        <video class="camera-view" data-el="video" playsinline autoplay muted></video>
        <canvas class="camera-mock" data-el="mockCanvas" hidden></canvas>
        <canvas data-el="scratchCanvas" hidden></canvas>
        <svg class="overlay" data-el="overlay"
             viewBox="0 0 ${GUIDE_VB.w} ${GUIDE_VB.h}" preserveAspectRatio="xMidYMid meet">
          <g class="overlay-outside" data-el="overlayOutside">
            <rect x="-2000" y="-2000" width="2000" height="${GUIDE_VB.h + 4000}" />
            <rect x="${GUIDE_VB.w}" y="-2000" width="2000" height="${GUIDE_VB.h + 4000}" />
            <rect x="-2000" y="-2000" width="${GUIDE_VB.w + 4000}" height="2000" />
            <rect x="-2000" y="${GUIDE_VB.h}" width="${GUIDE_VB.w + 4000}" height="2000" />
          </g>
          <rect class="overlay-frame" x="0.5" y="0.5"
                width="${GUIDE_VB.w - 1}" height="${GUIDE_VB.h - 1}" />
          <g class="overlay-guide" data-el="guideGroup"
             transform="translate(${GUIDE_ORIGIN.x}, ${GUIDE_ORIGIN.y})"></g>
          <!-- y 壓在 50：再高就會被左上角的「模擬相機」徽章蓋到 -->
          <text class="guide-label" data-el="guideLabel"
                x="${GUIDE_VB.w / 2}" y="50" text-anchor="middle"></text>
        </svg>
        <div class="quality-hint hidden" data-el="qualityHint"></div>
        <div class="mock-badge hidden" data-el="mockBadge">模擬相機</div>
        <div class="capture-rotate hidden" data-el="rotateHint">
          <div class="capture-rotate-inner">
            <span class="capture-rotate-icon">📱</span>
            <b>請把手機轉成橫向</b>
            <p>汽車 45° 全車需要<strong>橫向 4:3</strong>。直向要退到 4.2 m 以上才拍得下全車，
              一般停車格退不到。</p>
            <button type="button" class="btn secondary small" data-el="btnRotateDismiss">
              仍以直向繼續
            </button>
          </div>
        </div>
      </div>

      <div class="preview hidden" data-el="preview">
        <img data-el="previewImg" alt="預覽" />
        <p class="preview-caption" data-el="previewCaption"></p>
      </div>

      <div class="actions" data-el="actions">
        <button type="button" class="btn secondary" data-el="btnSkip">先繼續（積分較少）</button>
        <button type="button" class="btn primary" data-el="btnCapture">拍攝</button>
        <button type="button" class="btn primary hidden" data-el="btnRetake">重拍這張</button>
        <button type="button" class="btn primary hidden" data-el="btnNext">確認，下一角</button>
      </div>
    </div>

    <div class="capture-gallery hidden" data-el="gallery">
      <h2>已完成照片</h2>
      <div class="thumbs" data-el="thumbs"></div>
      <div class="actions">
        <button type="button" class="btn primary full" data-el="btnFinish">${escapeHtml(copy.finish)}</button>
        <button type="button" class="btn secondary" data-el="btnRedo">重新拍攝這一段</button>
      </div>
    </div>
  `;

  const els = {};
  root.querySelectorAll("[data-el]").forEach((node) => {
    els[node.dataset.el] = node;
  });

  const local = {
    step: state.getCaptures(group).length,
    pending: null,
    busy: false,
    done: false,
    rotateDismissed: false,
    /** 引導輪廓多邊形，正規化到**整張串流**的 0–1 座標 */
    polygon: null,
    /** 輪廓外接框（同座標系），mock 佔位圖用它把假車體畫在對的位置 */
    guideBox: null,
    alignStreak: 0,
    aligned: false,
    orientTimer: null,
  };

  // ------------------------------------------------------------- 幾何

  /**
   * 讀出目前輪廓在畫面上的位置，換算成「整張串流」的正規化座標。
   *
   * 為什麼可以直接拿畫框的 bounding rect 當分母：畫框的長寬比已經被設成串流的長寬比
   * （--cam-ar），影像 contain 進去剛好填滿、沒有黑邊 —— 所以
   * 「畫框內的相對位置」== 「串流內的相對位置」。這是 D2 換掉 cover 之後才成立的等式，
   * 用 cover 的話畫框只看得到串流的一部分，這裡就會安靜地算錯。
   *
   * 座標轉換走 getScreenCTM()，不自己乘 translate —— 這樣 Track G 之後在輪廓
   * markup 裡加任何 transform 都還是對的。
   */
  function readGuideGeometry() {
    const path = els.guideGroup.querySelector(".guide-stroke");
    if (!path || typeof path.getTotalLength !== "function") return null;
    const rect = els.cameraWrap.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    let len = 0;
    try {
      len = path.getTotalLength();
    } catch {
      return null;
    }
    if (!(len > 0)) return null;
    const ctm = path.getScreenCTM();
    if (!ctm) return null;

    const polygon = [];
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < GUIDE_SAMPLES; i++) {
      const p = path.getPointAtLength((i / GUIDE_SAMPLES) * len).matrixTransform(ctm);
      const nx = (p.x - rect.left) / rect.width;
      const ny = (p.y - rect.top) / rect.height;
      polygon.push([nx, ny]);
      if (nx < minX) minX = nx;
      if (ny < minY) minY = ny;
      if (nx > maxX) maxX = nx;
      if (ny > maxY) maxY = ny;
    }
    if (!(maxX > minX) || !(maxY > minY)) return null;
    return { polygon, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  }

  function boxChanged(a, b) {
    if (!a || !b) return true;
    return (
      Math.abs(a.x - b.x) > 0.005 ||
      Math.abs(a.y - b.y) > 0.005 ||
      Math.abs(a.w - b.w) > 0.005 ||
      Math.abs(a.h - b.h) > 0.005
    );
  }

  function refreshGuideGeometry() {
    if (local.done) return;
    const geo = readGuideGeometry();
    if (!geo) return;
    local.polygon = geo.polygon;
    if (boxChanged(local.guideBox, geo.box)) {
      local.guideBox = geo.box;
      // 模擬相機據此把假車體畫進輪廓裡，mock 模式才演得出「站對 → 變綠」
      const corner = CORNERS[Math.min(local.step, CORNERS.length - 1)];
      camera.setCorner(corner.id, corner.label, { guideBox: geo.box });
    }
  }

  /** 畫框長寬比一律跟著**真實串流尺寸**走（見檔頭 D2） */
  function applyStreamSize(size) {
    if (!size?.width || !size?.height) return;
    const ar = size.width / size.height;
    // 設在 stage 上，畫框與預覽一起吃到同一個長寬比
    els.stage.style.setProperty("--cam-ar", ar.toFixed(5));
    // 長寬比一變，疊圖在串流上的位置就變了 —— 重新量一次
    requestAnimationFrame(refreshGuideGeometry);
  }

  // ------------------------------------------------------------- 方向

  /**
   * 這支手機**本身**是不是直向。
   * 桌機瀏覽器的 screen.orientation.type 恆為 landscape-*，所以把視窗拉窄
   * 不會誤觸「請轉橫向」—— 桌機根本轉不了，提示只會變成雜訊。
   * @returns {boolean|null} null = 無從判斷，只能退回看視窗長寬比
   */
  function isDevicePortrait() {
    const type = globalThis.screen?.orientation?.type;
    if (type) return type.startsWith("portrait");
    if (typeof window.orientation === "number") return Math.abs(window.orientation) % 180 === 0;
    return null;
  }

  function shouldPromptRotate() {
    const viewportPortrait = window.innerHeight > window.innerWidth;
    const device = isDevicePortrait();
    return device === null ? viewportPortrait : device && viewportPortrait;
  }

  function syncOrientation() {
    const portrait = shouldPromptRotate();
    // 轉回橫向就把「仍以直向繼續」清掉 → 再轉回直向時提示會重新出現
    if (!portrait) local.rotateDismissed = false;
    const showOverlay = portrait && !local.rotateDismissed && !local.done;
    els.rotateHint.classList.toggle("hidden", !showOverlay);
    els.orientNote.classList.toggle("hidden", !(portrait && local.rotateDismissed && !local.done));
    refreshGuideGeometry();
  }

  function onViewportChange() {
    syncOrientation();
    // orientationchange 當下版面還沒穩定，晚一點再量一次（guide-lab 同樣的處理）
    clearTimeout(local.orientTimer);
    local.orientTimer = setTimeout(syncOrientation, 280);
  }

  // ------------------------------------------------------------- UI

  els.steps.innerHTML = CORNERS.map(
    (c, i) => `<li data-step="${i}">${escapeHtml(c.label)}</li>`
  ).join("");

  /**
   * D6：大致對上就變綠。刻意不對稱 —— 一次判定就轉綠，連兩次不對才熄掉。
   * 目的是給正向回饋，不是做嚴格幾何判定（G6）。
   */
  function applyAlignment(aligned) {
    if (aligned === true) local.alignStreak = Math.min(2, Math.max(1, local.alignStreak + 1));
    else if (aligned === false) local.alignStreak = Math.max(-2, local.alignStreak - 1);
    else local.alignStreak = 0;

    if (local.alignStreak >= 1) local.aligned = true;
    else if (local.alignStreak <= -2 || local.alignStreak === 0) local.aligned = false;

    els.overlay.classList.toggle("aligned", local.aligned);
    els.btnCapture.classList.toggle("ready", local.aligned);
  }

  function showQualityHint(result) {
    els.qualityHint.classList.remove("hidden", "ok", "info");
    const hints = result.hints || [];
    if (!result.ok) {
      // 品質警告優先，站位建議附在後面（兩者是不同層級的事）
      els.qualityHint.textContent = "⚠ " + [...result.issues, ...hints].join("；");
    } else if (hints.length) {
      els.qualityHint.classList.add("info");
      els.qualityHint.textContent = "↔ " + hints.join("；");
    } else {
      els.qualityHint.classList.add("ok");
      els.qualityHint.textContent = "✓ 光線與清晰度良好，可以拍攝";
    }
    applyAlignment(result.aligned);
  }

  function updateUI() {
    const done = local.step >= CORNERS.length;
    const pct = (Math.min(local.step, CORNERS.length) / CORNERS.length) * 100;
    els.progressBar.style.setProperty("--pct", `${pct}%`);

    [...els.steps.children].forEach((li, i) => {
      li.classList.toggle("active", i === local.step);
      li.classList.toggle("done", i < local.step);
    });

    if (done) {
      showGallery();
      return;
    }

    const corner = CORNERS[local.step];
    els.guideLabel.textContent = `${local.step + 1}/${CORNERS.length} · ${corner.label}`;
    els.guideGroup.innerHTML = getGuide(modelId, corner.id).svg;
    els.previewCaption.textContent = corner.hint;

    // 換角度 = 換輪廓 → 重新量一次多邊形。
    // getScreenCTM() 會強制同步 layout，所以這裡量得到，不必等下一格；
    // 先量完再 setCorner，模擬畫面才只重畫一次。
    local.guideBox = null;
    local.alignStreak = 0;
    applyAlignment(null);
    const geo = readGuideGeometry();
    if (geo) {
      local.polygon = geo.polygon;
      local.guideBox = geo.box;
    }
    camera.setCorner(corner.id, corner.label, { guideBox: local.guideBox });
    // 剛 mount / 剛轉向時版面還沒穩定，readGuideGeometry() 會回 null → 晚一格補量
    requestAnimationFrame(refreshGuideGeometry);
  }

  function showGallery() {
    const captures = state.getCaptures(group);
    local.done = true;
    document.body.classList.add("capture-done");
    els.cameraWrap.classList.add("hidden");
    els.preview.classList.add("hidden");
    els.actions.classList.add("hidden");
    els.motivation.classList.add("hidden");
    els.standHint.classList.add("hidden");
    els.orientNote.classList.add("hidden");
    els.gallery.classList.remove("hidden");
    els.progressBar.style.setProperty("--pct", "100%");
    camera.stop();

    const estimate = points.estimateCaptureSetPoints(phase, captures, CORNERS.length);
    ctx.setHeader({
      subtitle: `已完成 ${captures.length} 張 · 預估積分 +${estimate.points}（${estimate.label}）`,
    });

    els.thumbs.innerHTML = captures
      .map((c) => {
        const src = c.fullDataUrl || c.dataUrl;
        const badge = c.skipped ? "（跳過）" : c.quality?.ok ? " ✓" : "";
        return `
          <div class="thumb">
            ${
              src
                ? `<img src="${src}" alt="${escapeHtml(c.label)}" />`
                : `<div class="thumb-empty"></div>`
            }
            <span>${escapeHtml(c.label)}${badge}</span>
          </div>`;
      })
      .join("");
  }

  function enterPreview(dataUrl) {
    els.previewImg.src = dataUrl;
    els.preview.classList.remove("hidden");
    els.cameraWrap.classList.add("hidden");
    els.btnCapture.classList.add("hidden");
    els.btnSkip.classList.add("hidden");
    els.btnRetake.classList.remove("hidden");
    els.btnNext.classList.remove("hidden");
    els.qualityHint.classList.add("hidden");
    camera.pauseQuality();
  }

  function exitPreview() {
    local.pending = null;
    els.preview.classList.add("hidden");
    els.cameraWrap.classList.remove("hidden");
    els.btnCapture.classList.remove("hidden");
    els.btnSkip.classList.remove("hidden");
    els.btnRetake.classList.add("hidden");
    els.btnNext.classList.add("hidden");
    camera.resumeQuality();
    requestAnimationFrame(refreshGuideGeometry);
  }

  // ------------------------------------------------------------- 流程

  async function onCapture() {
    if (local.step >= CORNERS.length || local.busy) return;
    local.busy = true;
    els.btnCapture.disabled = true;
    try {
      const shot = await camera.capture();
      if (local.step >= CORNERS.length) return; // 期間已完成 → 丟棄
      local.pending = shot;
      enterPreview(shot.dataUrl);
    } finally {
      local.busy = false;
      els.btnCapture.disabled = false;
    }
  }

  async function commitCapture(skipped) {
    // 防連點 / 防在 gallery 狀態下誤觸（隱藏的按鈕仍然收得到 click）
    if (local.step >= CORNERS.length || local.busy) return;
    if (!skipped && !local.pending) return;
    const corner = CORNERS[local.step];
    local.busy = true;
    els.btnNext.disabled = true;
    els.btnSkip.disabled = true;
    try {
      const record = await state.addCapture(group, {
        angle: corner.id,
        category: CAPTURE_CATEGORIES.CORNER,
        label: corner.label,
        skipped,
        quality: skipped ? null : local.pending?.quality ?? null,
        fullDataUrl: skipped ? null : local.pending?.dataUrl ?? null,
        meta: { source: local.pending?.mode || camera.mode },
      });
      state.addEvent(
        phase === "pickup" ? EVENTS.PICKUP_CAPTURE : EVENTS.RETURN_CAPTURE,
        {
          label: `${corner.label}${skipped ? "（跳過）" : record.quality?.ok ? "（品質達標）" : "（有品質警告）"}`,
          angle: corner.id,
          photoId: record.id,
          skipped,
        }
      );
      local.step += 1;
      if (local.step >= CORNERS.length) awardSetPoints();
      exitPreview();
      updateUI();
    } finally {
      local.busy = false;
      els.btnNext.disabled = false;
      els.btnSkip.disabled = false;
    }
  }

  function awardSetPoints() {
    const captures = state.getCaptures(group);
    const { rule, qualified } = points.evaluateCaptureSet(phase, captures, CORNERS.length);
    if (rule) state.awardPoints(rule.id, { group });
    state.addEvent(phase === "pickup" ? EVENTS.PICKUP_COMPLETE : EVENTS.RETURN_COMPLETE, {
      label: qualified ? "四角拍照完整且品質達標" : "四角拍照完成（有品質警告或跳過）",
      qualified,
      count: captures.length,
    });
  }

  function onFinish() {
    if (ctx.router.isRegistered(copy.next)) {
      ctx.go(copy.next);
      return;
    }
    // Wave 2 的下一個畫面還沒實作 → 維持 PoC 的行為
    console.log("PIG-5 capture session:", {
      phase,
      captures: state.getCaptures(group),
      points: state.session.points,
      timeline: state.session.timeline,
    });
    alert(
      `${copy.title}完成（Wave 1 骨架）。\n` +
        `目前累積積分：${state.totalPoints()}\n` +
        `下一個畫面「#/${copy.next}」尚未實作，資料已輸出至 console。`
    );
  }

  function onRedo() {
    state.clearCaptures(group);
    local.step = 0;
    local.pending = null;
    local.done = false;
    local.guideBox = null;
    document.body.classList.remove("capture-done");
    els.gallery.classList.add("hidden");
    els.motivation.classList.remove("hidden");
    els.standHint.classList.remove("hidden");
    els.actions.classList.remove("hidden");
    els.cameraWrap.classList.remove("hidden");
    ctx.setHeader({ title: copy.title, subtitle: copy.subtitle });
    syncOrientation();
    startCamera();
  }

  /** 啟動相機期間先鎖住「拍攝」，避免在還沒有畫面來源時就按下去。 */
  function startCamera() {
    els.btnCapture.disabled = true;
    updateUI();
    return camera.start().then(() => {
      els.btnCapture.disabled = false;
      updateUI();
      requestAnimationFrame(refreshGuideGeometry);
    });
  }

  // ------------------------------------------------------------- 相機

  const camera = createCamera({
    video: els.video,
    mockCanvas: els.mockCanvas,
    scratchCanvas: els.scratchCanvas,
    mockSize: MOCK_SIZE,
    onQuality: showQualityHint,
    onStream: applyStreamSize,
    // 每次分析都把最新的輪廓多邊形帶進去（D5 輪廓占比 / D6 對齊判定）
    qualityOptions: () => ({ polygon: local.polygon }),
    onMode: (mode) => {
      els.mockBadge.classList.toggle("hidden", mode !== "mock");
    },
  });

  els.btnCapture.addEventListener("click", onCapture);
  els.btnRetake.addEventListener("click", exitPreview);
  els.btnNext.addEventListener("click", () => commitCapture(false));
  els.btnSkip.addEventListener("click", () => commitCapture(true));
  els.btnFinish.addEventListener("click", onFinish);
  els.btnRedo.addEventListener("click", onRedo);
  els.btnRotateDismiss.addEventListener("click", () => {
    local.rotateDismissed = true;
    syncOrientation();
  });

  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
  globalThis.screen?.orientation?.addEventListener?.("change", onViewportChange);

  ctx.setFootnote(
    (config.mock
      ? "模擬相機模式（?mock=1）。"
      : "需 HTTPS 或 localhost 才能啟用相機。") +
      "此畫面為橫向 4:3；畫面來源不裁切（contain），存檔即所見。" +
      "品質檢查為輕量啟發式，虛線輪廓為暫時版本。"
  );

  syncOrientation();

  if (local.step >= CORNERS.length) {
    showGallery();
  } else {
    startCamera();
  }

  // cleanup：關掉 MediaStream 與品質檢查 interval，收掉 document/window 上的 listener
  return () => {
    camera.stop();
    clearTimeout(local.orientTimer);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("orientationchange", onViewportChange);
    globalThis.screen?.orientation?.removeEventListener?.("change", onViewportChange);
    document.body.classList.remove("capture-active", "capture-done");
  };
}
