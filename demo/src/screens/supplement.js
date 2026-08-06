/**
 * Screen 2 —— 開鎖後補拍窗口（PIG-13 §3 Screen 2、實測 notes/260702.md 第 3 點）
 *
 * 為什麼要有這個畫面
 *   實測發現：車內（要開鎖才進得去）的髒污/異味、以及取車時拍不清的車身角度，
 *   在現行流程裡完全沒有補救管道。這裡提供「解鎖後 15 分鐘」的補拍窗口，
 *   補拍照片**併入租前基準**（標記「補拍」+ 時間戳），逾時只能走客服通報（非正式存證鏈）。
 *
 * 時間壓縮（簡報只有 3 分鐘）
 *   倒數一律走 config.js 的 demoMinutesToMs / msToDemoMinutes / formatDemoCountdown。
 *   ?speed=fast 時 15 個 demo 分鐘 = 15 真實秒，但畫面文案仍是 15:00 → 0:00。
 *   截止時間以**絕對時間戳**存在 flags.supplementDeadline，所以切走再切回來、
 *   甚至重新整理，倒數都不會被重算或加速（只有一個 interval，cleanup 會清掉）。
 *
 * Owner: Wave 2 · Track B（flags.unlockedAt / flags.supplementDeadline / flags.supplementClosed）
 */

import { CORNERS, GUIDE_CSS, getGuide } from "../guides.js";
import { createCamera } from "../camera.js";
import { CAPTURE_CATEGORIES, EVENTS } from "../state.js";
import { demoMinutesToMs, msToDemoMinutes, formatDemoCountdown } from "../config.js";
import { escapeHtml, formatTime } from "../util.js";
import { VEHICLE_STATUS, setVehicleStatus } from "./inuse.js";

export const id = "supplement";
export const title = "補拍窗口";
export const subtitle = "15 分鐘內可補充租前存證";

/** 跳頁列槽位見 CONTRACT.md §5。 */
export const nav = [{ label: "補拍窗口", params: {}, order: 30 }];

/** 窗口長度（demo 分鐘）。PIG-13 寫 15–30 分鐘，這裡取下限 15 以對齊 §5 積分文案。 */
export const WINDOW_MINUTES = 15;

/** 倒數進入警示 / 危險的門檻（demo 分鐘）。 */
const WARN_AT_MINUTES = 5;
const DANGER_AT_MINUTES = 1;

/** 補拍照片統一寫在 meta 上的標記（Track C/D 可用 meta.stage 過濾）。 */
const SUPPLEMENT_TAG = "補拍";

/**
 * 四類補拍（PIG-13 §3 Screen 2 的表格）。
 * required = 該類型「拍齊」所需張數；拍齊任一類型即視為完整補拍（+10）。
 */
const SUPPLEMENT_TYPES = [
  {
    id: "interior",
    icon: "🧼",
    label: "車內整潔",
    hint: "開鎖後才能拍到的車內狀況",
    category: CAPTURE_CATEGORIES.INTERIOR,
    required: 3,
    shots: [
      { id: "front", label: "前座", hint: "駕駛座 / 副駕 / 中控台" },
      { id: "rear", label: "後座", hint: "座椅與腳踏墊" },
      { id: "trunk", label: "置物空間", hint: "後車廂或置物箱" },
    ],
  },
  {
    id: "odor",
    icon: "🚮",
    label: "異味或垃圾",
    hint: "菸味、食物味、前一位遺留的垃圾",
    category: CAPTURE_CATEGORIES.INTERIOR,
    required: 2,
    shots: [
      { id: "closeup", label: "特寫", hint: "對準垃圾或污漬來源" },
      { id: "wide", label: "廣角", hint: "拍出它在車內的位置" },
    ],
  },
  {
    id: "corner",
    icon: "🔁",
    label: "取車時拍不清的車身",
    hint: "重拍某一角（光線不足、距離太近）",
    category: CAPTURE_CATEGORIES.CORNER,
    required: 1,
    /** shots 由 guides.js 的 CORNERS 產生，並帶 angle → mock 相機會換素材、畫輪廓 */
    shots: CORNERS.map((c) => ({ id: c.id, label: c.label, hint: c.hint, angle: c.id })),
  },
  {
    id: "damage",
    icon: "⚠️",
    label: "新發現損傷",
    hint: "取車時沒注意到的刮痕、凹痕",
    category: CAPTURE_CATEGORIES.DAMAGE,
    required: 2,
    shots: [
      { id: "closeup", label: "損傷特寫", hint: "靠近拍清楚傷痕本身" },
      { id: "wide", label: "定位廣角", hint: "拍出傷痕在車上哪個位置" },
    ],
  },
];

const typeById = (tid) => SUPPLEMENT_TYPES.find((t) => t.id === tid) || null;

export const css = `
${GUIDE_CSS}

/* ---------------------------------------------------------------- 倒數 */
.sup-timer {
  background: linear-gradient(135deg, #14323a, #1a2332);
  border: 1px solid rgba(0, 194, 168, 0.45);
  border-radius: var(--radius);
  padding: 12px;
  margin: 12px 0;
}
.sup-timer.is-warn { border-color: rgba(245, 166, 35, 0.55); }
.sup-timer.is-danger,
.sup-timer.is-closed { border-color: rgba(255, 107, 107, 0.55); }
.sup-timer-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.sup-timer-label {
  font-size: 12px;
  color: var(--muted);
  flex: 1 1 auto;
  min-width: 0;
}
.sup-clock {
  font-size: clamp(30px, 11vw, 42px);
  font-weight: 700;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: var(--accent);
  flex: 0 0 auto;
}
.sup-timer.is-warn .sup-clock { color: var(--warn); }
.sup-timer.is-danger .sup-clock,
.sup-timer.is-closed .sup-clock { color: var(--danger); }
.sup-timer .progress-bar { margin: 10px 0 6px; }
.sup-timer-foot {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.45;
  margin: 0;
}
.sup-fast {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(245, 166, 35, 0.18);
  color: var(--warn);
}

/* ---------------------------------------------------------------- 類型清單 */
.sup-types {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sup-type {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  text-align: left;
  font-family: inherit;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px 12px;
  cursor: pointer;
}
.sup-type:disabled { opacity: 0.45; cursor: default; }
.sup-type.is-done { border-color: rgba(0, 194, 168, 0.5); }
.sup-type-icon { font-size: 20px; line-height: 1.2; flex: 0 0 auto; }
.sup-type-body { flex: 1 1 auto; min-width: 0; }
.sup-type-name { display: block; font-size: 14px; font-weight: 600; }
.sup-type-hint {
  display: block;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
  margin-top: 2px;
  overflow-wrap: anywhere;
}
.sup-type-meta { display: block; font-size: 11px; color: var(--muted); margin-top: 5px; }
.sup-type-meta b { color: var(--accent); font-weight: 600; }

/* ---------------------------------------------------------------- 補拍面板 */
.sup-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px;
  margin: 12px 0;
}
.sup-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.sup-panel-title { font-size: 15px; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.sup-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.sup-chip {
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid #3a4a5f;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.sup-chip.is-active { border-color: var(--accent); color: var(--accent); background: rgba(0, 194, 168, 0.12); }
.sup-chip.is-done { color: #6dd4c7; border-color: rgba(0, 194, 168, 0.4); }

.sup-cam {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  border: 1px solid var(--line);
}
.sup-cam-view,
.sup-cam-mock { width: 100%; height: 100%; object-fit: cover; display: block; }
.sup-cam-view[hidden],
.sup-cam-mock[hidden] { display: none; }
.sup-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.sup-overlay-dim { fill: rgba(0, 0, 0, 0.28); }
.sup-cam-hint {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.35;
  background: rgba(10, 16, 22, 0.72);
  color: #e7eef7;
}
.sup-quality {
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
.sup-quality.is-ok { background: rgba(0, 194, 168, 0.9); color: #002820; }
/* 放在品質提示上方，避免和上方（可能折兩行的）拍攝提示重疊 */
.sup-mock-badge {
  position: absolute;
  bottom: 48px;
  left: 8px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(245, 166, 35, 0.92);
  color: #1a1200;
}
.sup-preview { border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); }
.sup-preview img { width: 100%; display: block; aspect-ratio: 3 / 4; object-fit: cover; }
.sup-preview p { margin: 0; padding: 8px 10px; font-size: 12px; background: var(--surface-2); color: var(--muted); }

/* ---------------------------------------------------------------- 已補拍 */
.sup-gallery { margin-top: 14px; }
/* 選擇器要比 styles.css 的 .thumb span 更具體，否則會被拉到底部並吃掉底色 */
.thumb .sup-thumb-tag {
  position: absolute;
  top: 4px;
  left: 4px;
  right: auto;
  bottom: auto;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  background: rgba(0, 194, 168, 0.92);
  color: #002820;
}
.sup-ticket { width: 100%; }
.sup-ticket textarea {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
}
.sup-ticket-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
.sup-ticket-list li { margin: 2px 0; overflow-wrap: anywhere; }
`;

export function mount(root, ctx) {
  const { state, config, points } = ctx;
  const supRule = points.getRule("supplement_complete");
  const modelId = state.session.vehicle?.modelId;

  // ------------------------------------------------------------- 窗口時間
  // 起點 flags.unlockedAt 由本畫面寫入（解鎖 = 進到這一站）。
  // 截止時間存成絕對時間戳，避免重新整理 / 切換 ?speed 時被重算。
  const nowAtMount = Date.now();
  const firstOpen = !state.getFlag("unlockedAt");
  /**
   * deadline 是絕對時間戳（所以重新整理不會被重算），但它是用「開窗當下的 demo 時鐘」
   * 算出來的。簡報者若先在一般速度下走到這一站、之後才補上 ?speed=fast 重載，
   * 同一段真實時間會被換算成 900 個 demo 分鐘 → 倒數顯示「898:42」這種壞掉的數字。
   * 偵測到 speed 換過就把窗口重開一次（= 「重新開窗」按鈕的語意），倒數才會回到 15:00。
   */
  const storedSpeed = state.getFlag("supplementSpeed", null);
  const speedChanged = !firstOpen && storedSpeed != null && storedSpeed !== config.speed;
  const restart = firstOpen || speedChanged;

  const unlockedAt = restart ? state.setFlag("unlockedAt", nowAtMount) : state.getFlag("unlockedAt");
  if (restart) {
    state.setFlag("supplementDeadline", nowAtMount + demoMinutesToMs(WINDOW_MINUTES));
    state.setFlag("supplementClosed", null);
  }
  if (storedSpeed !== config.speed) state.setFlag("supplementSpeed", config.speed);
  const deadline =
    state.getFlag("supplementDeadline") ||
    state.setFlag("supplementDeadline", unlockedAt + demoMinutesToMs(WINDOW_MINUTES));
  const windowMs = Math.max(1, deadline - unlockedAt);

  if (speedChanged) {
    state.addEvent(EVENTS.SUPPLEMENT_OPEN, {
      label: `補拍窗口依 demo 時鐘重新開啟（?speed=${config.speed}）`,
      windowMinutes: WINDOW_MINUTES,
      deadline: new Date(deadline).toISOString(),
      speed: config.speed,
      speedChanged: true,
    });
  }

  if (firstOpen) {
    state.addEvent(EVENTS.UNLOCK, {
      label: `車輛已解鎖 · ${state.session.vehicle?.plate ?? ""}`.trim(),
      unlockedAt: new Date(unlockedAt).toISOString(),
    });
    // §4 狀態機：待取車 --解鎖--> 租賃中
    setVehicleStatus(state, VEHICLE_STATUS.IN_USE, {
      reason: "使用者解鎖取車",
      source: "supplement:unlock",
    });
    state.addEvent(EVENTS.SUPPLEMENT_OPEN, {
      label: `補拍窗口開啟（${WINDOW_MINUTES} 分鐘）`,
      windowMinutes: WINDOW_MINUTES,
      deadline: new Date(deadline).toISOString(),
      speed: config.speed,
    });
  }

  /** 畫面本地狀態（不進 session）。 */
  const local = {
    openTypeId: null,
    shotId: null,
    pending: null,
    busy: false,
    disposed: false,
    closed: !!state.getFlag("supplementClosed") || Date.now() >= deadline,
  };

  ctx.setHeader({
    title: "開鎖後補拍窗口",
    subtitle: `補拍照片會併入租前基準（標記「${SUPPLEMENT_TAG}」與時間戳）`,
  });
  ctx.setFootnote(
    `模擬資料：本畫面不連後端。倒數走 demo 時鐘${config.speed === "fast" ? "（?speed=fast：1 秒 = 1 分鐘）" : ""}，補拍照片存在本機 session。`
  );

  root.innerHTML = `
    <section class="sup-timer" data-el="timer">
      <div class="sup-timer-top">
        <div class="sup-timer-label" data-el="timerLabel">補拍窗口剩餘時間</div>
        <div class="sup-clock" data-el="clock" role="timer" aria-live="off">--:--</div>
      </div>
      <div class="progress-bar" data-el="timerBar"></div>
      <p class="sup-timer-foot" data-el="timerFoot"></p>
      ${
        config.speed === "fast"
          ? `<span class="sup-fast">⚡ 簡報加速：1 真實秒 = 1 分鐘（倒數 15 秒跑完，文案仍為分鐘制）</span>`
          : ""
      }
    </section>

    <div data-el="openState">
      <h2 class="section-title">要補拍什麼？</h2>
      <div class="sup-types" data-el="types"></div>
      <p class="muted" data-el="threshold"></p>
    </div>

    <section class="sup-panel hidden" data-el="panel">
      <div class="sup-panel-head">
        <div class="sup-panel-title" data-el="panelTitle"></div>
        <button type="button" class="btn small secondary" data-el="btnClosePanel">關閉</button>
      </div>
      <div class="sup-chip-row" data-el="chips"></div>

      <div class="sup-cam" data-el="camWrap">
        <video class="sup-cam-view" data-el="video" playsinline autoplay muted></video>
        <canvas class="sup-cam-mock" data-el="mockCanvas" hidden></canvas>
        <canvas data-el="scratchCanvas" hidden></canvas>
        <svg class="sup-overlay" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect class="sup-overlay-dim" width="360" height="640" data-el="overlayDim" />
          <g data-el="guideGroup" transform="translate(180, 340)"></g>
        </svg>
        <div class="sup-cam-hint" data-el="camHint"></div>
        <div class="sup-quality hidden" data-el="quality"></div>
        <div class="sup-mock-badge hidden" data-el="mockBadge">模擬相機</div>
      </div>

      <div class="sup-preview hidden" data-el="preview">
        <img data-el="previewImg" alt="補拍預覽" />
        <p data-el="previewCaption"></p>
      </div>

      <div class="actions">
        <button type="button" class="btn primary" data-el="btnShoot">拍攝</button>
        <button type="button" class="btn ghost hidden" data-el="btnRetake">重拍</button>
        <button type="button" class="btn primary hidden" data-el="btnAdopt">採用，併入租前基準</button>
      </div>
    </section>

    <div class="notice hidden" data-el="closedNotice"></div>

    <section class="card hidden" data-el="ticket">
      <h2 class="section-title">客服通報（非正式存證鏈）</h2>
      <p class="muted">窗口已關閉，照片無法再併入租前基準。以下通報會記錄在時間軸，但<b>不具備</b>租前基準的證據效力，需由客服人工判斷。</p>
      <div class="sup-ticket">
        <textarea data-el="ticketNote" placeholder="例：後座有前一位遺留的垃圾與明顯菸味"></textarea>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" data-el="btnReopen">重新開窗（demo 用）</button>
        <button type="button" class="btn primary full" data-el="btnTicket">送出客服通報</button>
      </div>
      <ul class="sup-ticket-list hidden" data-el="ticketList"></ul>
    </section>

    <section class="sup-gallery" data-el="gallery">
      <h2 class="section-title">已補拍（併入租前基準）</h2>
      <div data-el="baseline" class="notice"></div>
      <div class="thumbs" data-el="thumbs"></div>
      <p class="empty hidden" data-el="galleryEmpty">還沒有補拍照片。上面選一個類型即可開始。</p>
    </section>

    <div class="actions">
      <button type="button" class="btn secondary" data-el="btnSkip">跳過補拍</button>
      <button type="button" class="btn primary full" data-el="btnNext">完成補拍，開始用車</button>
    </div>
  `;

  const els = {};
  root.querySelectorAll("[data-el]").forEach((node) => {
    els[node.dataset.el] = node;
  });

  const camera = createCamera({
    video: els.video,
    mockCanvas: els.mockCanvas,
    scratchCanvas: els.scratchCanvas,
    onQuality: (result) => {
      if (local.disposed) return;
      els.quality.classList.remove("hidden", "is-ok");
      if (result.ok) {
        els.quality.classList.add("is-ok");
        els.quality.textContent = "✓ 光線與清晰度良好";
      } else {
        els.quality.textContent = "⚠ " + result.issues.join("；");
      }
    },
    onMode: (mode) => {
      if (!local.disposed) els.mockBadge.classList.toggle("hidden", mode !== "mock");
    },
  });

  /**
   * camera.start() 是 async：如果在它 resolve 之前就 camera.stop()，
   * 它會在之後才建立品質檢查 interval → 變成收不掉的殘留 timer（切走再切回來就疊加）。
   * 這裡追蹤 in-flight 的 start，stop 時補一次 stop；用 generation 避免補的那次
   * 誤殺後來重新啟動的相機。
   */
  let camGen = 0;
  let starting = null;
  function startCamera() {
    const gen = (camGen += 1);
    starting = camera.start().finally(() => {
      if (gen === camGen) starting = null;
    });
    return starting;
  }
  function stopCamera() {
    const gen = camGen;
    const inFlight = starting;
    camera.stop();
    if (inFlight) {
      inFlight
        .then(() => {
          if (gen === camGen) camera.stop();
        })
        .catch(() => {});
    }
  }

  // ------------------------------------------------------------- 資料讀取

  /** 只算「補拍」照片（使用中回報的照片同存 supplement 群組，用 meta.stage 區隔）。 */
  function supplementPhotos() {
    return state.getCaptures("supplement").filter((p) => p.meta?.stage === "supplement");
  }

  function photoOf(typeId, shotId) {
    return (
      supplementPhotos().find((p) => p.meta?.typeId === typeId && p.meta?.shotId === shotId) || null
    );
  }

  function doneCount(type) {
    const taken = supplementPhotos().filter((p) => p.meta?.typeId === type.id);
    return new Set(taken.map((p) => p.meta?.shotId)).size;
  }

  /** 完整補拍門檻：任一類型拍齊必要張數。 */
  function completedTypes() {
    return SUPPLEMENT_TYPES.filter((t) => doneCount(t) >= t.required);
  }

  function awarded() {
    return state.session.points.awarded.some((a) => a.ruleId === "supplement_complete");
  }

  // ------------------------------------------------------------- 倒數

  function remainMs() {
    return deadline - Date.now();
  }

  function renderTimer() {
    const remain = remainMs();
    const closed = local.closed;
    const remainMinutes = msToDemoMinutes(Math.max(0, remain));
    els.clock.textContent = closed ? "0:00" : formatDemoCountdown(remain);
    els.timer.classList.toggle("is-closed", closed);
    els.timer.classList.toggle("is-danger", !closed && remainMinutes <= DANGER_AT_MINUTES);
    els.timer.classList.toggle(
      "is-warn",
      !closed && remainMinutes > DANGER_AT_MINUTES && remainMinutes <= WARN_AT_MINUTES
    );
    els.timerLabel.textContent = closed
      ? `補拍窗口已關閉（逾 ${WINDOW_MINUTES} 分鐘）`
      : "補拍窗口剩餘時間";
    const elapsedPct = closed
      ? 100
      : Math.min(100, Math.max(0, ((windowMs - remain) / windowMs) * 100));
    els.timerBar.style.setProperty("--pct", `${elapsedPct.toFixed(1)}%`);
    els.timerFoot.textContent = closed
      ? "逾時後僅能走客服通報，通報不會併入租前基準。"
      : `解鎖時間 ${formatTime(new Date(unlockedAt))} · 窗口 ${WINDOW_MINUTES} 分鐘 · 現在補拍的照片仍算租前狀況`;
  }

  /** 逾時：關閉入口、寫 flags.supplementClosed、記一筆 timeline。只會執行一次。 */
  function closeWindow() {
    if (local.closed && state.getFlag("supplementClosed")) return;
    local.closed = true;
    if (!state.getFlag("supplementClosed")) {
      state.setFlag("supplementClosed", new Date().toISOString());
      state.addEvent(EVENTS.SUPPLEMENT_EXPIRED, {
        label: `補拍窗口逾時關閉（${WINDOW_MINUTES} 分鐘）`,
        windowMinutes: WINDOW_MINUTES,
        supplementCount: supplementPhotos().length,
        completedTypes: completedTypes().map((t) => t.label),
      });
    }
    closePanel();
    renderAll();
  }

  /** demo 用：重新開一次窗口，讓簡報者可以重跑倒數（不會刪掉已拍的照片）。 */
  function reopenWindow() {
    const now = Date.now();
    state.setFlag("unlockedAt", now);
    state.setFlag("supplementDeadline", now + demoMinutesToMs(WINDOW_MINUTES));
    state.setFlag("supplementSpeed", config.speed);
    state.setFlag("supplementClosed", null);
    state.addEvent(EVENTS.SUPPLEMENT_OPEN, {
      label: `補拍窗口重新開啟（demo 操作 · ${WINDOW_MINUTES} 分鐘）`,
      demoOnly: true,
    });
    // 重新 mount 是最乾淨的做法：deadline / windowMs 都是 mount 時的閉包常數
    ctx.go(id);
  }

  // ------------------------------------------------------------- 渲染

  function renderTypes() {
    els.types.innerHTML = SUPPLEMENT_TYPES.map((type) => {
      const done = doneCount(type);
      const full = done >= type.required;
      return `
        <button type="button" class="sup-type${full ? " is-done" : ""}"
          data-type="${type.id}" ${local.closed ? "disabled" : ""}>
          <span class="sup-type-icon" aria-hidden="true">${type.icon}</span>
          <span class="sup-type-body">
            <span class="sup-type-name">${escapeHtml(type.label)}${full ? " ✓" : ""}</span>
            <span class="sup-type-hint">${escapeHtml(type.hint)}</span>
            <span class="sup-type-meta">已補拍 <b>${done}/${type.required}</b>
              ${type.shots.length > type.required ? `（共 ${type.shots.length} 個選項，任 ${type.required} 個即算完整）` : ""}
            </span>
          </span>
        </button>`;
    }).join("");
  }

  function renderThreshold() {
    const doneList = completedTypes();
    els.threshold.innerHTML = awarded()
      ? `✓ 已取得「${escapeHtml(supRule?.label ?? "完整補拍")}」<b>+${supRule?.points ?? 10}</b> 積分（完成：${doneList
          .map((t) => escapeHtml(t.label))
          .join("、")}）`
      : `完整補拍門檻：任一類型拍齊必要張數 → <b>+${supRule?.points ?? 10}</b> 積分（PIG-13 §5，可與取車分數疊加）`;
  }

  /** 只換 notice 的色調，不動 hidden 等其他 class（直接指定 className 會把 hidden 洗掉）。 */
  function setNoticeTone(node, tone) {
    node.classList.remove("ok", "warn", "danger");
    if (tone) node.classList.add(tone);
  }

  function renderBaseline() {
    const pickup = state.getCaptures("pickup").length;
    const sup = supplementPhotos().length;
    setNoticeTone(els.baseline, sup > 0 ? "ok" : null);
    els.baseline.innerHTML =
      sup > 0
        ? `租前基準 = 取車 ${pickup} 張 + 補拍 <b>${sup}</b> 張。補拍照片已標記「${SUPPLEMENT_TAG}」與時間戳，還車比對時會一起當基準。`
        : `租前基準目前只有取車 ${pickup} 張。車內狀況要開鎖後才拍得到 —— 現在補拍還算租前。`;
  }

  function renderGallery() {
    const photos = supplementPhotos();
    els.galleryEmpty.classList.toggle("hidden", photos.length > 0);
    els.thumbs.innerHTML = photos
      .map((p) => {
        const src = p.fullDataUrl || p.dataUrl;
        return `
          <div class="thumb">
            ${
              src
                ? `<img src="${src}" alt="${escapeHtml(p.label)}" />`
                : `<div class="thumb-empty"></div>`
            }
            <span class="sup-thumb-tag">${SUPPLEMENT_TAG} ${formatTime(p.at)}</span>
            <span>${escapeHtml(p.label.replace(`${SUPPLEMENT_TAG} · `, ""))}</span>
          </div>`;
      })
      .join("");
  }

  function renderClosedState() {
    els.openState.classList.toggle("hidden", local.closed);
    els.ticket.classList.toggle("hidden", !local.closed);
    els.closedNotice.classList.toggle("hidden", !local.closed);
    if (local.closed) {
      const sup = supplementPhotos().length;
      setNoticeTone(els.closedNotice, "danger");
      els.closedNotice.innerHTML = `🔒 補拍窗口已關閉（解鎖後 ${WINDOW_MINUTES} 分鐘）。新的車況問題<b>僅能走客服通報</b>，屬非正式存證鏈；窗口內已補拍的 ${sup} 張仍保留在租前基準。`;
    }
    renderTicketList();
  }

  function renderTicketList() {
    const tickets = state.session.reports.filter((r) => r.type === "support_ticket");
    els.ticketList.classList.toggle("hidden", tickets.length === 0);
    els.ticketList.innerHTML = tickets
      .map(
        (t) =>
          `<li>${formatTime(t.at)} · ${escapeHtml(t.note || "（未填寫說明）")} <span class="badge warn">非正式存證</span></li>`
      )
      .join("");
  }

  function renderAll() {
    renderTimer();
    renderTypes();
    renderThreshold();
    renderBaseline();
    renderGallery();
    renderClosedState();
  }

  // ------------------------------------------------------------- 補拍面板

  function currentType() {
    return typeById(local.openTypeId);
  }

  function currentShot() {
    const type = currentType();
    if (!type) return null;
    return type.shots.find((s) => s.id === local.shotId) || type.shots[0];
  }

  async function openPanel(typeId) {
    if (local.closed) return;
    const type = typeById(typeId);
    if (!type) return;
    local.openTypeId = typeId;
    // 預設選第一個還沒拍的
    local.shotId = (type.shots.find((s) => !photoOf(type.id, s.id)) || type.shots[0]).id;
    local.pending = null;
    els.panel.classList.remove("hidden");
    els.panelTitle.textContent = `${type.icon} ${type.label}`;
    // ⚠️ 先同步鎖住「拍攝」再 await：否則相機還沒起來就按得下去（按了也拍不到東西）
    els.btnShoot.disabled = true;
    exitPreview();
    renderChips();
    await applyShot();
    await startCamera();
    if (local.disposed || local.openTypeId !== typeId) return;
    els.btnShoot.disabled = false;
    els.panel.scrollIntoView({ block: "nearest" });
  }

  function closePanel() {
    local.openTypeId = null;
    local.pending = null;
    els.panel.classList.add("hidden");
    els.quality.classList.add("hidden");
    stopCamera();
  }

  function renderChips() {
    const type = currentType();
    if (!type) return;
    els.chips.innerHTML = type.shots
      .map((shot) => {
        const done = !!photoOf(type.id, shot.id);
        const active = shot.id === local.shotId;
        return `<button type="button" class="sup-chip${active ? " is-active" : ""}${done ? " is-done" : ""}"
          data-shot="${shot.id}">${done ? "✓ " : ""}${escapeHtml(shot.label)}</button>`;
      })
      .join("");
  }

  /** 切換目標：換 mock 素材 / 輪廓引導 / 提示文案。 */
  async function applyShot() {
    const type = currentType();
    const shot = currentShot();
    if (!type || !shot) return;
    const isCorner = !!shot.angle;
    els.guideGroup.innerHTML = isCorner ? getGuide(modelId, shot.angle).svg : "";
    els.overlayDim.style.display = isCorner ? "" : "none";
    els.camHint.textContent = `${type.label}｜${shot.label} · ${shot.hint}`;
    els.previewCaption.textContent = `${type.label}｜${shot.label}`;
    await camera.setCorner(shot.angle ?? null, `${SUPPLEMENT_TAG} · ${shot.label}`);
  }

  function enterPreview(dataUrl) {
    els.previewImg.src = dataUrl;
    els.preview.classList.remove("hidden");
    els.camWrap.classList.add("hidden");
    els.btnShoot.classList.add("hidden");
    els.btnRetake.classList.remove("hidden");
    els.btnAdopt.classList.remove("hidden");
    camera.pauseQuality();
  }

  function exitPreview() {
    local.pending = null;
    els.preview.classList.add("hidden");
    els.camWrap.classList.remove("hidden");
    els.btnShoot.classList.remove("hidden");
    els.btnRetake.classList.add("hidden");
    els.btnAdopt.classList.add("hidden");
    camera.resumeQuality();
  }

  async function onShoot() {
    if (local.busy || local.closed || !currentType() || camera.mode === "idle") return;
    local.busy = true;
    els.btnShoot.disabled = true;
    try {
      const shot = await camera.capture();
      if (local.disposed || local.closed) return;
      local.pending = shot;
      enterPreview(shot.dataUrl);
    } finally {
      local.busy = false;
      els.btnShoot.disabled = false;
    }
  }

  /** 採用 → 寫進 supplementCaptures（併入租前基準）+ timeline。 */
  async function onAdopt() {
    const type = currentType();
    const shot = currentShot();
    if (local.busy || local.closed || !type || !shot || !local.pending) return;
    local.busy = true;
    els.btnAdopt.disabled = true;
    try {
      // 同一個目標重拍 → 換掉舊的那張（存證鏈以最後採用的為準）
      const existing = photoOf(type.id, shot.id);
      if (existing) state.removeCapture("supplement", existing.id);

      const offsetDemoMinutes = Number(msToDemoMinutes(Date.now() - unlockedAt).toFixed(1));
      const supersedes = shot.angle ? state.findCapture("pickup", shot.angle) : null;

      const record = await state.addCapture("supplement", {
        angle: shot.angle ?? null,
        category: type.category,
        label: `${SUPPLEMENT_TAG} · ${type.label}｜${shot.label}`,
        quality: local.pending.quality ?? null,
        fullDataUrl: local.pending.dataUrl,
        note: `${SUPPLEMENT_TAG}（併入租前基準）`,
        meta: {
          stage: "supplement",
          tag: SUPPLEMENT_TAG,
          typeId: type.id,
          shotId: shot.id,
          mergedInto: "pickup-baseline",
          unlockOffsetDemoMinutes: offsetDemoMinutes,
          supersedesPhotoId: supersedes?.id ?? null,
          source: local.pending.mode,
        },
      });

      state.addEvent(EVENTS.SUPPLEMENT_CAPTURE, {
        label: `${SUPPLEMENT_TAG}：${type.label}｜${shot.label}（開鎖後 ${offsetDemoMinutes} 分）`,
        tag: SUPPLEMENT_TAG,
        photoId: record.id,
        capturedAt: record.at,
        typeId: type.id,
        shotId: shot.id,
        angle: shot.angle ?? null,
        mergedInto: "pickup-baseline",
        unlockOffsetDemoMinutes: offsetDemoMinutes,
        supersedesPhotoId: supersedes?.id ?? null,
      });

      maybeAward(type);
      if (local.disposed) return;

      // 自動跳到下一個還沒拍的目標，沒有就留在原地
      const next = type.shots.find((s) => !photoOf(type.id, s.id));
      if (next) local.shotId = next.id;
      exitPreview();
      renderChips();
      await applyShot();
      renderAll();
    } finally {
      local.busy = false;
      els.btnAdopt.disabled = false;
    }
  }

  /** 拍齊任一類型 → +10（逾時不給）。 */
  function maybeAward(type) {
    if (local.closed || doneCount(type) < type.required || awarded()) return;
    state.awardPoints("supplement_complete", {
      typeId: type.id,
      typeLabel: type.label,
      shots: doneCount(type),
      withinDemoMinutes: Number(msToDemoMinutes(Date.now() - unlockedAt).toFixed(1)),
    });
    state.addEvent(EVENTS.SUPPLEMENT_COMPLETE, {
      label: `補拍完成：${type.label}（${doneCount(type)}/${type.required}）`,
      typeId: type.id,
      photoCount: supplementPhotos().length,
    });
  }

  // ------------------------------------------------------------- 客服通報

  function onTicket() {
    const note = els.ticketNote.value.trim();
    state.addReport({
      type: "support_ticket",
      typeLabel: "客服通報（逾時補拍）",
      note: note || "（未填寫說明）",
      photoIds: [],
      formal: false,
      channel: "客服",
      reason: "補拍窗口已逾時",
    });
    els.ticketNote.value = "";
    renderTicketList();
    setNoticeTone(els.closedNotice, "warn");
    els.closedNotice.innerHTML = `已送出客服通報，記錄在時間軸但<b>不併入租前基準</b>（非正式存證鏈）。這正是為什麼補拍要在 ${WINDOW_MINUTES} 分鐘內完成。`;
  }

  // ------------------------------------------------------------- 導航

  function goNext() {
    if (ctx.router.isRegistered("inuse")) ctx.go("inuse");
    else alert("下一站「#/inuse」尚未實作。");
  }

  // ------------------------------------------------------------- 事件綁定
  // 全部掛在 root 底下（router 清空 root 時自動失效，不需要在 cleanup 解除）

  els.types.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]");
    if (btn) openPanel(btn.dataset.type);
  });
  els.chips.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-shot]");
    if (!btn) return;
    local.shotId = btn.dataset.shot;
    exitPreview();
    renderChips();
    await applyShot();
  });
  els.btnClosePanel.addEventListener("click", closePanel);
  els.btnShoot.addEventListener("click", onShoot);
  els.btnRetake.addEventListener("click", exitPreview);
  els.btnAdopt.addEventListener("click", onAdopt);
  els.btnTicket.addEventListener("click", onTicket);
  els.btnReopen.addEventListener("click", reopenWindow);
  els.btnNext.addEventListener("click", goNext);
  els.btnSkip.addEventListener("click", goNext);

  // ------------------------------------------------------------- 倒數 interval
  // ⚠️ 只有這一個 interval，cleanup 一定要清掉（切走再切回來不會疊加）。

  renderAll();
  if (local.closed) closeWindow(); // 補寫 flags.supplementClosed（例如重新整理後才發現逾時）

  const timer = setInterval(() => {
    if (local.disposed) return;
    if (local.closed) return; // 已關閉就不必再更新
    renderTimer();
    if (remainMs() <= 0) closeWindow();
  }, 500);

  return () => {
    local.disposed = true;
    clearInterval(timer);
    stopCamera();
  };
}
