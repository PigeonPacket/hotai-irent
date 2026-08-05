/**
 * 營運視角 —— 車隊狀態機（PIG-13 §4）
 * ==========================================================================
 * **這一頁存在的唯一理由**（notes/260702.md 第 4 點）：
 *
 *   > 車損狀況回報不夠即時 → 導致下一個人到租車地點看到車才發現有問題，
 *   > 又要回報並改約另一台，降低了無辜使用者的體驗。
 *
 * 光做「使用者回報」看不出價值 —— 必須看到**回報之後車輛狀態真的變了、
 * 而且下一位使用者看得到**。所以每一台有風險的車，這一頁都會直接畫出
 * 「下一位使用者在預約清單會看到什麼」。
 *
 * 資料來源：`vehicle.js` 的 `getFleet(state)`（= Screen 0 用的同一份真相）。
 * 狀態寫入：`vehicle.js` 的 `setVehicleStatus()`（本車寫 `flags.vehicleStatus`）。
 *
 * 三畫面串接（簡報殺手鏡頭）：
 *   #/inuse 回報車損（Track B 寫 flags.vehicleStatus）
 *     → #/ops 看到該車被標記、預約清單已暫停
 *     → #/vehicle 看到預約卡出現風險標籤
 * ==========================================================================
 */

import { EVENTS } from "../state.js";
import { escapeHtml, formatTime } from "../util.js";
import {
  FLEET_CSS,
  STATUS_BRANCH_LINE,
  STATUS_MAIN_LINE,
  UNKNOWN_STATUS_META,
  VEHICLE_STATUS,
  ensureDemoVehicle,
  getFleet,
  normalizeStatus,
  riskPill,
  setVehicleStatus,
  statusMeta,
  statusPill,
  syncSessionVehicleStatus,
} from "./vehicle.js";

export const id = "ops";
export const title = "營運視角 · 車隊狀態";
export const subtitle = "回報 → 狀態 → 下一位使用者看到什麼（模擬資料）";

export const nav = [{ label: "營運視角", params: {}, order: 90 }];

/** Demo 工具的下拉選項：刻意混入別名與不合法值，驗證優雅退化。 */
const DEMO_STATUS_OPTIONS = Object.freeze([
  { value: "", label: "— 清除（回到自動推導）—" },
  { value: VEHICLE_STATUS.AVAILABLE, label: "available（可租）" },
  { value: VEHICLE_STATUS.RESERVED, label: "reserved（待取車）" },
  { value: VEHICLE_STATUS.IN_USE, label: "in_use（租賃中）" },
  { value: VEHICLE_STATUS.AI_REVIEW, label: "ai_review（AI審核中）" },
  { value: VEHICLE_STATUS.MANUAL_REVIEW, label: "manual_review（待人工）" },
  { value: VEHICLE_STATUS.NOT_RECOMMENDED, label: "not_recommended（不建議出租）" },
  { value: VEHICLE_STATUS.MAINTENANCE, label: "maintenance（維修中）" },
  { value: "不建議出租", label: "「不建議出租」（中文標籤）" },
  { value: "reported", label: "reported（別名 → 待人工）" },
  { value: "damage_reported", label: "damage_reported（模糊比對 → 不建議出租）" },
  { value: "weird_value_xyz", label: "weird_value_xyz（不合法 → 優雅退化）" },
]);

export const css = `
${FLEET_CSS}

.ops-why { border-color: rgba(245,166,35,.35); }
.ops-why p { margin: 0 0 8px; font-size: 12px; line-height: 1.55; color: var(--muted); }
.ops-why p:last-child { margin-bottom: 0; }
.ops-why q { color: var(--text); }
.ops-ba { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 10px 0 0; }
.ops-ba div { background: var(--surface-2); border-radius: 10px; padding: 8px; min-width: 0; }
.ops-ba dt { font-size: 10px; color: var(--muted); margin-bottom: 3px; }
.ops-ba dd { margin: 0; font-size: 12px; line-height: 1.45; }
.ops-ba .bad { color: var(--danger); }
.ops-ba .good { color: #6dd4c7; }

.ops-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; flex-wrap: wrap; margin: 0 0 10px; font-size: 11px; color: var(--muted);
}
.ops-live { display: inline-flex; align-items: center; gap: 6px; }
.ops-live i {
  width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 0 rgba(0,194,168,.7); animation: ops-pulse 2s infinite;
}
@keyframes ops-pulse {
  0% { box-shadow: 0 0 0 0 rgba(0,194,168,.6); }
  70% { box-shadow: 0 0 0 7px rgba(0,194,168,0); }
  100% { box-shadow: 0 0 0 0 rgba(0,194,168,0); }
}

.ops-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 12px; }
.ops-kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 7px 5px; text-align: center; min-width: 0; }
.ops-kpi b { display: block; font-size: 17px; line-height: 1.1; }
.ops-kpi span { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; }
.ops-kpi.warn b { color: var(--warn); }
.ops-kpi.danger b { color: var(--danger); }
.ops-kpi.ok b { color: #6dd4c7; }

.ops-machine { overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
.ops-machine::-webkit-scrollbar { display: none; }
.ops-flow { display: flex; align-items: center; gap: 5px; width: max-content; }
.ops-node {
  flex: 0 0 auto; padding: 5px 9px; border-radius: 8px; font-size: 11px;
  background: var(--surface-2); border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
}
.ops-node.on { border-color: var(--accent); color: var(--accent); background: rgba(0,194,168,.14); font-weight: 700; }
.ops-node.warn { border-color: rgba(245,166,35,.5); color: var(--warn); }
.ops-node.danger { border-color: rgba(255,107,107,.5); color: var(--danger); }
.ops-arrow { flex: 0 0 auto; color: var(--muted); font-size: 11px; }
.ops-branch-label { font-size: 10px; color: var(--muted); margin: 8px 0 4px; }

.ops-veh { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 11px; margin-bottom: 10px; }
.ops-veh.self { border-color: var(--accent); }
.ops-veh.risk { border-color: rgba(255,107,107,.45); }
.ops-veh-top { display: flex; gap: 8px; justify-content: space-between; align-items: flex-start; }
.ops-veh-id { min-width: 0; }
.ops-veh-id b { font-size: 14px; font-weight: 700; }
.ops-plate {
  display: inline-block; margin-left: 6px; padding: 1px 6px;
  border: 1px solid #46586f; border-radius: 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
}
.ops-veh-meta { display: block; font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.45; }
.ops-nb { white-space: nowrap; }
.ops-veh-pills { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: 0 0 auto; }
.ops-self-tag { margin: 8px 0 0; font-size: 10px; color: var(--accent); letter-spacing: .04em; }
.ops-source { margin: 8px 0 0; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
.ops-source code { font-size: 10px; background: var(--surface-2); padding: 1px 4px; border-radius: 4px; }

.ops-reports { margin: 9px 0 0; padding: 8px 9px; border-radius: 9px; background: rgba(245,166,35,.1); border: 1px solid rgba(245,166,35,.35); }
.ops-reports.danger { background: rgba(255,107,107,.1); border-color: rgba(255,107,107,.35); }
.ops-reports h4 { margin: 0 0 5px; font-size: 11px; color: var(--warn); }
.ops-reports.danger h4 { color: var(--danger); }
.ops-reports ul { margin: 0; padding: 0; list-style: none; }
.ops-reports li { font-size: 11px; line-height: 1.5; padding: 3px 0; border-bottom: 1px dashed rgba(255,255,255,.08); }
.ops-reports li:last-child { border-bottom: none; }
.ops-reports time { color: var(--muted); font-size: 10px; }

.ops-rider { margin-top: 10px; }
.ops-rider-cap { margin: 0 0 5px; font-size: 10px; color: var(--muted); letter-spacing: .03em; }
.ops-rider-card { border: 1px dashed #46586f; border-radius: 10px; padding: 9px; background: #16202c; }
.ops-rider-head { display: flex; gap: 6px; justify-content: space-between; align-items: center; }
.ops-rider-head b { font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
.ops-rider-note { margin: 6px 0 0; font-size: 11px; line-height: 1.5; }
.ops-rider-note.risk { color: var(--warn); }
.ops-rider-note.block { color: var(--danger); }
.ops-rider-btns { display: flex; gap: 6px; margin-top: 8px; }
.ops-rider-btn {
  flex: 1 1 0; text-align: center; padding: 6px 4px; border-radius: 7px;
  font-size: 11px; font-weight: 600; background: var(--accent); color: #002820; min-width: 0;
}
.ops-rider-btn.dim { background: #2a3545; color: #66788f; text-decoration: line-through; }
.ops-rider-btn.alt { background: transparent; border: 1px solid #46586f; color: var(--text); text-decoration: none; }

.ops-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.ops-act {
  flex: 0 1 auto; padding: 7px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid #46586f; background: var(--surface-2); color: var(--text);
  font-family: inherit; font-size: 11px; white-space: nowrap;
}
.ops-act:active { border-color: var(--accent); }
.ops-act.clear { border-color: #5a3a3a; color: #ff9b9b; }

.ops-tool { margin-top: 4px; }
.ops-tool select {
  width: 100%; padding: 9px 10px; border-radius: 9px; font-family: inherit; font-size: 13px;
  background: var(--surface-2); color: var(--text); border: 1px solid var(--line);
}
.ops-tool p { margin: 8px 0 0; }
`;

// --------------------------------------------------------------------------
// helper
// --------------------------------------------------------------------------

function clockLabel() {
  const d = new Date();
  return `${formatTime(d)}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function shortStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(d)}`;
}

/** 「回報 → 狀態更新」的延遲（證明即時性）。 */
function reportLatency(session) {
  const reports = session.reports || [];
  if (!reports.length) return null;
  const last = reports[reports.length - 1];
  const t0 = new Date(last.at).getTime();
  if (Number.isNaN(t0)) return null;
  const evt = (session.timeline || []).find(
    (e) => e.type === EVENTS.VEHICLE_STATUS && new Date(e.at).getTime() >= t0
  );
  return {
    at: last.at,
    typeLabel: last.type || "other",
    seconds: evt ? Math.max(0, Math.round((new Date(evt.at).getTime() - t0) / 1000)) : 0,
    viaEvent: !!evt,
  };
}

/**
 * Demo 工具下拉要預選哪一項：先比原值，再比「解析後同一個狀態」。
 * （寫入時存的是中文標籤，所以選了 `available` 之後要能對回「可租」那一項。）
 */
function selectedOptionIndex(state) {
  const raw = state.session.flags?.vehicleStatus ?? "";
  const exact = DEMO_STATUS_OPTIONS.findIndex((o) => o.value !== "" && o.value === raw);
  if (exact >= 0) return exact;
  const curId = normalizeStatus(raw).id;
  if (!curId) return 0;
  const byId = DEMO_STATUS_OPTIONS.findIndex(
    (o) => o.value !== "" && normalizeStatus(o.value).id === curId
  );
  return byId >= 0 ? byId : 0;
}

function statusSourceLine(entry) {
  const src = entry.status.source;
  if (src === "flag") {
    return `狀態來源：<code>flags.vehicleStatus</code>（使用者回報 / 營運寫入）${
      entry.status.recognized
        ? ""
        : `<br><span class="fleet-raw">未定義的值 ${escapeHtml(
            JSON.stringify(entry.status.raw)
          )} → 退化為「${escapeHtml(UNKNOWN_STATUS_META.label)}」</span>`
    }`;
  }
  if (src === "override") return `狀態來源：<code>flags.fleetStatusOverrides</code>（營運手動調整）`;
  if (src === "derived") {
    return entry.reports.length
      ? `狀態來源：由 session 進度自動推導；風險由使用者回報<strong>即時升級</strong>（尚未寫入 <code>flags.vehicleStatus</code>）`
      : `狀態來源：由本次 session 進度自動推導（尚無回報）`;
  }
  return `狀態來源：模擬車隊基準資料`;
}

function riderPreview(entry) {
  const blocked = !entry.risk.bookable;
  const tone = entry.risk.level === "danger" ? "block" : entry.risk.level === "warn" ? "risk" : "";
  return `
    <div class="ops-rider">
      <p class="ops-rider-cap">下一位使用者在預約清單會看到 <span class="fleet-mock">模擬畫面</span></p>
      <div class="ops-rider-card">
        <div class="ops-rider-head">
          <b>${escapeHtml(entry.model)}　${escapeHtml(entry.plate)}</b>
          ${entry.risk.label ? riskPill(entry) : statusPill(entry)}
        </div>
        <p class="ops-rider-note ${tone}">${
          entry.risk.level === "ok" ? "" : "⚠ "
        }${escapeHtml(entry.risk.riderNotice)}</p>
        <div class="ops-rider-btns">
          <span class="ops-rider-btn${blocked ? " dim" : ""}">${
            blocked ? "無法預約" : "預約此車"
          }</span>
          ${blocked ? `<span class="ops-rider-btn alt">改選其他車輛</span>` : ""}
        </div>
      </div>
    </div>`;
}

function reportsBlock(entry) {
  if (!entry.reports.length) return "";
  const danger = entry.reports.some((r) => r.type === "damage");
  return `
    <div class="ops-reports${danger ? " danger" : ""}">
      <h4>車況回報 ${entry.reports.length} 筆 → 已即時影響本車狀態</h4>
      <ul>
        ${entry.reports
          .map(
            (r) => `<li>
              <strong>${escapeHtml(r.typeLabel)}</strong>
              <time>${escapeHtml(shortStamp(r.at))}・${escapeHtml(r.by)}${
                r.photoCount ? `・${r.photoCount} 張照片` : ""
              }</time><br>${escapeHtml(r.note || "（無說明）")}
            </li>`
          )
          .join("")}
      </ul>
    </div>`;
}

function transitionButtons(entry) {
  const meta = entry.status.meta || UNKNOWN_STATUS_META;
  const btns = (meta.transitions || [])
    .map(
      (t) =>
        `<button type="button" class="ops-act" data-act="to" data-vid="${escapeHtml(
          entry.id
        )}" data-to="${escapeHtml(t.to)}">${escapeHtml(t.action)} → ${escapeHtml(
          statusMeta(t.to).label
        )}</button>`
    )
    .join("");
  const canClear = entry.status.source === "flag" || entry.status.source === "override";
  const clear = canClear
    ? `<button type="button" class="ops-act clear" data-act="clear" data-vid="${escapeHtml(
        entry.id
      )}">清除覆寫</button>`
    : "";
  return `<div class="ops-acts">${btns}${clear}</div>`;
}

function vehicleCard(entry) {
  const risky = entry.risk.level !== "ok";
  return `
    <article class="ops-veh${entry.self ? " self" : ""}${risky ? " risk" : ""}">
      <div class="ops-veh-top">
        <div class="ops-veh-id">
          <b>${escapeHtml(entry.model)}</b><span class="ops-plate">${escapeHtml(entry.plate)}</span>
          <span class="ops-veh-meta">
            ${escapeHtml(entry.station)}・${escapeHtml(entry.color)}色<br>
            <span class="ops-nb">油量 ${entry.fuel}%</span>・<span class="ops-nb">整潔度 ${
              Number.isFinite(entry.cleanliness) ? entry.cleanliness.toFixed(1) : "—"
            } <span class="fleet-mock">模擬</span></span>・<span class="ops-nb">舊損 ${
              entry.knownDamages.length
            } 處</span>・<span class="ops-nb">里程費 ${entry.mileageFee} 元/km</span>
          </span>
        </div>
        <div class="ops-veh-pills">${statusPill(entry)}${riskPill(entry)}</div>
      </div>
      ${entry.self ? `<p class="ops-self-tag">▲ 本次 demo 車輛（與 #/vehicle、#/inuse 同一台）</p>` : ""}
      <p class="ops-source">${statusSourceLine(entry)}</p>
      ${reportsBlock(entry)}
      ${riderPreview(entry)}
      ${transitionButtons(entry)}
    </article>`;
}

function machineDiagram(currentId) {
  const node = (sid) => {
    const meta = statusMeta(sid);
    const on = sid === currentId ? " on" : "";
    const tone = meta.tone ? ` ${meta.tone}` : "";
    return `<span class="ops-node${tone}${on}">${escapeHtml(meta.label)}</span>`;
  };
  const main = STATUS_MAIN_LINE.map(node).join(`<span class="ops-arrow">→</span>`);
  const branch = STATUS_BRANCH_LINE.map(node).join(`<span class="ops-arrow">→</span>`);
  return `
    <div class="ops-machine"><div class="ops-flow">${main}
      <span class="ops-arrow">↺</span>${node(VEHICLE_STATUS.AVAILABLE)}</div></div>
    <p class="ops-branch-label">AI 審核後的分支（不建議出租 → 派工 → 修復完成回到可租）</p>
    <div class="ops-machine"><div class="ops-flow">${branch}
      <span class="ops-arrow">→</span>${node(VEHICLE_STATUS.AVAILABLE)}</div></div>
    ${
      currentId === UNKNOWN_STATUS_META.id
        ? `<p class="ops-branch-label">本車目前的狀態值無法對應到狀態機，已保守視為「${escapeHtml(
            UNKNOWN_STATUS_META.label
          )}」。</p>`
        : ""
    }`;
}

// --------------------------------------------------------------------------
// mount
// --------------------------------------------------------------------------

export function mount(root, ctx) {
  const { state } = ctx;
  ensureDemoVehicle(state);

  function render() {
    const fleet = getFleet(state);
    const self = fleet.find((v) => v.self) || fleet[0];
    syncSessionVehicleStatus(state, self);

    // 本車排最前面，其餘依風險由高到低
    const rankRisk = { danger: 0, warn: 1, ok: 2 };
    const ordered = [
      ...fleet.filter((v) => v.self),
      ...fleet
        .filter((v) => !v.self)
        .sort((a, b) => rankRisk[a.risk.level] - rankRisk[b.risk.level]),
    ];

    const kpi = {
      total: fleet.length,
      available: fleet.filter((v) => v.risk.bookable).length,
      risk: fleet.filter((v) => v.risk.level !== "ok" && v.status.id !== VEHICLE_STATUS.MAINTENANCE)
        .length,
      maintenance: fleet.filter((v) => v.status.id === VEHICLE_STATUS.MAINTENANCE).length,
    };
    const latency = reportLatency(state.session);

    root.innerHTML = `
      <div class="ops-bar">
        <span class="ops-live"><i></i>即時同步（模擬）· <span data-el="clock">${clockLabel()}</span></span>
        <span class="fleet-mock">模擬車隊 ${kpi.total} 台</span>
      </div>

      <div class="ops-kpis">
        <div class="ops-kpi ok"><b>${kpi.available}</b><span>可預約</span></div>
        <div class="ops-kpi warn"><b>${kpi.risk}</b><span>風險車輛</span></div>
        <div class="ops-kpi danger"><b>${kpi.maintenance}</b><span>維修中</span></div>
        <div class="ops-kpi"><b>${kpi.total}</b><span>車隊總數</span></div>
      </div>

      <section class="card ops-why">
        <h2 class="section-title">這一頁在證明什麼</h2>
        <p>7/2 實測第 4 點：<q>車損狀況回報不夠即時 → 導致下一個人到租車地點看到車才發現有問題，
        又要回報並改約另一台，降低了無辜使用者的體驗。</q></p>
        <dl class="ops-ba">
          <div>
            <dt>現況</dt>
            <dd class="bad">回報走客服 → 人工建檔 → 車輛狀態延後更新 → 下一位<strong>到現場才發現</strong></dd>
          </div>
          <div>
            <dt>本方案</dt>
            <dd class="good">回報即寫入車輛狀態 → 預約清單同步下架／標記 → 下一位<strong>在預約時就知道</strong></dd>
          </div>
        </dl>
        ${
          latency
            ? `<p style="margin-top:8px">本次 session：最新回報 ${escapeHtml(
                shortStamp(latency.at)
              )} → 車輛狀態更新延遲 <strong style="color:var(--accent)">${
                latency.seconds
              } 秒</strong>${
                latency.viaEvent ? "" : "（由回報自動升級風險，未經人工）"
              }。</p>`
            : `<p style="margin-top:8px">本次 session 還沒有使用者回報。到 <code>#/inuse</code> 回報一次車況，再回來看這一頁。</p>`
        }
      </section>

      <section class="card">
        <h2 class="section-title">車輛狀態機 <span class="fleet-mock">PIG-13 §4</span></h2>
        <p class="muted" style="margin:0 0 8px">高亮 = 本次 demo 車輛（${escapeHtml(
          self.plate
        )}）目前的狀態。</p>
        ${machineDiagram(self.status.id)}
      </section>

      <h2 class="section-title" style="margin-top:16px">車隊清單</h2>
      <p class="muted" style="margin:0 0 10px">
        每一台都附「下一位使用者在預約清單會看到什麼」。按鈕 = 狀態機的合法轉移。
      </p>
      ${ordered.map(vehicleCard).join("")}

      <section class="card ops-tool">
        <h2 class="section-title">Demo 工具 · 直接寫入 <code>flags.vehicleStatus</code></h2>
        <p class="muted" style="margin:0 0 8px">
          模擬 Track B 的 <code>#/inuse</code> 寫入本車狀態。清單刻意包含中文標籤、別名與
          不合法的值，用來驗證未預期的值會優雅退化而不是拋錯。
        </p>
        <select data-el="statusSelect" aria-label="寫入車輛狀態">
          ${DEMO_STATUS_OPTIONS.map(
            (o, i) =>
              `<option value="${escapeHtml(o.value)}"${
                i === selectedOptionIndex(state) ? " selected" : ""
              }>${escapeHtml(o.label)}</option>`
          ).join("")}
        </select>
        <div class="actions">
          <button type="button" class="btn ghost small" data-act="write">寫入本車狀態</button>
          ${
            ctx.router.isRegistered("inuse")
              ? `<button type="button" class="btn ghost small" data-act="goto" data-to="inuse">前往 #/inuse 回報</button>`
              : ""
          }
          <button type="button" class="btn ghost small" data-act="goto" data-to="vehicle">回使用者視角 #/vehicle</button>
        </div>
      </section>
    `;

    ctx.setFootnote(
      "營運視角（PIG-13 §4）· 與 #/vehicle 讀同一份車隊資料（vehicle.js 的 getFleet）；" +
        "車隊、車牌、AI 判讀皆為模擬資料，車牌一律為 DEMO-xxxx。"
    );
  }

  root.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "to") {
      setVehicleStatus(state, btn.dataset.vid, btn.dataset.to, { by: "營運端手動轉移" });
      render();
    } else if (act === "clear") {
      setVehicleStatus(state, btn.dataset.vid, null, { by: "營運端清除覆寫" });
      render();
    } else if (act === "write") {
      const select = root.querySelector('[data-el="statusSelect"]');
      const value = select ? select.value : "";
      setVehicleStatus(state, state.session.vehicle?.id, value === "" ? null : value, {
        by: "Demo 工具",
      });
      render();
    } else if (act === "goto") {
      const target = btn.dataset.to;
      if (ctx.router.isRegistered(target)) ctx.go(target);
      else alert(`畫面 #/${target} 尚未實作（其他 track 還在開發中）。`);
    }
  });

  /**
   * 狀態指紋 —— 用來偵測「這一頁掛著的時候，車輛真相被別人改掉了」。
   * router 對同一個 hash 不會重新 mount，所以自己偵測比較保險，
   * 也讓「即時同步」這個標籤名副其實。
   */
  function signature() {
    const s = state.session;
    return [
      s.vehicle?.id,
      (s.reports || []).length,
      (s.timeline || []).length,
      JSON.stringify(s.flags?.vehicleStatus ?? null),
      JSON.stringify(s.flags?.fleetStatusOverrides ?? null),
      (s.returnCaptures || []).length,
      s.flags?.unlockedAt ? 1 : 0,
    ].join("|");
  }

  render();
  let lastSig = signature();

  // 即時感的時鐘 + 狀態變動偵測 —— cleanup 必須收掉
  const clockTimer = setInterval(() => {
    const sig = signature();
    if (sig !== lastSig) {
      lastSig = sig;
      render();
      return;
    }
    const el = root.querySelector('[data-el="clock"]');
    if (el) el.textContent = clockLabel();
  }, 1000);

  return () => clearInterval(clockTimer);
}
