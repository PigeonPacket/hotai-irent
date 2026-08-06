/**
 * 積分規則 —— 對齊 docs/PIG-13-UX-Flow.md §5。
 *
 * 設計原則：**規則集中成資料**（POINT_RULES），畫面模組只呼叫 evaluate* / award，
 * 不要在各自的畫面裡寫 `+20` 這種數字。
 *
 * 加新規則的做法（Wave 2）：
 *   1. 在 POINT_RULES 尾端加一筆 { id, points, label, exclusive?, once? }
 *   2. 在你的畫面裡 `ctx.state.awardPoints('your_rule_id', { ...meta })`
 *   3. 若同一階段只能取一個等第（例如「完整 +20」與「部分 +5」互斥），
 *      給它們相同的 `exclusive` 值，awardPoints 會自動替換舊的那筆
 *   ⚠️ 不要改既有規則的 id —— settlement / dispute 畫面會依 id 顯示。
 */

/**
 * @typedef {object} PointRule
 * @property {string} id        規則 id（穩定，勿改）
 * @property {number} points    積分
 * @property {string} label     顯示文案
 * @property {string} [stage]   所屬階段：pickup | supplement | return | report
 * @property {string} [exclusive] 互斥組；同組只保留最後一次授予的那筆
 * @property {boolean} [once]   是否只能授予一次（預設 true）
 * @property {string} [note]    備註 / 假設說明
 */

/** @type {ReadonlyArray<PointRule>} */
export const POINT_RULES = Object.freeze([
  {
    id: "pickup_complete",
    points: 20,
    label: "取車四角完整且品質達標",
    stage: "pickup",
    exclusive: "pickup",
    once: true,
    note: "品質達標 = 四角皆拍且無品質警告",
  },
  {
    id: "pickup_partial",
    points: 5,
    label: "取車拍照（有警告仍跳過）",
    stage: "pickup",
    exclusive: "pickup",
    once: true,
    note: "§5「亂拍通過」基礎分。假設：以「整組」計一次 5 分，不是每張 5 分",
  },
  {
    id: "supplement_complete",
    points: 10,
    label: "15 分鐘內完成補拍",
    stage: "supplement",
    exclusive: "supplement",
    once: true,
    note: "可與取車分數疊加；逾時不給",
  },
  {
    id: "return_complete",
    points: 20,
    label: "還車四角完整且品質達標",
    stage: "return",
    exclusive: "return",
    once: true,
  },
  {
    id: "return_partial",
    points: 5,
    label: "還車拍照（有警告仍跳過）",
    stage: "return",
    exclusive: "return",
    once: true,
  },
  {
    id: "honest_report",
    points: 5,
    label: "誠實申報損傷",
    stage: "report",
    once: false,
    note: "減刑激勵；每次申報各給一次",
  },
  // ------------------------------------------------------------------
  // 以下為後續 append（不改上面既有規則的 id 與分數）
  //
  // 「四角齊備但有品質警告」中間級 —— 修正一個**產品層級**的反向激勵：
  // 原本只有兩級（complete 20 / partial 5），而 isCaptureSetQualified() 是
  // all-or-nothing，於是
  //     四角全部按「先繼續」跳過        → partial 5 分
  //     四角都認真拍、其中一張光線偏暗  → partial 5 分   ← 平手
  // 兩者同分。使用者一旦發現「一張警告 = 全部跳過」，理性選擇就是全部跳過，
  // 這條規則會自己反打掉本原型的核心論證（notes/260702.md 7/2 實測第 2 點：
  // 目前 iRent 讓使用者可以隨便亂拍直接過關，我們要用動機讓他願意好好拍）。
  //
  // 分數 10 的理由：階梯設成 5 → 10 → 20（每級翻倍）。
  //   - 對「全部跳過」+5：湊齊四角一定嚴格優於什麼都不拍，努力有回報。
  //   - 對「品質達標」-10：最大的一段增幅掛在**品質**那一步，
  //     所以「把四角補齊」永遠不能替代「把每張拍好」，品質仍是主要誘因。
  // ------------------------------------------------------------------
  {
    id: "pickup_all_angles",
    points: 10,
    label: "取車四角齊備（有品質警告）",
    stage: "pickup",
    exclusive: "pickup",
    once: true,
    note: "四角都實際拍了、沒有跳過，但至少一張未通過品質檢查",
  },
  {
    id: "return_all_angles",
    points: 10,
    label: "還車四角齊備（有品質警告）",
    stage: "return",
    exclusive: "return",
    once: true,
    note: "同 pickup_all_angles",
  },
]);

const RULE_INDEX = new Map(POINT_RULES.map((r) => [r.id, r]));

export function getRule(id) {
  return RULE_INDEX.get(id) || null;
}

/**
 * 積分 → 可折抵金額。
 * ⚠️ 假設值（PIG-13 §5 寫「具體比例待商業設計」）：**1 積分 = NT$0.5**。
 * 也就是完整走完一輪 50 分 ≈ 折抵 NT$25。要改只改這裡。
 */
export const POINT_TO_TWD = 0.5;
export const POINT_VALUE_ASSUMPTION = "假設 1 積分 = NT$0.5（PIG-13 §5 待商業設計）";

export function pointsToTwd(points) {
  return Math.round(points * POINT_TO_TWD);
}

/** 把「已授予積分」陣列（state.session.points.awarded）加總。 */
export function totalOf(awarded = []) {
  return awarded.reduce((sum, entry) => sum + (entry.points || 0), 0);
}

/**
 * 判斷一組拍照是否「完整且品質達標」。
 * @param {Array} captures state.getCaptures(group) 的結果
 * @param {number} required 需要幾張（四角 = 4）
 */
export function isCaptureSetQualified(captures = [], required = 4) {
  const corners = captures.filter((c) => c.category === "corner");
  if (corners.length < required) return false;
  return corners.every((c) => !c.skipped && c.quality?.ok === true);
}

/**
 * 判斷一組拍照是否「四角齊備」—— 每一角都實際按了快門、沒有用「先繼續」跳過，
 * 但**不要求**品質檢查通過。
 *
 * 這是 `isCaptureSetQualified()` 的放寬版，用來把中間級跟「什麼都沒拍」分開。
 * @param {Array} captures
 * @param {number} required
 */
export function isCaptureSetCovered(captures = [], required = 4) {
  const corners = captures.filter((c) => c.category === "corner");
  if (corners.length < required) return false;
  return corners.every((c) => !c.skipped);
}

/** evaluateCaptureSet() 的等第（= 規則 id 的後綴，`${stage}_${tier}`）。 */
export const CAPTURE_TIERS = Object.freeze({
  COMPLETE: "complete",
  ALL_ANGLES: "all_angles",
  PARTIAL: "partial",
});

/**
 * 依 §5 評估一組四角拍照該拿哪一條規則。三級（分數見 POINT_RULES）：
 *
 *   complete    四角齊備且每張都通過品質檢查
 *   all_angles  四角齊備但至少一張有品質警告   ← 中間級，避免「有瑕疵」＝「全跳過」
 *   partial     其餘（有跳過的角 / 張數不足）
 *
 * @param {"pickup"|"return"} stage
 * @param {Array} captures
 * @param {number} required
 * @returns {{ rule: PointRule|null, points: number, qualified: boolean,
 *             covered: boolean, tier: string|null }}
 */
export function evaluateCaptureSet(stage, captures = [], required = 4) {
  const attempted = captures.length > 0;
  if (!attempted) {
    return { rule: null, points: 0, qualified: false, covered: false, tier: null };
  }
  const qualified = isCaptureSetQualified(captures, required);
  const covered = qualified || isCaptureSetCovered(captures, required);
  const tier = qualified
    ? CAPTURE_TIERS.COMPLETE
    : covered
      ? CAPTURE_TIERS.ALL_ANGLES
      : CAPTURE_TIERS.PARTIAL;
  const rule = getRule(`${stage}_${tier}`);
  return { rule, points: rule ? rule.points : 0, qualified, covered, tier };
}

/**
 * 某個等第在指定階段的分數合計 —— settlement 用它畫「分數階梯」，
 * 這樣規則 id 的組字串留在 points.js，畫面不用自己拼 `pickup_partial`。
 * @param {string} tier CAPTURE_TIERS 之一
 * @param {string[]} [stages] 預設取車＋還車兩段
 */
export function captureSetTierPoints(tier, stages = ["pickup", "return"]) {
  return stages.reduce((sum, stage) => sum + (getRule(`${stage}_${tier}`)?.points || 0), 0);
}

/**
 * 給 gallery 用的「預估積分」文字資料。
 * ⚠️ 與 Wave 1 之前的 PoC 不同：舊版是每張照片各算分（最高 80），
 *    本版依 §5 以「整組」計分（取車最高 20），因為 §5 的表格是階段級規則，
 *    而且 settlement 畫面要跟 timeline 的授予紀錄對得起來。
 */
export function estimateCaptureSetPoints(stage, captures = [], required = 4) {
  const { rule, points, qualified } = evaluateCaptureSet(stage, captures, required);
  return { rule, points, qualified, label: rule?.label ?? "尚未拍照" };
}

/** 一輪完整劇本的理論最高分（不含重複的誠實申報）。 */
export function maxAttainable() {
  return ["pickup_complete", "supplement_complete", "return_complete", "honest_report"]
    .map((id) => getRule(id)?.points || 0)
    .reduce((a, b) => a + b, 0);
}
