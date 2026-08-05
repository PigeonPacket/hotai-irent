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
 * 依 §5 評估一組四角拍照該拿哪一條規則。
 * @param {"pickup"|"return"} stage
 * @param {Array} captures
 * @param {number} required
 * @returns {{ rule: PointRule|null, points: number, qualified: boolean }}
 */
export function evaluateCaptureSet(stage, captures = [], required = 4) {
  const qualified = isCaptureSetQualified(captures, required);
  const ruleId = qualified ? `${stage}_complete` : `${stage}_partial`;
  const rule = getRule(ruleId);
  const attempted = captures.length > 0;
  if (!attempted) return { rule: null, points: 0, qualified: false };
  return { rule, points: rule ? rule.points : 0, qualified };
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
