/**
 * Screen 3 —— 使用中（被動）+ 隨時回報車況異常
 * （PIG-13 §3 Screen 3、§4 營運狀態機、實測 notes/260702.md 第 4 點「車損回報不夠即時」）
 *
 * 劇本
 *   使用中不需要任何操作 → 使用者發現異常 → 回報（選類型 / 說明 / 精簡拍照）
 *   → **模擬** AI 初判 → **即時**寫入 flags.vehicleStatus → #/ops 立刻看到「不建議出租」。
 *   這就是實測第 4 點要解的問題：下一位使用者不用到現場才發現車有問題。
 *
 * ⚠️ 所有 AI 初判結果都是**寫死的模擬資料**，畫面上有標示，不連任何後端。
 *
 * Owner: Wave 2 · Track B
 *   本檔也是 flags.vehicleStatus 的**寫入端**（狀態值定義見下方 VEHICLE_STATUS）。
 *   Track A 的 vehicle.js / ops.js 是讀取端；建檔時若已有自己的常數，
 *   請以 PIG-13 §4 的中文字面值為準（與 state.js 的 MOCK_VEHICLE.status = "待取車" 一致）。
 */

import { createCamera } from "../camera.js";
import { CAPTURE_CATEGORIES, EVENTS } from "../state.js";
import { msToDemoMinutes, formatDemoCountdown } from "../config.js";
import { escapeHtml, formatTime } from "../util.js";

export const id = "inuse";
export const title = "使用中";
export const subtitle = "行程進行中 · 可隨時回報車況異常";

export const nav = [{ label: "使用中回報", params: {}, order: 40 }];

/**
 * 營運狀態機的狀態值（PIG-13 §4，中文字面值即為 flags.vehicleStatus 的值）。
 * ⚠️ 這是跨 track 的共用契約：Track A 的 vehicle.js / ops.js 讀 flags.vehicleStatus。
 */
export const VEHICLE_STATUS = Object.freeze({
  AVAILABLE: "可租",
  RESERVED: "待取車",
  IN_USE: "租賃中",
  AI_REVIEW: "AI審核中",
  MANUAL: "待人工",
  NOT_RECOMMENDED: "不建議出租",
  MAINTENANCE: "維修中",
});

/** 狀態 → 共用 kit 的 badge 樣式。 */
export function statusBadgeClass(status) {
  switch (status) {
    case VEHICLE_STATUS.AVAILABLE:
    case VEHICLE_STATUS.IN_USE:
      return "badge ok";
    case VEHICLE_STATUS.AI_REVIEW:
    case VEHICLE_STATUS.MANUAL:
      return "badge warn";
    case VEHICLE_STATUS.NOT_RECOMMENDED:
    case VEHICLE_STATUS.MAINTENANCE:
      return "badge danger";
    default:
      return "badge";
  }
}

export function currentVehicleStatus(state) {
  return (
    state.getFlag("vehicleStatus") || state.session.vehicle?.status || VEHICLE_STATUS.AVAILABLE
  );
}

/**
 * 寫入車輛狀態（唯一入口）。
 * - flags.vehicleStatus = 權威欄位（CONTRACT §4）
 * - session.vehicle.status 同步鏡射，讓直接讀車輛物件的畫面也一致
 * - 一律留一筆 EVENTS.VEHICLE_STATUS 到 timeline（事證包 / ops 都能追溯）
 * @returns {string} 寫入後的狀態
 */
export function setVehicleStatus(state, next, detail = {}) {
  const prev = currentVehicleStatus(state);
  if (prev === next) return next;
  state.setFlag("vehicleStatus", next);
  state.patch({ vehicle: { ...state.session.vehicle, status: next } });
  state.addEvent(EVENTS.VEHICLE_STATUS, {
    label: `車輛狀態：${prev} → ${next}${detail.reason ? `（${detail.reason}）` : ""}`,
    from: prev,
    to: next,
    ...detail,
  });
  return next;
}

/** 回報類型 + 對應的**模擬**初判結果（寫死的資料，非真實推論）。 */
const REPORT_TYPES = [
  {
    id: "damage",
    icon: "🔧",
    label: "車損 / 刮傷",
    hint: "新增刮痕、凹陷、燈殼破損",
    category: CAPTURE_CATEGORIES.DAMAGE,
    shots: [
      { id: "closeup", label: "損傷特寫", hint: "靠近拍清楚傷痕" },
      { id: "wide", label: "定位廣角", hint: "拍出位置（選填）", optional: true },
    ],
    triage: {
      finding: "疑似新增車體損傷（非租前基準已知舊損）",
      confidence: 0.82,
      severity: "high",
      status: VEHICLE_STATUS.NOT_RECOMMENDED,
      action: "暫停出租、派工檢修；下一位預約顯示風險",
    },
  },
  {
    id: "dirty",
    icon: "🧻",
    label: "髒污 / 異味",
    hint: "垃圾、污漬、菸味",
    category: CAPTURE_CATEGORIES.INTERIOR,
    shots: [
      { id: "closeup", label: "髒污特寫", hint: "對準污漬或垃圾" },
      { id: "wide", label: "車內廣角", hint: "拍出位置（選填）", optional: true },
    ],
    triage: {
      finding: "車內清潔度低於可出租標準",
      confidence: 0.74,
      severity: "mid",
      status: VEHICLE_STATUS.MANUAL,
      action: "派清潔；下一位預約顯示「待確認」",
    },
  },
  {
    id: "malfunction",
    icon: "⚙️",
    label: "設備 / 機械異常",
    hint: "警示燈、空調、胎壓、螢幕",
    category: CAPTURE_CATEGORIES.DASHBOARD,
    shots: [
      { id: "closeup", label: "警示 / 儀表特寫", hint: "拍清楚警示燈或異常處" },
      { id: "wide", label: "整體廣角", hint: "選填", optional: true },
    ],
    triage: {
      finding: "疑似設備異常，需人工確認是否影響行車",
      confidence: 0.61,
      severity: "mid",
      status: VEHICLE_STATUS.MANUAL,
      action: "客服致電確認 / 遠端診斷",
    },
  },
  {
    id: "other",
    icon: "📝",
    label: "其他狀況",
    hint: "停車位、充電、鑰匙…",
    category: CAPTURE_CATEGORIES.OTHER,
    shots: [{ id: "closeup", label: "現場照片", hint: "拍下你想說明的狀況" }],
    triage: {
      finding: "需人工判讀的其他狀況",
      confidence: 0.4,
      severity: "low",
      status: VEHICLE_STATUS.MANUAL,
      action: "轉人工客服",
    },
  },
];

const SEVERITY_TEXT = { high: "高", mid: "中", low: "低" };
const SEVERITY_BADGE = { high: "badge danger", mid: "badge warn", low: "badge" };

const typeById = (tid) => REPORT_TYPES.find((t) => t.id === tid) || null;

/**
 * 模擬 AI 初判（**寫死規則**，不是推論）。
 * 有兩個會改變結果的輸入，讓 demo 講得出「為什麼要拍照」與「安全優先」：
 *   1. 沒有照片 → 信心大幅下降、直接轉人工
 *   2. 勾選「可能影響行車安全」→ 一律升級為不建議出租
 */
function simulateTriage(type, { photoCount, safety }) {
  const base = type.triage;
  let { severity, status, confidence, action } = base;
  const notes = [];
  if (photoCount === 0) {
    confidence = Math.round(base.confidence * 0.55 * 100) / 100;
    severity = "low";
    status = VEHICLE_STATUS.MANUAL;
    action = "無影像可判讀，轉人工客服確認";
    notes.push("沒有附照片：模擬 AI 無法判讀，只能轉人工（這就是精簡拍照的價值）");
  }
  if (safety) {
    severity = "high";
    status = VEHICLE_STATUS.NOT_RECOMMENDED;
    confidence = Math.min(0.95, Math.round((confidence + 0.08) * 100) / 100);
    action = "立即暫停出租並派工檢修";
    notes.push("使用者標記「可能影響行車安全」→ 安全優先，直接停止出租");
  }
  return { finding: base.finding, confidence, severity, status, action, notes, mock: true };
}

export const css = `
.inuse-trip { margin: 12px 0; }
.inuse-trip .kv { margin-top: 8px; }
.inuse-elapsed {
  font-size: clamp(24px, 8vw, 30px);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.inuse-trip-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.inuse-window {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.inuse-window-clock { font-variant-numeric: tabular-nums; font-weight: 700; }

.inuse-types { display: flex; flex-direction: column; gap: 8px; }
.inuse-type {
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
.inuse-type.is-active { border-color: var(--accent); background: rgba(0, 194, 168, 0.1); }
.inuse-type-icon { font-size: 20px; line-height: 1.2; flex: 0 0 auto; }
.inuse-type-body { flex: 1 1 auto; min-width: 0; }
.inuse-type-name { display: block; font-size: 14px; font-weight: 600; }
.inuse-type-hint {
  display: block;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
  margin-top: 2px;
  overflow-wrap: anywhere;
}

.inuse-field { margin-top: 10px; }
.inuse-field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.inuse-field textarea {
  width: 100%;
  min-height: 64px;
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
.inuse-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.4;
}
.inuse-check input { margin: 2px 0 0; flex: 0 0 auto; width: 18px; height: 18px; accent-color: var(--danger); }

.inuse-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.inuse-chip {
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
.inuse-chip.is-active { border-color: var(--accent); color: var(--accent); background: rgba(0, 194, 168, 0.12); }
.inuse-chip.is-done { color: #6dd4c7; border-color: rgba(0, 194, 168, 0.4); }

.inuse-cam {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  border: 1px solid var(--line);
}
.inuse-cam-view,
.inuse-cam-mock { width: 100%; height: 100%; object-fit: cover; display: block; }
.inuse-cam-view[hidden],
.inuse-cam-mock[hidden] { display: none; }
.inuse-cam-hint {
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
.inuse-quality {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(245, 166, 35, 0.92);
  color: #1a1200;
}
.inuse-quality.is-ok { background: rgba(0, 194, 168, 0.9); color: #002820; }
/* 放在品質提示上方，避免和上方（可能折兩行的）拍攝提示重疊 */
.inuse-mock-badge {
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
.inuse-preview { border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); }
.inuse-preview img { width: 100%; display: block; aspect-ratio: 4 / 3; object-fit: cover; }
.inuse-preview p { margin: 0; padding: 8px 10px; font-size: 12px; background: var(--surface-2); color: var(--muted); }

.inuse-triage { text-align: center; padding: 22px 12px; }
.inuse-spinner {
  width: 30px;
  height: 30px;
  margin: 0 auto 10px;
  border-radius: 50%;
  border: 3px solid rgba(0, 194, 168, 0.25);
  border-top-color: var(--accent);
  animation: inuse-spin 0.8s linear infinite;
}
@keyframes inuse-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .inuse-spinner { animation-duration: 2.4s; }
}

.inuse-mock-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(245, 166, 35, 0.18);
  color: var(--warn);
}
.inuse-arrow { color: var(--muted); }
.inuse-notes { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--muted); }
.inuse-notes li { margin: 3px 0; overflow-wrap: anywhere; }
.inuse-history { margin-top: 14px; }
.inuse-history-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
}
.inuse-history-item + .inuse-history-item { margin-top: 6px; }
.inuse-history-item b { font-weight: 600; }
`;

export function mount(root, ctx) {
  const { state, config } = ctx;

  const unlockedAt = state.getFlag("unlockedAt");
  const supDeadline = state.getFlag("supplementDeadline");

  // 使用者可能直接從跳頁列跳進來（沒走過 #/supplement）→ 至少把車標成租賃中，
  // 這樣 #/ops 的狀態轉移看起來才連貫。
  if (unlockedAt && !state.getFlag("vehicleStatus")) {
    setVehicleStatus(state, VEHICLE_STATUS.IN_USE, {
      reason: "進入使用中畫面（demo 補寫）",
      source: "inuse:mount",
    });
  }

  const local = {
    step: "idle", // idle | form | triage | result
    typeId: null,
    shotId: null,
    pending: null,
    /** 本次回報已拍的照片：shotId → capture record */
    photos: new Map(),
    safety: false,
    busy: false,
    disposed: false,
    lastResult: null,
  };

  /** 追蹤 setTimeout，cleanup 一律清掉（切走時不能讓初判回呼再動 DOM）。 */
  const timeouts = new Set();
  function later(fn, ms) {
    const t = setTimeout(() => {
      timeouts.delete(t);
      if (!local.disposed) fn();
    }, ms);
    timeouts.add(t);
    return t;
  }

  ctx.setHeader({
    title: "使用中",
    subtitle: "不需要任何操作；發現車況異常可立即回報",
  });
  ctx.setFootnote(
    "模擬資料：AI 初判為寫死的示意結果，不連後端。回報會即時寫入車輛營運狀態（flags.vehicleStatus）。"
  );

  root.innerHTML = `
    <section class="card inuse-trip">
      <div class="inuse-trip-top">
        <div>
          <div class="muted">行程進行中</div>
          <div class="inuse-elapsed" data-el="elapsed">--</div>
        </div>
        <span data-el="statusBadge" class="badge">--</span>
      </div>
      <dl class="kv">
        <dt>車輛</dt><dd data-el="vehicle"></dd>
        <dt>取車站點</dt><dd data-el="station"></dd>
        <dt>營運狀態</dt><dd data-el="statusText"></dd>
      </dl>
    </section>

    <div class="notice hidden" data-el="windowNotice">
      <div class="inuse-window">
        <span>補拍窗口仍開放中，車內狀況現在補拍還算租前</span>
        <span class="inuse-window-clock" data-el="windowClock">--:--</span>
      </div>
      <div class="actions">
        <button type="button" class="btn small ghost" data-el="btnBackSupplement">回去補拍</button>
      </div>
    </div>

    <div data-el="idleState">
      <div class="notice">🚗 使用中不需要任何操作。若途中發現車況異常（碰撞、刮傷、異味、設備故障），
        <b>立即回報</b>會即時更新車輛可租狀態，下一位使用者就不會到現場才發現問題。</div>
      <div class="actions">
        <button type="button" class="btn primary full" data-el="btnReport">回報車況異常</button>
      </div>
    </div>

    <section class="card hidden" data-el="form">
      <h2 class="section-title">回報車況異常</h2>
      <div class="inuse-types" data-el="types"></div>

      <div class="inuse-field">
        <label for="inuse-note">補充說明（選填）</label>
        <textarea id="inuse-note" data-el="note" placeholder="例：停車時發現右後保桿有一道約 10 公分刮痕"></textarea>
      </div>

      <label class="inuse-check">
        <input type="checkbox" data-el="safety" />
        <span>可能影響行車安全（勾選後一律建議停止出租）</span>
      </label>

      <div data-el="shotBlock">
        <div class="inuse-chip-row" data-el="chips"></div>
        <div class="inuse-cam" data-el="camWrap">
          <video class="inuse-cam-view" data-el="video" playsinline autoplay muted></video>
          <canvas class="inuse-cam-mock" data-el="mockCanvas" hidden></canvas>
          <canvas data-el="scratchCanvas" hidden></canvas>
          <div class="inuse-cam-hint" data-el="camHint"></div>
          <div class="inuse-quality hidden" data-el="quality"></div>
          <div class="inuse-mock-badge hidden" data-el="mockBadge">模擬相機</div>
        </div>
        <div class="inuse-preview hidden" data-el="preview">
          <img data-el="previewImg" alt="回報照片預覽" />
          <p data-el="previewCaption"></p>
        </div>
        <div class="actions">
          <button type="button" class="btn primary" data-el="btnShoot">拍攝</button>
          <button type="button" class="btn ghost hidden" data-el="btnRetake">重拍</button>
          <button type="button" class="btn primary hidden" data-el="btnAdopt">採用這張</button>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn secondary" data-el="btnCancel">取消</button>
        <button type="button" class="btn primary full" data-el="btnSubmit">送出回報</button>
      </div>
      <p class="muted" data-el="formHint"></p>
    </section>

    <section class="card inuse-triage hidden" data-el="triage">
      <div class="inuse-spinner"></div>
      <div>模擬 AI 初判中…</div>
      <p class="muted">比對租前基準與補拍照片（模擬）</p>
    </section>

    <section class="card hidden" data-el="result"></section>

    <section class="inuse-history hidden" data-el="history">
      <h2 class="section-title">本次行程的回報紀錄</h2>
      <div data-el="historyList"></div>
    </section>

    <div class="actions" data-el="footActions">
      <button type="button" class="btn secondary" data-el="btnOps">查看營運視角</button>
      <button type="button" class="btn primary full" data-el="btnReturn">前往還車拍照</button>
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
   * camera.start() 是 async：若在它 resolve 之前就 camera.stop()，
   * 它會在之後才建立品質檢查 interval → 收不掉的殘留 timer。
   * 追蹤 in-flight 的 start，stop 時補一次；generation 避免誤殺後來重啟的相機。
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

  // ------------------------------------------------------------- 上半部（被動資訊）

  function renderTrip() {
    const v = state.session.vehicle || {};
    const status = currentVehicleStatus(state);
    els.vehicle.textContent = `${v.plate ?? "--"}　${v.model ?? ""}`.trim();
    els.station.textContent = v.station ?? "--";
    els.statusText.textContent = status;
    els.statusBadge.className = statusBadgeClass(status);
    els.statusBadge.textContent = status;
    els.elapsed.textContent = unlockedAt
      ? `已用車 ${Math.max(0, Math.floor(msToDemoMinutes(Date.now() - unlockedAt)))} 分鐘`
      : "尚未開鎖（demo 可直接回報）";
  }

  /** 補拍窗口只讀顯示 —— 逾時的關閉/記錄由 supplement.js 負責（單一寫入端）。 */
  function renderWindow() {
    const closed = !!state.getFlag("supplementClosed");
    const remain = supDeadline ? supDeadline - Date.now() : 0;
    const open = !!supDeadline && !closed && remain > 0;
    els.windowNotice.classList.toggle("hidden", !open);
    if (open) {
      els.windowNotice.classList.add("ok");
      els.windowClock.textContent = formatDemoCountdown(remain);
    }
  }

  // ------------------------------------------------------------- 回報表單

  function currentType() {
    return typeById(local.typeId);
  }

  function currentShot() {
    const type = currentType();
    if (!type) return null;
    return type.shots.find((s) => s.id === local.shotId) || type.shots[0];
  }

  function renderTypes() {
    els.types.innerHTML = REPORT_TYPES.map(
      (t) => `
        <button type="button" class="inuse-type${t.id === local.typeId ? " is-active" : ""}" data-type="${t.id}">
          <span class="inuse-type-icon" aria-hidden="true">${t.icon}</span>
          <span class="inuse-type-body">
            <span class="inuse-type-name">${escapeHtml(t.label)}</span>
            <span class="inuse-type-hint">${escapeHtml(t.hint)}</span>
          </span>
        </button>`
    ).join("");
  }

  function renderChips() {
    const type = currentType();
    els.shotBlock.classList.toggle("hidden", !type);
    if (!type) return;
    els.chips.innerHTML = type.shots
      .map((shot) => {
        const done = local.photos.has(shot.id);
        const active = shot.id === local.shotId;
        return `<button type="button" class="inuse-chip${active ? " is-active" : ""}${done ? " is-done" : ""}"
          data-shot="${shot.id}">${done ? "✓ " : ""}${escapeHtml(shot.label)}${shot.optional ? "（選填）" : ""}</button>`;
      })
      .join("");
  }

  function renderFormHint() {
    const type = currentType();
    if (!type) {
      els.formHint.textContent = "先選一個回報類型。";
      return;
    }
    els.formHint.textContent =
      local.photos.size === 0
        ? "沒有照片也可以送出（非阻擋），但模擬 AI 無法初判，只會轉人工。"
        : `已附 ${local.photos.size} 張照片，送出後立即進行模擬 AI 初判並更新車輛狀態。`;
  }

  function applyShotHint() {
    const type = currentType();
    const shot = currentShot();
    if (!type || !shot) return;
    els.camHint.textContent = `${type.label}｜${shot.label} · ${shot.hint}`;
    els.previewCaption.textContent = `${type.label}｜${shot.label}`;
    return camera.setCorner(null, `回報 · ${shot.label}`);
  }

  async function selectType(typeId) {
    const type = typeById(typeId);
    if (!type) return;
    const changed = local.typeId !== typeId;
    local.typeId = typeId;
    if (changed) {
      local.shotId = type.shots[0].id;
      local.pending = null;
      exitPreview();
    }
    // ⚠️ 先同步鎖住「拍攝」再 await：否則相機還沒起來就按得下去
    const needsCamera = camera.mode === "idle";
    if (needsCamera) els.btnShoot.disabled = true;
    renderTypes();
    renderChips();
    renderFormHint();
    await applyShotHint();
    if (needsCamera) {
      await startCamera();
      if (local.disposed) return;
      els.btnShoot.disabled = false;
      await applyShotHint();
    }
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
    if (local.busy || !currentType() || camera.mode === "idle") return;
    local.busy = true;
    els.btnShoot.disabled = true;
    try {
      const shot = await camera.capture();
      if (local.disposed) return;
      local.pending = shot;
      enterPreview(shot.dataUrl);
    } finally {
      local.busy = false;
      els.btnShoot.disabled = false;
    }
  }

  /**
   * 採用照片 → 存進 state。
   * 存放群組說明：state 只有 pickup / supplement / return 三組，使用中回報的照片
   * 借用 supplement 群組（可享縮圖降階與配額保護），並以 meta.stage='inuse'
   * 與 meta.reportPhoto=true 和真正的「補拍」區隔 —— 它**不**屬於租前基準。
   * Track C（比對）/ Track D（事證包）請用 meta.stage 過濾，或直接讀 report.photoIds。
   */
  async function onAdopt() {
    const type = currentType();
    const shot = currentShot();
    if (local.busy || !type || !shot || !local.pending) return;
    local.busy = true;
    els.btnAdopt.disabled = true;
    try {
      const old = local.photos.get(shot.id);
      if (old) state.removeCapture("supplement", old.id);
      const record = await state.addCapture("supplement", {
        angle: null,
        category: type.category,
        label: `使用中回報 · ${type.label}｜${shot.label}`,
        quality: local.pending.quality ?? null,
        fullDataUrl: local.pending.dataUrl,
        note: "使用中回報（不併入租前基準）",
        meta: {
          stage: "inuse",
          reportPhoto: true,
          reportType: type.id,
          shotId: shot.id,
          source: local.pending.mode,
        },
      });
      if (local.disposed) return;
      local.photos.set(shot.id, record);
      const next = type.shots.find((s) => !local.photos.has(s.id));
      if (next) local.shotId = next.id;
      exitPreview();
      renderChips();
      renderFormHint();
      await applyShotHint();
    } finally {
      local.busy = false;
      els.btnAdopt.disabled = false;
    }
  }

  // ------------------------------------------------------------- 送出 → 模擬初判

  function setStep(step) {
    local.step = step;
    els.idleState.classList.toggle("hidden", step !== "idle");
    els.form.classList.toggle("hidden", step !== "form");
    els.triage.classList.toggle("hidden", step !== "triage");
    els.result.classList.toggle("hidden", step !== "result");
    els.footActions.classList.toggle("hidden", step === "form" || step === "triage");
    if (step !== "form") stopCamera();
  }

  function onSubmit() {
    const type = currentType();
    if (local.busy) return;
    if (!type) {
      els.formHint.textContent = "請先選一個回報類型。";
      return;
    }
    local.safety = !!els.safety.checked;
    const photoIds = [...local.photos.values()].map((p) => p.id);
    const note = els.note.value.trim();
    const triage = simulateTriage(type, { photoCount: photoIds.length, safety: local.safety });
    const prevStatus = currentVehicleStatus(state);

    const report = state.addReport({
      type: type.id,
      typeLabel: type.label,
      note: note || `${type.label}（未填寫說明）`,
      photoIds,
      safety: local.safety,
      stage: "inuse",
      atDemoMinutes: unlockedAt
        ? Number(msToDemoMinutes(Date.now() - unlockedAt).toFixed(1))
        : null,
      /** 模擬 AI 初判結果（非真實推論） */
      triage,
    });

    // 即時影響車輛可租狀態 —— 實測第 4 點的核心。
    // 刻意在送出當下就寫入（不等下面的初判動畫）：使用者中途切走畫面時，
    // 營運端也必須已經知道這台車有問題。
    setVehicleStatus(state, triage.status, {
      reason: `使用者回報${type.label} · 模擬 AI 初判：${triage.finding}`,
      source: "inuse:report",
      reportId: report.id,
      triage,
      photoCount: photoIds.length,
    });
    local.lastResult = { type, report, triage, prevStatus };

    setStep("triage");
    const delay = config.speed === "fast" ? 450 : 1200;
    later(() => {
      renderResult();
      renderTrip();
      renderHistory();
      setStep("result");
      els.result.scrollIntoView({ block: "nearest" });
    }, delay);
  }

  function renderResult() {
    const r = local.lastResult;
    if (!r) return;
    const { type, report, triage, prevStatus } = r;
    els.result.innerHTML = `
      <div class="row between">
        <h2 class="section-title" style="margin:0">模擬 AI 初判結果</h2>
        <span class="inuse-mock-tag">模擬資料</span>
      </div>
      <div class="notice ${triage.severity === "high" ? "danger" : triage.severity === "mid" ? "warn" : ""}">
        <b>${escapeHtml(triage.finding)}</b><br />
        嚴重度 <span class="${SEVERITY_BADGE[triage.severity]}">${SEVERITY_TEXT[triage.severity]}</span>
        · 信心 ${triage.confidence.toFixed(2)}（模擬值）
      </div>
      <dl class="kv">
        <dt>車輛狀態</dt>
        <dd>${escapeHtml(prevStatus)} <span class="inuse-arrow">→</span>
          <span class="${statusBadgeClass(triage.status)}">${escapeHtml(triage.status)}</span></dd>
        <dt>建議處置</dt><dd>${escapeHtml(triage.action)}</dd>
        <dt>回報時間</dt><dd>${formatTime(report.at)}</dd>
        <dt>存證照片</dt><dd>${report.photoIds.length} 張</dd>
        <dt>責任追溯</dt><dd>已鏈結租前基準與回報時間（模擬）</dd>
      </dl>
      ${
        triage.notes.length
          ? `<ul class="inuse-notes">${triage.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
          : ""
      }
      <p class="muted">狀態已即時寫入營運端（flags.vehicleStatus = ${escapeHtml(triage.status)}）。
        ${
          triage.status === VEHICLE_STATUS.NOT_RECOMMENDED
            ? "下一位使用者在預約列表就會看到風險標籤，不會到現場才發現。"
            : "下一位使用者會看到「待確認」提示。"
        }</p>
      <div class="actions">
        <button type="button" class="btn ghost" data-el="btnAgain">再回報一件</button>
      </div>
    `;
    els.result.querySelector("[data-el='btnAgain']").addEventListener("click", startReport);
  }

  function renderHistory() {
    const reports = state.session.reports.filter((r) => r.stage === "inuse");
    els.history.classList.toggle("hidden", reports.length === 0);
    els.historyList.innerHTML = reports
      .slice()
      .reverse()
      .map(
        (r) => `
        <div class="inuse-history-item">
          <div class="row between">
            <b>${escapeHtml(r.typeLabel || r.type)}</b>
            <span class="muted">${formatTime(r.at)}</span>
          </div>
          <div class="muted">${escapeHtml(r.note)}</div>
          <div>${r.photoIds.length} 張照片 ·
            <span class="${statusBadgeClass(r.triage?.status)}">${escapeHtml(r.triage?.status ?? "-")}</span>
            ${r.safety ? '<span class="badge danger">影響行安</span>' : ""}
          </div>
        </div>`
      )
      .join("");
  }

  // ------------------------------------------------------------- 流程控制

  function startReport() {
    local.typeId = null;
    local.shotId = null;
    local.pending = null;
    local.photos = new Map();
    local.safety = false;
    els.note.value = "";
    els.safety.checked = false;
    els.shotBlock.classList.add("hidden");
    renderTypes();
    renderFormHint();
    setStep("form");
    els.form.scrollIntoView({ block: "nearest" });
  }

  function cancelReport() {
    setStep(local.lastResult ? "result" : "idle");
  }

  function goOps() {
    if (ctx.router.isRegistered("ops")) ctx.go("ops");
    else
      alert(
        `營運視角「#/ops」由 Track A 實作，尚未上線。\n` +
          `目前 flags.vehicleStatus = ${currentVehicleStatus(state)}（已寫入 localStorage）。`
      );
  }

  function goReturn() {
    if (ctx.router.isRegistered("capture")) ctx.go("capture", { phase: "return" });
    else alert("還車拍照畫面尚未上線。");
  }

  // ------------------------------------------------------------- 事件綁定

  els.btnReport.addEventListener("click", startReport);
  els.types.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]");
    if (btn) selectType(btn.dataset.type);
  });
  els.chips.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-shot]");
    if (!btn) return;
    local.shotId = btn.dataset.shot;
    exitPreview();
    renderChips();
    await applyShotHint();
  });
  els.safety.addEventListener("change", () => {
    local.safety = els.safety.checked;
  });
  els.btnShoot.addEventListener("click", onShoot);
  els.btnRetake.addEventListener("click", exitPreview);
  els.btnAdopt.addEventListener("click", onAdopt);
  els.btnSubmit.addEventListener("click", onSubmit);
  els.btnCancel.addEventListener("click", cancelReport);
  els.btnOps.addEventListener("click", goOps);
  els.btnReturn.addEventListener("click", goReturn);
  els.btnBackSupplement.addEventListener("click", () => {
    if (ctx.router.isRegistered("supplement")) ctx.go("supplement");
  });

  // ------------------------------------------------------------- 初始渲染 + timer

  renderTrip();
  renderWindow();
  renderHistory();
  setStep("idle");

  // 唯一的 interval：更新用車時間與補拍窗口倒數（cleanup 一定要清掉）
  const timer = setInterval(() => {
    if (local.disposed) return;
    renderTrip();
    renderWindow();
  }, 1000);

  return () => {
    local.disposed = true;
    clearInterval(timer);
    timeouts.forEach((t) => clearTimeout(t));
    timeouts.clear();
    stopCamera();
  };
}
