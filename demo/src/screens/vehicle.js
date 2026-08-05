/**
 * Screen 0 —— 取車前 AI 車況預告（PIG-13 §3 Screen 0）
 * ==========================================================================
 * 目的（實測報告 §3.4 / notes/260702.md 第 4 點）：
 *   讓下一位使用者「在預約階段」就看到車況與風險，而不是到了現場看到車才發現有問題。
 * 目的（實測報告 §3.2 / notes 第 2 點的「防禦性」那一軌）：
 *   在拍照之前先講清楚「認真拍照是為了證明損傷本來就有，不是你造成的」。
 *
 * 本檔案同時是 **Track A 的車隊資料與車輛狀態機單一真相**：
 *   - `FLEET`               模擬車隊（含本次 demo 車輛）
 *   - `VEHICLE_STATUS`      狀態機的合法狀態值（= `flags.vehicleStatus` 的契約）
 *   - `getFleet(state)`     把靜態車隊 + session 即時資料合成「現在的車隊真相」
 *   - `setVehicleStatus()`  唯一的狀態寫入口
 *   `ops.js` 直接 import 這些 export，兩個畫面因此永遠讀同一份真相。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `flags.vehicleStatus` 契約（Track A 擁有，Track B 的 inuse.js 會寫入）
 * ──────────────────────────────────────────────────────────────────────────
 * 寫入方式（建議）：
 *     import { setVehicleStatus, VEHICLE_STATUS } from './vehicle.js';
 *     setVehicleStatus(state, state.session.vehicle.id,
 *                      VEHICLE_STATUS.MANUAL_REVIEW, { reason: '使用者回報車損' });
 * 或最低限度（Track B 只要這樣做就會生效）：
 *     state.setFlag('vehicleStatus', 'manual_review');
 *
 * 接受的值：
 *   1. `VEHICLE_STATUS` 的七個 id：available / reserved / in_use / ai_review /
 *      manual_review / not_recommended / maintenance
 *   2. 中文標籤：可租 / 待取車 / 租賃中 / AI審核中 / 待人工 / 不建議出租 / 維修中
 *   3. 常見別名（見 STATUS_ALIASES）：reported / flagged / damaged / repair / …
 *   4. 物件形式：`{ status, reason?, at? }`（status 走上面同一套解析）
 *   5. `null` / `undefined` = 未設定 → 由 session 推導（deriveStatus）
 *   6. 以上都不符 → 退化成 `unknown`：以「待確認」呈現、原值照實顯示、**不拋錯**。
 *
 * 另外：**只要 `session.reports` 有任何回報，即使狀態值沒被寫入，下一位使用者
 * 也一定會在這一頁看到風險標籤**（見 assessRisk）。這樣即使 Track B 只呼叫了
 * `state.addReport()` 而忘了設 flag，「回報 → 下一位看得到」的劇本仍然成立。
 * ==========================================================================
 */

import { EVENTS } from "../state.js";
import { escapeHtml, formatTime } from "../util.js";

export const id = "vehicle";
export const title = "取車前車況預告";
export const subtitle = "AI 綜合上一輪還車紀錄（模擬資料）";

/** 跳頁列：order 最小 → 這一頁就是劇本首頁（CONTRACT §5 槽位表） */
export const nav = [{ label: "取車前預告", params: {}, order: 10 }];

// ==========================================================================
// 狀態機（PIG-13 §4）
// ==========================================================================

/** `flags.vehicleStatus` 的正式值。 */
export const VEHICLE_STATUS = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  IN_USE: "in_use",
  AI_REVIEW: "ai_review",
  MANUAL_REVIEW: "manual_review",
  NOT_RECOMMENDED: "not_recommended",
  MAINTENANCE: "maintenance",
});

/**
 * 每個狀態的顯示與語意。
 * - `tone`        badge / pill 色調：ok | warn | danger | ""（中性）
 * - `bookable`    預約清單是否可下訂
 * - `risk`        風險等級：ok | warn | danger
 * - `riskLabel`   風險標籤文字（null = 不顯示標籤）
 * - `riderNotice` **下一位使用者在預約清單會看到的那一句話**
 * - `opsHint`     營運端說明
 * - `transitions` 合法轉移（完全依 PIG-13 §4 的狀態圖）
 */
export const STATUS_META = Object.freeze({
  [VEHICLE_STATUS.AVAILABLE]: {
    id: VEHICLE_STATUS.AVAILABLE,
    label: "可租",
    tone: "ok",
    bookable: true,
    risk: "ok",
    riskLabel: null,
    riderNotice: "車況正常，可立即預約。",
    opsHint: "正常曝光於預約清單。",
    transitions: [{ to: VEHICLE_STATUS.RESERVED, action: "預約" }],
  },
  [VEHICLE_STATUS.RESERVED]: {
    id: VEHICLE_STATUS.RESERVED,
    label: "待取車",
    tone: "",
    bookable: false,
    risk: "ok",
    riskLabel: null,
    riderNotice: "已被預約，不再顯示於可租清單。",
    opsHint: "等待使用者到場解鎖。",
    transitions: [
      { to: VEHICLE_STATUS.IN_USE, action: "解鎖" },
      { to: VEHICLE_STATUS.AVAILABLE, action: "取消預約" },
    ],
  },
  [VEHICLE_STATUS.IN_USE]: {
    id: VEHICLE_STATUS.IN_USE,
    label: "租賃中",
    tone: "",
    bookable: false,
    risk: "ok",
    riskLabel: null,
    riderNotice: "目前租賃中，歸還後開放預約。",
    opsHint: "使用中；此時的使用者回報會即時改變本車狀態。",
    transitions: [{ to: VEHICLE_STATUS.AI_REVIEW, action: "還車拍照完成" }],
  },
  [VEHICLE_STATUS.AI_REVIEW]: {
    id: VEHICLE_STATUS.AI_REVIEW,
    label: "AI審核中",
    tone: "warn",
    bookable: false,
    risk: "warn",
    riskLabel: "待確認",
    riderNotice: "剛歸還，AI 正在比對前後車況，稍後開放預約。",
    opsHint: "還車照片已進 AI 比對，等待判定。",
    transitions: [
      { to: VEHICLE_STATUS.AVAILABLE, action: "無問題" },
      { to: VEHICLE_STATUS.MANUAL_REVIEW, action: "有爭議" },
      { to: VEHICLE_STATUS.NOT_RECOMMENDED, action: "明顯損傷／髒污" },
    ],
  },
  [VEHICLE_STATUS.MANUAL_REVIEW]: {
    id: VEHICLE_STATUS.MANUAL_REVIEW,
    label: "待人工",
    tone: "warn",
    bookable: false,
    risk: "warn",
    riskLabel: "待確認",
    riderNotice: "車況有待確認事項，營運端處理中，暫不開放預約。",
    opsHint: "需人工判定；預約清單已顯示風險並暫停下訂。",
    transitions: [
      { to: VEHICLE_STATUS.AVAILABLE, action: "結案" },
      { to: VEHICLE_STATUS.NOT_RECOMMENDED, action: "確認問題" },
    ],
  },
  [VEHICLE_STATUS.NOT_RECOMMENDED]: {
    id: VEHICLE_STATUS.NOT_RECOMMENDED,
    label: "不建議出租",
    tone: "danger",
    bookable: false,
    risk: "danger",
    riskLabel: "不建議預約",
    riderNotice: "已確認車況問題，不建議預約，請改選其他車輛。",
    opsHint: "已從可租清單下架，等待派工。",
    transitions: [{ to: VEHICLE_STATUS.MAINTENANCE, action: "派工" }],
  },
  [VEHICLE_STATUS.MAINTENANCE]: {
    id: VEHICLE_STATUS.MAINTENANCE,
    label: "維修中",
    tone: "danger",
    bookable: false,
    risk: "danger",
    riskLabel: "維修中",
    riderNotice: "維修中，不開放預約。",
    opsHint: "維修廠處理中，修復完成後回到可租。",
    transitions: [{ to: VEHICLE_STATUS.AVAILABLE, action: "修復完成" }],
  },
});

/** 狀態機的主線順序（ops.js 畫狀態流程用）。 */
export const STATUS_MAIN_LINE = Object.freeze([
  VEHICLE_STATUS.AVAILABLE,
  VEHICLE_STATUS.RESERVED,
  VEHICLE_STATUS.IN_USE,
  VEHICLE_STATUS.AI_REVIEW,
]);

/** AI 審核後的分支。 */
export const STATUS_BRANCH_LINE = Object.freeze([
  VEHICLE_STATUS.MANUAL_REVIEW,
  VEHICLE_STATUS.NOT_RECOMMENDED,
  VEHICLE_STATUS.MAINTENANCE,
]);

/** 讀到不認得的值時用這個 —— 優雅退化，不拋錯。 */
export const UNKNOWN_STATUS_META = Object.freeze({
  id: "unknown",
  label: "狀態待確認",
  tone: "warn",
  bookable: false,
  risk: "warn",
  riskLabel: "待確認",
  riderNotice: "車輛狀態待確認，建議改選其他車輛或聯繫客服。",
  opsHint: "收到無法解析的狀態值（見下方原值），已保守視為待確認。",
  transitions: [
    { to: VEHICLE_STATUS.AVAILABLE, action: "確認正常" },
    { to: VEHICLE_STATUS.MANUAL_REVIEW, action: "轉人工" },
  ],
});

/**
 * 別名 → 正式狀態。刻意寬鬆：Track B 的 inuse.js 不必知道我的常數名。
 */
const STATUS_ALIASES = Object.freeze({
  // available
  available: VEHICLE_STATUS.AVAILABLE, 可租: VEHICLE_STATUS.AVAILABLE,
  可出租: VEHICLE_STATUS.AVAILABLE, 正常: VEHICLE_STATUS.AVAILABLE,
  ok: VEHICLE_STATUS.AVAILABLE, free: VEHICLE_STATUS.AVAILABLE,
  idle: VEHICLE_STATUS.AVAILABLE, ready: VEHICLE_STATUS.AVAILABLE,
  rentable: VEHICLE_STATUS.AVAILABLE, normal: VEHICLE_STATUS.AVAILABLE,
  // reserved
  reserved: VEHICLE_STATUS.RESERVED, booked: VEHICLE_STATUS.RESERVED,
  booking: VEHICLE_STATUS.RESERVED, 待取車: VEHICLE_STATUS.RESERVED,
  已預約: VEHICLE_STATUS.RESERVED, pending_pickup: VEHICLE_STATUS.RESERVED,
  // in_use
  in_use: VEHICLE_STATUS.IN_USE, "in-use": VEHICLE_STATUS.IN_USE,
  inuse: VEHICLE_STATUS.IN_USE, using: VEHICLE_STATUS.IN_USE,
  rented: VEHICLE_STATUS.IN_USE, renting: VEHICLE_STATUS.IN_USE,
  租賃中: VEHICLE_STATUS.IN_USE, 使用中: VEHICLE_STATUS.IN_USE,
  // ai_review
  ai_review: VEHICLE_STATUS.AI_REVIEW, "ai-review": VEHICLE_STATUS.AI_REVIEW,
  aireview: VEHICLE_STATUS.AI_REVIEW, ai審核中: VEHICLE_STATUS.AI_REVIEW,
  審核中: VEHICLE_STATUS.AI_REVIEW, comparing: VEHICLE_STATUS.AI_REVIEW,
  // manual_review
  manual_review: VEHICLE_STATUS.MANUAL_REVIEW, manual: VEHICLE_STATUS.MANUAL_REVIEW,
  待人工: VEHICLE_STATUS.MANUAL_REVIEW, 人工審核: VEHICLE_STATUS.MANUAL_REVIEW,
  待審核: VEHICLE_STATUS.MANUAL_REVIEW, 待確認: VEHICLE_STATUS.MANUAL_REVIEW,
  已回報: VEHICLE_STATUS.MANUAL_REVIEW, reported: VEHICLE_STATUS.MANUAL_REVIEW,
  flagged: VEHICLE_STATUS.MANUAL_REVIEW, pending: VEHICLE_STATUS.MANUAL_REVIEW,
  pending_review: VEHICLE_STATUS.MANUAL_REVIEW, needs_review: VEHICLE_STATUS.MANUAL_REVIEW,
  review: VEHICLE_STATUS.MANUAL_REVIEW,
  // not_recommended
  not_recommended: VEHICLE_STATUS.NOT_RECOMMENDED,
  "not-recommended": VEHICLE_STATUS.NOT_RECOMMENDED,
  不建議出租: VEHICLE_STATUS.NOT_RECOMMENDED, 不建議預約: VEHICLE_STATUS.NOT_RECOMMENDED,
  blocked: VEHICLE_STATUS.NOT_RECOMMENDED, unavailable: VEHICLE_STATUS.NOT_RECOMMENDED,
  norent: VEHICLE_STATUS.NOT_RECOMMENDED, no_rent: VEHICLE_STATUS.NOT_RECOMMENDED,
  damaged: VEHICLE_STATUS.NOT_RECOMMENDED, damage: VEHICLE_STATUS.NOT_RECOMMENDED,
  unfit: VEHICLE_STATUS.NOT_RECOMMENDED,
  // maintenance
  maintenance: VEHICLE_STATUS.MAINTENANCE, repair: VEHICLE_STATUS.MAINTENANCE,
  repairing: VEHICLE_STATUS.MAINTENANCE, servicing: VEHICLE_STATUS.MAINTENANCE,
  維修中: VEHICLE_STATUS.MAINTENANCE, 保養中: VEHICLE_STATUS.MAINTENANCE,
});

/** 認不出精確別名時的模糊比對（順序有意義）。 */
const FUZZY_RULES = Object.freeze([
  [/維修|保養|repair|maint|servic/i, VEHICLE_STATUS.MAINTENANCE],
  [/不建議|not[_-]?rec|block|unavail|no[_-]?rent|損|damag|dent|scratch/i, VEHICLE_STATUS.NOT_RECOMMENDED],
  [/人工|manual|回報|report|flag|待確認|pending|review|dirty|髒/i, VEHICLE_STATUS.MANUAL_REVIEW],
  [/審核|verif|compar/i, VEHICLE_STATUS.AI_REVIEW],
  [/可租|available|free|idle|正常/i, VEHICLE_STATUS.AVAILABLE],
  [/租賃|使用中|in[_-]?use|rent/i, VEHICLE_STATUS.IN_USE],
  [/待取|reserv|book/i, VEHICLE_STATUS.RESERVED],
]);

/** 取得狀態 meta；未知一律回 UNKNOWN_STATUS_META（永不 undefined）。 */
export function statusMeta(statusId) {
  return STATUS_META[statusId] || UNKNOWN_STATUS_META;
}

/**
 * 把任何值解析成狀態。**永不拋錯。**
 * @returns {{ id: string, meta: object, recognized: boolean, raw: any, reason: string|null }}
 */
export function normalizeStatus(value) {
  const empty = { id: null, meta: null, recognized: false, raw: value, reason: null };
  if (value == null || value === "") return empty;

  // 物件形式 { status, reason?, at? }
  if (typeof value === "object") {
    const inner = value.status ?? value.id ?? value.state ?? value.value ?? null;
    const nested = normalizeStatus(inner);
    return {
      ...nested,
      raw: value,
      reason: value.reason ?? value.note ?? nested.reason ?? null,
    };
  }

  const raw = String(value).trim();
  if (!raw) return empty;

  const key = raw.toLowerCase().replace(/\s+/g, "_");
  const exact = STATUS_ALIASES[key] || STATUS_ALIASES[raw];
  if (exact) return { id: exact, meta: statusMeta(exact), recognized: true, raw: value, reason: null };

  for (const [pattern, mapped] of FUZZY_RULES) {
    if (pattern.test(raw)) {
      return { id: mapped, meta: statusMeta(mapped), recognized: true, raw: value, reason: null };
    }
  }
  // 認不出來 → 保守退化，畫面照實顯示原值
  return { id: "unknown", meta: UNKNOWN_STATUS_META, recognized: false, raw: value, reason: null };
}

// ==========================================================================
// 車隊（模擬資料）
// ==========================================================================

/**
 * iRent 2026 路邊租還車款（PRIUS C / YARIS / VIOS / FIT油電 / ALTIS /
 * ALTIS油電 / COROLLA CROSS / COROLLA CROSS油電），里程費 3.4 或 3.5 元/km。
 *
 * ⚠️ 車牌一律使用 `DEMO-xxxx`（真實台灣車牌是三碼英文），確保不會撞到真車。
 * ⚠️ 所有 AI 判讀數值（整潔度、舊損標記）都是模擬資料。
 *
 * `knownDamages[].pos` 是俯視圖的 viewBox 座標（120 × 220，車頭朝上）。
 */
export const FLEET = Object.freeze([
  {
    id: "irent-0731", // ← 與 state.js MOCK_VEHICLE.id 相同 = 本次 demo 車輛
    plate: "DEMO-1101",
    model: "YARIS",
    trim: "1.5 汽油",
    energy: "gas",
    color: "白",
    station: "台北車站西三門",
    mileageFee: 3.4,
    fuel: 78,
    status: VEHICLE_STATUS.RESERVED,
    cleanliness: 4.4,
    lastReturnAt: "2026-08-04T08:52:00",
    knownDamages: [
      {
        part: "右後保桿",
        desc: "約 5cm 刮痕",
        level: "minor",
        pos: { x: 97, y: 190 },
        firstSeen: "2026-07-28T19:14:00",
      },
      {
        part: "左後門下緣",
        desc: "小凹痕（約 3cm）",
        level: "minor",
        pos: { x: 23, y: 150 },
        firstSeen: "2026-08-01T12:40:00",
      },
      {
        part: "前擋玻璃右下",
        desc: "石擊點，未擴散",
        level: "watch",
        pos: { x: 80, y: 50 },
        firstSeen: "2026-08-04T08:52:00",
      },
    ],
    mockReports: [],
  },
  {
    id: "irent-0866",
    plate: "DEMO-1188",
    model: "ALTIS 油電",
    trim: "1.8 HYBRID",
    energy: "hybrid",
    color: "銀",
    station: "台北車站東三門",
    mileageFee: 3.5,
    fuel: 92,
    status: VEHICLE_STATUS.AVAILABLE,
    cleanliness: 4.8,
    lastReturnAt: "2026-08-04T07:35:00",
    knownDamages: [],
    mockReports: [],
  },
  {
    id: "irent-0912",
    plate: "DEMO-2033",
    model: "COROLLA CROSS 油電",
    trim: "1.8 HYBRID",
    energy: "hybrid",
    color: "灰",
    station: "南港車站 B1",
    mileageFee: 3.5,
    fuel: 64,
    status: VEHICLE_STATUS.AVAILABLE,
    cleanliness: 4.1,
    lastReturnAt: "2026-08-03T21:08:00",
    knownDamages: [
      {
        part: "右前葉子板",
        desc: "淺刮痕",
        level: "minor",
        pos: { x: 98, y: 62 },
        firstSeen: "2026-07-19T10:02:00",
      },
    ],
    mockReports: [],
  },
  {
    id: "irent-0704",
    plate: "DEMO-1642",
    model: "VIOS",
    trim: "1.5 汽油",
    energy: "gas",
    color: "白",
    station: "松山車站停車場",
    mileageFee: 3.4,
    fuel: 45,
    status: VEHICLE_STATUS.IN_USE,
    cleanliness: 4.0,
    lastReturnAt: "2026-08-04T06:20:00",
    knownDamages: [],
    mockReports: [],
  },
  {
    id: "irent-0623",
    plate: "DEMO-1330",
    model: "ALTIS",
    trim: "1.8 汽油",
    energy: "gas",
    color: "黑",
    station: "中山國中站",
    mileageFee: 3.4,
    fuel: 52,
    status: VEHICLE_STATUS.AI_REVIEW,
    cleanliness: 3.9,
    lastReturnAt: "2026-08-04T10:41:00",
    knownDamages: [],
    mockReports: [],
  },
  {
    id: "irent-0450",
    plate: "DEMO-2517",
    model: "FIT 油電",
    trim: "e:HEV",
    energy: "hybrid",
    color: "藍",
    station: "大坪林站 1 號出口",
    mileageFee: 3.5,
    fuel: 88,
    status: VEHICLE_STATUS.MANUAL_REVIEW,
    cleanliness: 2.6,
    lastReturnAt: "2026-08-04T09:26:00",
    knownDamages: [],
    mockReports: [
      {
        id: "mock_rep_0450",
        at: "2026-08-04T09:31:00",
        type: "dirty",
        note: "後座飲料翻倒、有異味；AI 判定髒污，待人工確認是否需清潔派工",
        photoCount: 2,
        by: "上一位使用者",
      },
    ],
  },
  {
    id: "irent-0588",
    plate: "DEMO-3079",
    model: "PRIUS C",
    trim: "1.5 HYBRID",
    energy: "hybrid",
    color: "白",
    station: "板橋車站西側",
    mileageFee: 3.5,
    fuel: 30,
    status: VEHICLE_STATUS.NOT_RECOMMENDED,
    cleanliness: 3.2,
    lastReturnAt: "2026-08-03T18:55:00",
    knownDamages: [
      {
        part: "左前門板",
        desc: "凹陷 + 刮漆，約 15cm",
        level: "major",
        pos: { x: 22, y: 92 },
        firstSeen: "2026-08-03T18:55:00",
      },
    ],
    mockReports: [
      {
        id: "mock_rep_0588",
        at: "2026-08-03T18:55:00",
        type: "damage",
        note: "使用中回報左前門板被他車擦撞，已附照片；AI 初判為明顯新增損傷",
        photoCount: 3,
        by: "上一位使用者",
      },
    ],
  },
  {
    id: "irent-0377",
    plate: "DEMO-4204",
    model: "COROLLA CROSS",
    trim: "1.8 汽油",
    energy: "gas",
    color: "銀",
    station: "內湖科技園區",
    mileageFee: 3.4,
    fuel: 100,
    status: VEHICLE_STATUS.MAINTENANCE,
    cleanliness: 4.6,
    lastReturnAt: "2026-08-02T14:12:00",
    knownDamages: [],
    mockReports: [
      {
        id: "mock_rep_0377",
        at: "2026-08-02T14:20:00",
        type: "damage",
        note: "後保桿裂痕，已派工至協力廠，預計 8/5 完修",
        photoCount: 1,
        by: "營運巡檢",
      },
    ],
  },
]);

/** Wave 1 `MOCK_VEHICLE` 的預設車牌（看起來像真牌，開場時換成 DEMO-xxxx）。 */
const WAVE1_DEFAULT_PLATE = "RAE-3721";

const REPORT_TYPE_LABELS = Object.freeze({
  damage: "車損",
  dirty: "髒污",
  smell: "異味",
  trash: "垃圾",
  fuel: "油量不足",
  battery: "電量不足",
  tire: "胎壓／輪胎",
  other: "其他",
});

/** 舊損嚴重度。 */
const DAMAGE_LEVELS = Object.freeze({
  minor: { label: "輕微", tone: "warn" },
  watch: { label: "注意", tone: "warn" },
  major: { label: "明顯", tone: "danger" },
});

// ==========================================================================
// 單一真相：把靜態車隊 + session 即時資料合成「現在的車隊」
// ==========================================================================

/**
 * 把 Wave 1 的預設車牌換成明顯是假的 DEMO 車牌（只做一次，且只在還是預設值時）。
 * 理由：`RAE-3721` 是合法的台灣車牌格式，可能撞到真車；demo 一律用 `DEMO-xxxx`。
 * 這是本檔案唯一會改寫 `session.vehicle` 的地方，且走 state.patch（合法寫入口）。
 */
export function ensureDemoVehicle(state) {
  const v = state.session.vehicle;
  if (!v || v.plate !== WAVE1_DEFAULT_PLATE) return v;
  const entry = FLEET.find((f) => f.id === v.id) || FLEET[0];
  state.patch({ vehicle: { ...v, plate: entry.plate, model: entry.model } });
  return state.session.vehicle;
}

function getOverrides(state) {
  const raw = state.getFlag("fleetStatusOverrides", null);
  return raw && typeof raw === "object" ? raw : {};
}

/** session 沒有明確狀態時，從照片 / 開鎖旗標推導本車狀態。 */
function deriveSelfStatus(session) {
  if ((session.returnCaptures || []).length > 0) return VEHICLE_STATUS.AI_REVIEW;
  if (session.flags?.unlockedAt || (session.supplementCaptures || []).length > 0) {
    return VEHICLE_STATUS.IN_USE;
  }
  return VEHICLE_STATUS.RESERVED;
}

/**
 * 解析某一台車「現在」的狀態。
 * 優先序：本車的 flags.vehicleStatus → 每車 override → 靜態車隊值／推導值
 * @returns {{ id, meta, source: 'flag'|'override'|'derived'|'fleet', recognized, raw, reason }}
 */
export function resolveStatus(state, vehicleId) {
  const session = state.session;
  const isSelf = vehicleId === session.vehicle?.id;

  if (isSelf) {
    const parsed = normalizeStatus(session.flags?.vehicleStatus);
    if (parsed.id) return { ...parsed, source: "flag" };
  }
  const parsedOverride = normalizeStatus(getOverrides(state)[vehicleId]);
  if (parsedOverride.id) return { ...parsedOverride, source: "override" };

  if (isSelf) {
    const derived = deriveSelfStatus(session);
    return {
      id: derived,
      meta: statusMeta(derived),
      recognized: true,
      raw: null,
      reason: null,
      source: "derived",
    };
  }
  const entry = FLEET.find((f) => f.id === vehicleId);
  const fallback = entry?.status || VEHICLE_STATUS.AVAILABLE;
  return {
    id: fallback,
    meta: statusMeta(fallback),
    recognized: true,
    raw: null,
    reason: null,
    source: "fleet",
  };
}

function normalizeReport(report) {
  const type = String(report?.type || "other");
  return {
    id: report?.id || "",
    at: report?.at || null,
    type,
    typeLabel: REPORT_TYPE_LABELS[type] || type,
    note: report?.note || "",
    photoCount: Array.isArray(report?.photoIds)
      ? report.photoIds.length
      : Number(report?.photoCount) || 0,
    by: report?.by || "本次使用者",
  };
}

/**
 * 風險評估 —— 決定「下一位使用者在預約清單會看到什麼」。
 *
 * 關鍵：**只要有使用者回報，就算狀態值還沒被寫入，也一定升級成可見風險。**
 * 這樣「回報 → 下一位看得到」不會因為某個 track 忘了設 flag 而斷掉。
 */
export function assessRisk(statusInfo, reports) {
  const meta = statusInfo.meta || UNKNOWN_STATUS_META;
  const risk = {
    level: meta.risk,
    label: meta.riskLabel,
    riderNotice: meta.riderNotice,
    bookable: meta.bookable,
    escalated: false,
  };
  if (reports.length && risk.level === "ok") {
    const hard = reports.some((r) => r.type === "damage");
    risk.level = hard ? "danger" : "warn";
    risk.label = hard ? "不建議預約" : "待確認";
    risk.bookable = false;
    risk.escalated = true;
    risk.riderNotice = hard
      ? `使用者已回報車損（${reports[0].typeLabel}），營運端確認中，暫不開放預約。`
      : `使用者已回報車況（${reports[0].typeLabel}），營運端確認中，暫不開放預約。`;
  }
  if (!statusInfo.recognized && statusInfo.raw != null) risk.escalated = true;
  return risk;
}

function cleanlinessLabel(score) {
  if (!Number.isFinite(score)) return "無資料";
  if (score >= 4.5) return "很乾淨";
  if (score >= 4) return "良好";
  if (score >= 3.4) return "尚可";
  if (score >= 2.5) return "偏髒";
  return "需清理";
}

/** 從 session.vehicle 合成車隊項目（session 車輛不在 FLEET 時的保險）。 */
function synthesizeSelfEntry(session) {
  const v = session.vehicle || {};
  return {
    id: v.id || "session-vehicle",
    plate: v.plate || "DEMO-0000",
    model: v.model || "未知車型",
    trim: "",
    energy: "gas",
    color: v.color || "—",
    station: v.station || "—",
    mileageFee: 3.4,
    fuel: Number.isFinite(v.fuel) ? v.fuel : 0,
    status: VEHICLE_STATUS.RESERVED,
    cleanliness: NaN,
    lastReturnAt: null,
    knownDamages: [],
    mockReports: [],
  };
}

/**
 * **`vehicle.js` 與 `ops.js` 共用的唯一真相入口。**
 * 回傳「現在的車隊」：靜態模擬資料 + session 即時狀態 / 回報。
 * @returns {Array<object>} 每筆含 { ...車輛, self, status, risk, reports, cleanlinessLabel }
 */
export function getFleet(state) {
  const session = state.session;
  const selfId = session.vehicle?.id;
  const base = FLEET.slice();
  if (selfId && !base.some((f) => f.id === selfId)) base.unshift(synthesizeSelfEntry(session));

  return base.map((entry) => {
    const self = entry.id === selfId;
    const status = resolveStatus(state, entry.id);
    const reports = (self ? session.reports || [] : entry.mockReports || []).map(normalizeReport);
    const vehicleFields = self
      ? {
          plate: session.vehicle?.plate || entry.plate,
          model: session.vehicle?.model || entry.model,
          station: session.vehicle?.station || entry.station,
          fuel: Number.isFinite(session.vehicle?.fuel) ? session.vehicle.fuel : entry.fuel,
        }
      : {};
    return {
      ...entry,
      ...vehicleFields,
      self,
      status,
      reports,
      risk: assessRisk(status, reports),
      cleanlinessLabel: cleanlinessLabel(entry.cleanliness),
    };
  });
}

/**
 * 寫入車輛狀態（唯一入口）。
 * 本車寫 `flags.vehicleStatus`；其他車寫 `flags.fleetStatusOverrides[id]`。
 * @param {object} state ctx.state
 * @param {string} vehicleId
 * @param {string|null} value 狀態值（可用別名）；null = 清除，回到推導值
 */
export function setVehicleStatus(state, vehicleId, value, detail = {}) {
  const parsed = normalizeStatus(value);
  const isSelf = vehicleId === state.session.vehicle?.id;
  /**
   * 寫回去時一律存**中文標籤**（可租 / 待人工 / 不建議出租 …）。
   * 理由：Track B 的 inuse.js 也讀 `flags.vehicleStatus`，而它的常數就是中文字面值。
   * 中文標籤兩邊都看得懂（我這邊 normalizeStatus 照樣解析得出來），互通性最好。
   * 認不出來的值原樣保留，讓畫面可以照實顯示原值。
   */
  const stored =
    parsed.id && parsed.id !== "unknown" ? statusMeta(parsed.id).label : value ?? null;

  if (isSelf) {
    state.setFlag("vehicleStatus", value == null ? null : stored);
  } else {
    const next = { ...getOverrides(state) };
    if (value == null) delete next[vehicleId];
    else next[vehicleId] = stored;
    state.setFlag("fleetStatusOverrides", next);
  }

  const entry = FLEET.find((f) => f.id === vehicleId);
  const plate = isSelf ? state.session.vehicle?.plate : entry?.plate;
  const meta = parsed.id ? statusMeta(parsed.id) : null;
  state.addEvent(EVENTS.VEHICLE_STATUS, {
    label: `${plate || vehicleId} 狀態 → ${meta ? meta.label : "回到自動推導"}`,
    vehicleId,
    status: parsed.id,
    rawStatus: value ?? null,
    ...detail,
  });
  return parsed;
}

/** 把解析出的狀態標籤同步回 `session.vehicle.status`（讓其他 track 讀得到）。 */
export function syncSessionVehicleStatus(state, selfEntry) {
  const label = selfEntry?.status?.meta?.label;
  if (!label) return;
  const v = state.session.vehicle;
  if (!v || v.status === label) return;
  state.patch({ vehicle: { ...v, status: label } });
}

// ==========================================================================
// 共用 CSS（ops.js 也會把這段併進自己的 css export）
// ==========================================================================

export const FLEET_CSS = `
.fleet-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
  background: var(--surface-2); color: var(--muted); border: 1px solid var(--line);
}
.fleet-pill.ok { background: rgba(0,194,168,.16); color: #6dd4c7; border-color: rgba(0,194,168,.45); }
.fleet-pill.warn { background: rgba(245,166,35,.16); color: var(--warn); border-color: rgba(245,166,35,.5); }
.fleet-pill.danger { background: rgba(255,107,107,.16); color: var(--danger); border-color: rgba(255,107,107,.5); }
.fleet-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }

.fleet-mock {
  display: inline-block; padding: 1px 6px; border-radius: 999px;
  border: 1px dashed #4a5a70; color: var(--muted);
  font-size: 10px; font-weight: 500; white-space: nowrap; vertical-align: middle;
}

.fleet-topview { width: 100%; max-width: 132px; height: auto; display: block; }
.fleet-topview .fc-body { fill: #223047; stroke: #46586f; stroke-width: 1.5; }
.fleet-topview .fc-glass { fill: #16202c; stroke: #46586f; stroke-width: 1; }
.fleet-topview .fc-wheel { fill: #12181f; stroke: #46586f; stroke-width: 1; }
.fleet-topview .fc-axis { fill: var(--muted); font-size: 9px; }
.fleet-topview .fc-mark { stroke: #0f1419; stroke-width: 1.2; }
.fleet-topview .fc-mark.warn { fill: var(--warn); }
.fleet-topview .fc-mark.danger { fill: var(--danger); }
.fleet-topview .fc-num { fill: #1a1200; font-size: 9px; font-weight: 700; }

.fleet-raw {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; color: var(--muted);
  overflow-wrap: anywhere; word-break: break-word;
}
`;

// ==========================================================================
// Screen 0 專屬 CSS
// ==========================================================================

export const css = `
${FLEET_CSS}

.vh-mock-note {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 11px; color: var(--muted); margin: 0 0 10px;
}

.vh-card { margin: 12px 0; }
.vh-head { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
.vh-model { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.25; }
.vh-plate {
  display: inline-block; margin-top: 4px; padding: 2px 8px;
  border: 1px solid #46586f; border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; letter-spacing: .06em;
}
.vh-pills { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: 0 0 auto; }
.vh-sub { margin: 8px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
.vh-nb { white-space: nowrap; }

.vh-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.vh-metric { background: var(--surface-2); border-radius: 10px; padding: 8px; min-width: 0; }
.vh-metric dt { font-size: 10px; color: var(--muted); margin-bottom: 3px; }
.vh-metric dd { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.2; }
.vh-metric small { display: block; font-size: 10px; font-weight: 500; color: var(--muted); margin-top: 2px; }
.vh-gauge { height: 4px; border-radius: 2px; background: #16202c; margin-top: 6px; overflow: hidden; }
.vh-gauge i { display: block; height: 100%; background: var(--accent); }
.vh-gauge.low i { background: var(--warn); }

.vh-damage { display: flex; gap: 12px; margin-top: 12px; align-items: flex-start; }
.vh-damage-map { flex: 0 0 110px; max-width: 110px; }
.vh-damage-list { flex: 1 1 auto; min-width: 0; margin: 0; padding: 0; list-style: none; }
.vh-damage-list li { display: flex; gap: 7px; padding: 5px 0; border-bottom: 1px dashed #2a3545; }
.vh-damage-list li:last-child { border-bottom: none; }
.vh-damage-num {
  flex: 0 0 16px; height: 16px; border-radius: 50%;
  font-size: 10px; font-weight: 700; text-align: center; line-height: 16px;
  background: var(--warn); color: #1a1200;
}
.vh-damage-num.danger { background: var(--danger); color: #2b0000; }
.vh-damage-text { min-width: 0; font-size: 12px; line-height: 1.45; }
.vh-damage-text strong { font-weight: 600; }
.vh-damage-text span { display: block; color: var(--muted); font-size: 11px; }

.vh-why { border-color: rgba(0,194,168,.35); background: linear-gradient(150deg, #16303a, #1a2332); }
.vh-why-lead { margin: 0 0 10px; font-size: 13px; line-height: 1.55; }
.vh-why-lead strong { color: var(--accent); }
.vh-why-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
.vh-why-list li { display: flex; gap: 9px; }
.vh-why-ico { flex: 0 0 20px; font-size: 15px; line-height: 1.3; }
.vh-why-body { min-width: 0; }
.vh-why-body b { display: block; font-size: 13px; margin-bottom: 2px; }
.vh-why-body p { margin: 0; font-size: 12px; color: var(--muted); line-height: 1.5; }

.vh-swap { margin-top: 4px; }
.vh-swap-list { display: flex; flex-direction: column; gap: 8px; }
.vh-swap-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px; border-radius: 10px; text-align: left;
  background: var(--surface-2); border: 1px solid var(--line);
  color: var(--text); font-family: inherit; font-size: 13px; cursor: pointer;
}
.vh-swap-item:active { border-color: var(--accent); }
.vh-swap-main { flex: 1 1 auto; min-width: 0; }
.vh-swap-main b { display: block; font-weight: 600; }
.vh-swap-main span { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
`;

// ==========================================================================
// 渲染 helper
// ==========================================================================

/** 狀態 pill（ops.js 也用同一個，兩頁的標籤才會一致）。 */
export function statusPill(entry) {
  const meta = entry.status.meta;
  const tone = meta.tone ? ` ${meta.tone}` : "";
  return `<span class="fleet-pill${tone}"><i class="fleet-dot"></i>${escapeHtml(meta.label)}</span>`;
}

/** 風險標籤 pill（沒有風險時回空字串）。 */
export function riskPill(entry) {
  if (!entry.risk.label) return "";
  return `<span class="fleet-pill ${entry.risk.level}">⚠ ${escapeHtml(entry.risk.label)}</span>`;
}

/** 俯視圖 + 舊損標記點。 */
export function topView(damages = []) {
  const marks = damages
    .map((d, i) => {
      const tone = DAMAGE_LEVELS[d.level]?.tone || "warn";
      const { x, y } = d.pos || { x: 60, y: 110 };
      return `
        <circle class="fc-mark ${tone}" cx="${x}" cy="${y}" r="8" />
        <text class="fc-num" x="${x}" y="${y + 3}" text-anchor="middle">${i + 1}</text>`;
    })
    .join("");
  return `
    <svg class="fleet-topview" viewBox="0 0 120 220" role="img"
         aria-label="車輛俯視圖，標記 ${damages.length} 處已知舊損">
      <rect class="fc-wheel" x="9" y="46" width="11" height="26" rx="4" />
      <rect class="fc-wheel" x="100" y="46" width="11" height="26" rx="4" />
      <rect class="fc-wheel" x="9" y="150" width="11" height="26" rx="4" />
      <rect class="fc-wheel" x="100" y="150" width="11" height="26" rx="4" />
      <rect class="fc-body" x="17" y="8" width="86" height="204" rx="32" />
      <path class="fc-glass" d="M31 64 H89 L81 40 H39 Z" />
      <path class="fc-glass" d="M31 156 H89 L81 180 H39 Z" />
      <rect class="fc-glass" x="35" y="72" width="50" height="76" rx="7" />
      <text class="fc-axis" x="60" y="6" text-anchor="middle">前</text>
      <text class="fc-axis" x="60" y="218" text-anchor="middle">後</text>
      ${marks}
    </svg>`;
}

function damageList(damages) {
  if (!damages.length) {
    return `<p class="muted" style="margin:0">上一輪還車紀錄中沒有已知舊損。</p>`;
  }
  return `<ul class="vh-damage-list">
    ${damages
      .map((d, i) => {
        const lv = DAMAGE_LEVELS[d.level] || DAMAGE_LEVELS.minor;
        return `<li>
          <span class="vh-damage-num${lv.tone === "danger" ? " danger" : ""}">${i + 1}</span>
          <span class="vh-damage-text">
            <strong>${escapeHtml(d.part)}</strong>　${escapeHtml(lv.label)}
            <span>${escapeHtml(d.desc)}・首次記錄 ${escapeHtml(shortDate(d.firstSeen))}</span>
          </span>
        </li>`;
      })
      .join("")}
  </ul>`;
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(d)}`;
}

function reportLines(entry) {
  if (!entry.reports.length) return "";
  return `<div class="notice ${entry.risk.level === "danger" ? "danger" : "warn"}">
    <strong>已有車況回報（${entry.reports.length} 筆）</strong>
    ${entry.reports
      .map(
        (r) =>
          `<p style="margin:4px 0 0">${escapeHtml(r.typeLabel)}・${escapeHtml(
            shortDate(r.at)
          )}<br>${escapeHtml(r.note || "（無說明）")}</p>`
      )
      .join("")}
  </div>`;
}

// ==========================================================================
// mount
// ==========================================================================

export function mount(root, ctx) {
  const { state, points } = ctx;
  ensureDemoVehicle(state);

  let showSwap = false;

  const pickupRule = points.getRule("pickup_complete");
  const pickupPoints = pickupRule?.points ?? 0;
  const pickupTwd = points.pointsToTwd(pickupPoints);

  function render() {
    const fleet = getFleet(state);
    const self = fleet.find((v) => v.self) || fleet[0];
    syncSessionVehicleStatus(state, self);

    const candidates = fleet.filter((v) => !v.self && v.risk.bookable);
    const risky = self.risk.level !== "ok";
    const fuelLow = self.fuel < 25;

    ctx.setHeader({
      title: "取車前車況預告",
      subtitle: `${self.model} · ${self.station}`,
    });

    root.innerHTML = `
      <p class="vh-mock-note">
        <span class="fleet-mock">模擬資料</span>
        以下車況判讀、整潔度評分與舊損標記皆為 demo 模擬，未接後端。
      </p>

      <section class="card vh-card">
        <div class="vh-head">
          <div style="min-width:0">
            <h2 class="vh-model">${escapeHtml(self.model)}${
              self.trim ? `　<span class="muted" style="font-size:12px">${escapeHtml(self.trim)}</span>` : ""
            }</h2>
            <span class="vh-plate">${escapeHtml(self.plate)}</span>
          </div>
          <div class="vh-pills">
            ${statusPill(self)}
            ${riskPill(self)}
          </div>
        </div>
        <p class="vh-sub">
          ${escapeHtml(self.station)}・${escapeHtml(self.color)}色・<span class="vh-nb">路邊租還</span><br>
          <span class="vh-nb">里程費 ${self.mileageFee} 元/km</span>${
            self.energy === "hybrid" ? `・<span class="vh-nb">油電車款</span>` : ""
          }・<span class="vh-nb">上一輪還車 ${escapeHtml(shortDate(self.lastReturnAt))}</span>
        </p>

        <dl class="vh-metrics">
          <div class="vh-metric">
            <dt>整潔度 <span class="fleet-mock">模擬</span></dt>
            <dd>${Number.isFinite(self.cleanliness) ? self.cleanliness.toFixed(1) : "—"}<small>${escapeHtml(
              self.cleanlinessLabel
            )}</small></dd>
          </div>
          <div class="vh-metric">
            <dt>${self.energy === "hybrid" ? "油量（油電）" : "油量"}</dt>
            <dd>${self.fuel}%<small>${fuelLow ? "建議加油" : "足夠一般行程"}</small></dd>
            <div class="vh-gauge${fuelLow ? " low" : ""}"><i style="width:${Math.max(
              2,
              Math.min(100, self.fuel)
            )}%"></i></div>
          </div>
          <div class="vh-metric">
            <dt>已知舊損</dt>
            <dd>${self.knownDamages.length} 處<small>${
              self.knownDamages.length ? "已記錄在案" : "無紀錄"
            }</small></dd>
          </div>
        </dl>

        <div class="vh-damage">
          <div class="vh-damage-map">${topView(self.knownDamages)}</div>
          <div class="vh-damage-list-wrap" style="flex:1 1 auto;min-width:0">
            <p class="muted" style="margin:0 0 4px">
              已知舊損位置 <span class="fleet-mock">AI 綜合上一輪還車紀錄・模擬</span>
            </p>
            ${damageList(self.knownDamages)}
          </div>
        </div>
      </section>

      ${
        risky
          ? `<div class="notice ${self.risk.level}">
              <strong>⚠ ${escapeHtml(self.risk.label || "待確認")}</strong><br>
              ${escapeHtml(self.risk.riderNotice)}
              ${
                self.status.recognized === false && self.status.raw != null
                  ? `<br><span class="fleet-raw">（收到未定義的狀態值：${escapeHtml(
                      JSON.stringify(self.status.raw)
                    )}，已保守視為待確認）</span>`
                  : ""
              }
            </div>`
          : `<div class="notice ok">車輛狀態正常，可依預約時間取車。營運端若在你取車前收到車況回報，這裡會即時變成風險標籤。</div>`
      }
      ${reportLines(self)}

      <section class="card vh-why">
        <h2 class="section-title">🛡️ 為什麼要你先花 40 秒拍照？</h2>
        <p class="vh-why-lead">
          上面這 ${self.knownDamages.length} 處舊損<strong>已經記錄在案</strong>。
          你等一下拍的四角照片會成為<strong>你自己的租前基準</strong> ——
          還車時 AI 只比對「新增」的部分。
        </p>
        <ul class="vh-why-list">
          <li>
            <span class="vh-why-ico">🛡️</span>
            <span class="vh-why-body">
              <b>證明損傷不是你造成的</b>
              <p>租前拍照 = 把「本來就有的損傷」定格在你取車那一刻。日後被追究時，這是<em>你的</em>證據。</p>
            </span>
          </li>
          <li>
            <span class="vh-why-ico">🤝</span>
            <span class="vh-why-body">
              <b>也保護你的還車</b>
              <p>還車前再拍一次，證明你交還時車況正常，不會被下一位使用者造成的損傷賴到你頭上。</p>
            </span>
          </li>
          <li>
            <span class="vh-why-ico">⭐</span>
            <span class="vh-why-body">
              <b>順手還有積分（次要動機）</b>
              <p>${escapeHtml(pickupRule?.label || "取車拍照完整")} +${pickupPoints} 積分，
              約可折抵 NT$${pickupTwd}（假設值：${escapeHtml(points.POINT_VALUE_ASSUMPTION)}）。</p>
            </span>
          </li>
        </ul>
      </section>

      <div class="actions">
        ${
          risky
            ? `<button type="button" class="btn primary full" data-act="swap">換一台可租車輛（${candidates.length}）</button>
               <button type="button" class="btn secondary" data-act="go">我仍要取這台，開始拍照</button>`
            : `<button type="button" class="btn primary full" data-act="go">繼續取車，開始四角拍照</button>
               <button type="button" class="btn secondary" data-act="swap">換一台（${candidates.length} 台可租）</button>`
        }
      </div>
      ${
        risky
          ? `<p class="footnote" style="margin-top:8px">非阻擋設計：即使有風險標籤，你仍可選擇取這台；回報紀錄會一併附進你的租前基準。</p>`
          : ""
      }

      ${
        showSwap
          ? `<section class="card vh-swap">
              <h2 class="section-title">換一台 <span class="fleet-mock">模擬車隊</span></h2>
              <p class="muted" style="margin:0 0 8px">
                只列出營運端狀態為「可租」的車。改選會清空目前的租前照片（新車＝新基準）。
              </p>
              <div class="vh-swap-list">
                ${
                  candidates.length
                    ? candidates
                        .map(
                          (v) => `
                        <button type="button" class="vh-swap-item" data-act="pick" data-vid="${escapeHtml(v.id)}">
                          <span class="vh-swap-main">
                            <b>${escapeHtml(v.model)}　${escapeHtml(v.plate)}</b>
                            <span>${escapeHtml(v.station)}・油量 ${v.fuel}%・整潔度 ${
                              Number.isFinite(v.cleanliness) ? v.cleanliness.toFixed(1) : "—"
                            }・舊損 ${v.knownDamages.length} 處</span>
                          </span>
                          ${statusPill(v)}
                        </button>`
                        )
                        .join("")
                    : `<p class="empty">目前沒有其他可租車輛（模擬資料）。</p>`
                }
              </div>
              <div class="actions">
                <button type="button" class="btn secondary" data-act="closeSwap">收起</button>
              </div>
            </section>`
          : ""
      }
    `;

    ctx.setFootnote(
      "Screen 0（PIG-13）· 車況預告與風險標籤與營運視角（#/ops）讀同一份資料；" +
        "所有 AI 判讀為模擬資料。"
    );
  }

  /** 換車：把車隊項目寫回 session.vehicle（新車 = 新基準）。 */
  function pickVehicle(vehicleId) {
    const entry = FLEET.find((f) => f.id === vehicleId);
    if (!entry) return;
    const prev = state.session.vehicle;
    const prevEntry = getFleet(state).find((v) => v.self);
    state.patch({
      vehicle: {
        ...prev,
        id: entry.id,
        plate: entry.plate,
        model: entry.model,
        color: entry.color,
        station: entry.station,
        fuel: entry.fuel,
        status: statusMeta(entry.status).label,
      },
    });
    // 新車 → 舊的 flags.vehicleStatus 不再適用，但舊車的狀態必須留在車隊裡：
    //   有風險 → 原封不動保留（這正是使用者換車的原因，營運端要看得到）
    //   無風險 → 取消預約，回到「可租」（待取車 --取消預約--> 可租）
    const overrides = { ...getOverrides(state) };
    if (prev?.id && prev.id !== entry.id) {
      overrides[prev.id] =
        prevEntry && (prevEntry.risk.level !== "ok" || prevEntry.status.source === "flag")
          ? prevEntry.status.id
          : VEHICLE_STATUS.AVAILABLE;
    }
    // 新車由這個 session 預約 → 交回 flag / 推導管理，不要留舊的營運覆寫
    delete overrides[entry.id];
    state.setFlag("fleetStatusOverrides", overrides);
    state.setFlag("vehicleStatus", null);
    if (state.getCaptures("pickup").length) state.clearCaptures("pickup");
    if (state.getCaptures("supplement").length) state.clearCaptures("supplement");
    state.addEvent(EVENTS.VEHICLE_PREVIEW, {
      label: `改選車輛：${prev?.plate || "—"} → ${entry.plate} ${entry.model}`,
      vehicleId: entry.id,
      reason: "取車前預告顯示風險，使用者改選其他車輛",
    });
    showSwap = false;
    render();
  }

  root.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "go") {
      ctx.go("capture", { phase: "pickup" });
    } else if (act === "swap") {
      showSwap = true;
      render();
    } else if (act === "closeSwap") {
      showSwap = false;
      render();
    } else if (act === "pick") {
      pickVehicle(btn.dataset.vid);
    }
  });

  // timeline：每個 session 只記一次「看過取車前預告」
  const session = state.session;
  const seen = session.timeline.some(
    (e) => e.type === EVENTS.VEHICLE_PREVIEW && e.detail?.vehicleId === session.vehicle?.id
  );
  if (!seen) {
    const self = getFleet(state).find((v) => v.self);
    state.addEvent(EVENTS.VEHICLE_PREVIEW, {
      label: `看過取車前車況預告：${session.vehicle?.plate || "—"}（${
        self?.status.meta.label || "—"
      }）`,
      vehicleId: session.vehicle?.id,
      knownDamages: self?.knownDamages.length ?? 0,
      status: self?.status.id,
    });
  }

  render();

  // 本畫面沒有 timer / document 層級 listener（root 上的 listener 由 router 清掉），
  // 仍回傳 cleanup 以符合契約。
  return () => {};
}
