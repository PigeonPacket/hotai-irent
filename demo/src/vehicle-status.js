/**
 * 車輛營運狀態機 —— **跨畫面共用的單一真相**（PIG-13 §4）
 * ==========================================================================
 * 這支檔案原本是 `screens/vehicle.js` 的一段，`screens/inuse.js` 另外有一份
 * 同名但值域與簽名都不同的實作（見 CONTRACT.md §10.1 記載的技術債）。
 * 兩份同名 export 是靜默故障的溫床，所以把**純狀態機**（常數、meta、別名解析）
 * 抽到這裡，兩支畫面都改成從這裡取，程式裡因此只剩一份定義。
 *
 * 這裡刻意**只放不依賴車隊資料與畫面的東西**：
 *   - `VEHICLE_STATUS` / `STATUS_META` / 主支線順序 / 未知狀態
 *   - `normalizeStatus()` 容錯解析（英文 id、中文標籤、別名、物件、模糊比對）
 *   - `statusMeta()` / `statusLabel()` / `statusBadgeClass()`
 *
 * 需要車隊的東西留在 `screens/vehicle.js`：`FLEET`、`getFleet()`、
 * `resolveStatus()`、`assessRisk()`、以及唯一的寫入口 `setVehicleStatus()`。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * `flags.vehicleStatus` 契約
 * ──────────────────────────────────────────────────────────────────────────
 * 寫入一律走 `screens/vehicle.js` 的
 *     setVehicleStatus(state, vehicleId, value, detail?)
 * （`screens/inuse.js` 也 re-export 同一個函式，兩邊拿到的是同一個實體。）
 *
 * 儲存格式：**中文標籤**（可租 / 待人工 / 不建議出租 …）。
 *   為什麼不存英文 id：舊 session 的 localStorage 裡存的就是中文標籤，
 *   換成 id 會讓已存檔的 session 讀不回來。`normalizeStatus()` 兩種都認得，
 *   所以正規值（比較、分支）用英文 id，儲存與顯示用中文標籤。
 *
 * 接受的值：
 *   1. `VEHICLE_STATUS` 的七個 id：available / reserved / in_use / ai_review /
 *      manual_review / not_recommended / maintenance
 *   2. 中文標籤：可租 / 待取車 / 租賃中 / AI審核中 / 待人工 / 不建議出租 / 維修中
 *   3. 常見別名（見 STATUS_ALIASES）：reported / flagged / damaged / repair / …
 *   4. 物件形式：`{ status, reason?, at? }`（status 走上面同一套解析）
 *   5. `null` / `undefined` = 未設定 → 由 session 推導（vehicle.js 的 deriveSelfStatus）
 *   6. 以上都不符 → 退化成 `unknown`：以「待確認」呈現、原值照實顯示、**不拋錯**。
 * ==========================================================================
 */

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

/**
 * 任何值 → 顯示用中文標籤。認不出來時原樣回傳（畫面照實顯示原值）。
 * 這是 UI 顯示狀態的**唯一**正確方式 —— 直接把 `flags.vehicleStatus` 或
 * `VEHICLE_STATUS.*` 印出來會依來源不同印出中文或英文 id，兩種都出現過。
 * @param {*} value
 * @param {string} [fallback] value 為空時回傳的字串
 */
export function statusLabel(value, fallback = "") {
  if (value == null || value === "") return fallback;
  const parsed = normalizeStatus(value);
  if (parsed.recognized && parsed.meta) return parsed.meta.label;
  return String(typeof value === "object" ? parsed.raw?.status ?? value : value);
}

/**
 * 任何值 → 共用 kit 的 badge class（`badge` / `badge ok` / `badge warn` / `badge danger`）。
 * 色調取自 `STATUS_META[].tone`，與 `statusPill()` 的 fleet-pill 同一份來源。
 */
export function statusBadgeClass(value) {
  const tone = normalizeStatus(value).meta?.tone;
  return tone ? `badge ${tone}` : "badge";
}
