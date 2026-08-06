/**
 * Screen 5 —— 模擬 AI 前後比對 + 誠實申報減免（Wave 2 · Track C）
 * ============================================================================
 *
 * ⚠️ 這個畫面裡的「AI 判斷」是**前端模擬**：沒有後端、沒有影像比對模型，
 *    只是一組固定規則讀 state 裡的拍照行為後產生的結果。畫面上每一處都有標明。
 *
 * 核心設計（刻意不是固定腳本）
 * ---------------------------------------------------------------------------
 * 判定由**使用者的拍照行為**推導，所以「好好拍有好處」是被演示出來的，不是被宣稱的：
 *
 *   使用中曾回報損傷（reports / damage 照片 / flags）  → damage  標記新增損傷 + 誠實申報入口
 *   還車或取車基準有跳過、品質警告、缺角              → suspect 轉人工複審（低信心）
 *   四角皆已拍且品質達標、基準完整                     → clean   自動放行（高信心）
 *
 * 覆寫優先序（簡報用）：
 *   `#/compare?force=auto|clean|suspect|damage`（畫面內覆寫，不用重載）
 *   > `?scenario=clean|suspect|damage`（URL 覆寫，config.scenario）
 *   > 行為推導（config.scenario 為 null 時的預設）
 *
 * ---------------------------------------------------------------------------
 * 給 Track D（dispute / settlement）：`state.getFlag('compareResult')` 的形狀
 * ---------------------------------------------------------------------------
 * {
 *   simulated: true,                    // 一律 true —— 提醒渲染端標明是模擬結果
 *   verdict: 'clean' | 'suspect' | 'damage',
 *   source: 'derived' | 'forced-url' | 'forced-inline',
 *   at: '2026-08-04T...',               // ISO
 *   signature: 'damage|derived|…',       // 判定輸入的指紋（timeline 去重用）
 *   confidence: 0.84,                   // 模擬信心（0–1）
 *   confidenceRange: [0.78, 0.9],
 *   headline: '偵測到疑似新增損傷',
 *   summary: '一句話結論',
 *   reasons: ['使用中曾回報車況異常（1 筆）', …],   // 判定依據（可直接列點）
 *   nextStep: 'settlement' | 'review' | 'confirm',
 *   suggestedVehicleStatus: '可租' | '待人工' | '不建議出租',   // PIG-13 §4 狀態機
 *   regions: [{                        // diff 高亮框；box 是 0–1 比例座標
 *     angle: 'rr', angleLabel: '右後 45°', part: '右後保桿',
 *     kind: 'damage' | 'uncertain', tag: '疑似新增', note: '…',
 *     box: { x: 0.56, y: 0.48, w: 0.32, h: 0.22 },
 *     baselinePhotoId: 'ph_pickup_…' | null, returnPhotoId: 'ph_return_…' | null,
 *   }],
 *   pairs: [{                          // 並排比對用（已處理「補拍覆蓋取車」邏輯）
 *     angle, angleLabel, baselinePhotoId, baselineFrom: 'pickup'|'supplement'|null,
 *     baselineOk, returnPhotoId, returnSkipped, returnQualityOk, flagged,
 *   }],
 *   evidence: { baselineCount, supplementCount, returnCount, returnCornerCount,
 *               missingAngles[], skippedAngles[], warnedAngles[],
 *               weakBaselineAngles[], damageReportCount, damagePhotoIds[] },
 *   confessed: false,                  // = flags.confessed（布林），方便單點讀取
 *   confession: null | { at, angle, pointsAwarded, note },
 *   resolution: null | 'accepted' | 'confessed' | 'manual-review' | 'disputed',
 * }
 *
 * 另外寫入：`flags.confessed`（布林）、timeline 的 AI_COMPARE / DAMAGE_CONFIRMED /
 * DAMAGE_DISPUTED / HONEST_REPORT 事件。積分只用既有規則 `honest_report`（+5），
 * 沒有新增 POINT_RULES —— 賠償金額與扣分比例屬商業設計，原型不編造數字。
 */

import { CORNERS } from "../guides.js";
import { CAPTURE_CATEGORIES, EVENTS } from "../state.js";
import { escapeHtml } from "../util.js";

export const id = "compare";
export const title = "AI 前後比對（模擬）";
export const subtitle = "結果依你的拍照行為變化，不是固定腳本";
export const nav = [{ label: "AI 比對", params: {}, order: 60 }];

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

/** 三種分支的表現層設定。confidence 是**模擬**區間，畫面上一律標「模擬值」。 */
const VERDICTS = {
  clean: {
    icon: "✅",
    tone: "ok",
    badge: "無新增損傷",
    headline: "未偵測到新增損傷",
    confidence: [0.86, 0.94],
    nextStep: "settlement",
    status: "可租",
  },
  suspect: {
    icon: "⚠️",
    tone: "warn",
    badge: "無法自動判定",
    headline: "照片品質不足，建議轉人工複審",
    confidence: [0.55, 0.66],
    nextStep: "review",
    status: "待人工",
  },
  damage: {
    icon: "🔴",
    tone: "danger",
    badge: "疑似新增損傷",
    headline: "偵測到疑似新增損傷",
    confidence: [0.78, 0.9],
    nextStep: "confirm",
    status: "不建議出租",
  },
};

const ANGLE_SHORT = { lf: "左前", rf: "右前", lr: "左後", rr: "右後" };

/** 各角度的「差異區域」——座標是預先定義的示意位置（0–1 比例），非偵測結果。 */
const DIFF_REGIONS = {
  lf: { part: "左前保桿／頭燈", box: { x: 0.1, y: 0.44, w: 0.32, h: 0.2 } },
  rf: { part: "右前保桿／前葉板", box: { x: 0.56, y: 0.44, w: 0.32, h: 0.2 } },
  lr: { part: "左後門下緣／後輪弧", box: { x: 0.12, y: 0.48, w: 0.3, h: 0.21 } },
  rr: { part: "右後保桿", box: { x: 0.56, y: 0.48, w: 0.32, h: 0.22 } },
};

const ANALYZE_STEPS = ["載入取車基準", "對齊四角視角", "比對差異區域", "產生判定"];

/** 回報「型別」看起來像車體損傷。inuse.js 用什麼字串都盡量接得到。 */
const DAMAGE_TYPE_RE = /(damage|scratch|dent|crash|collision|broken|crack|損|刮|撞|凹|破|裂)/i;
/** 備註只吃強訊號，避免「後座有垃圾」這種整潔類回報被誤判成損傷。 */
const DAMAGE_NOTE_RE = /(刮痕|刮傷|擦撞|擦傷|撞到|凹陷|破損|裂痕|損傷|scratch|dent|crack|damage)/i;
/** 防禦性地接住其他 track 可能設的旗標（CONTRACT 沒定義，有就用）。 */
const DAMAGE_FLAG_KEYS = ["damageReported", "inuseDamage", "damageDuringUse"];

// ---------------------------------------------------------------------------
// 純函式：判定邏輯
// ---------------------------------------------------------------------------

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 由 seed 決定的穩定「模擬信心」——同一組輸入每次重繪都一樣，不同 session 會不同。 */
function pickConfidence([lo, hi], seed) {
  const t = (hash32(seed) % 997) / 996;
  return Math.round((lo + t * (hi - lo)) * 100) / 100;
}

/** 一張照片是否可用作比對依據（沒跳過、沒有品質警告）。 */
function photoOk(photo) {
  if (!photo || photo.skipped) return false;
  return photo.quality ? photo.quality.ok === true : true;
}

/**
 * 取某一角的「取車基準」——補拍（有效的那張）優先覆蓋取車原始照片。
 * 這是 Track B 補拍窗口的價值：取車拍壞的角度可以被補救。
 */
function pickBaseline(pickup, supplement, angle) {
  for (let i = supplement.length - 1; i >= 0; i -= 1) {
    const p = supplement[i];
    if (p.angle === angle && !p.skipped) return { photo: p, from: "supplement" };
  }
  const pk = pickup.find((p) => p.angle === angle) || null;
  return { photo: pk, from: pk ? "pickup" : null };
}

/**
 * 使用中回報的照片借用 supplement 群組存放（inuse.js 的 `meta.stage='inuse'`），
 * 它**不是**租前基準的一部分，所有「補拍」相關的統計與比對都要把它排除。
 */
const isSupplementShot = (p) => p?.meta?.stage !== "inuse";

/** 蒐集四角的 基準 ↔ 還車 配對。 */
function buildPairs(state) {
  const pickup = state.getCaptures("pickup");
  const supplement = state.getCaptures("supplement").filter(isSupplementShot);
  const returns = state.getCaptures("return");
  return CORNERS.map((corner) => {
    const base = pickBaseline(pickup, supplement, corner.id);
    const now = returns.find((p) => p.angle === corner.id) || null;
    return {
      angle: corner.id,
      angleLabel: corner.label,
      baseline: base.photo,
      baselineFrom: base.from,
      baselineOk: photoOk(base.photo),
      return: now,
      returnOk: photoOk(now),
    };
  });
}

/** 使用中是否曾回報損傷（reports / damage 類照片 / 其他 track 的旗標）。 */
function collectDamageSignals(state) {
  const session = state.session;
  const reports = (session.reports || []).filter(
    (r) => DAMAGE_TYPE_RE.test(String(r.type || "")) || DAMAGE_NOTE_RE.test(String(r.note || ""))
  );
  const damagePhotos = state
    .allCaptures()
    .filter((p) => p.category === CAPTURE_CATEGORIES.DAMAGE);
  const flagged = DAMAGE_FLAG_KEYS.filter((k) => !!session.flags?.[k]);
  return {
    reports,
    damagePhotos,
    flagged,
    any: reports.length > 0 || damagePhotos.length > 0 || flagged.length > 0,
  };
}

/**
 * 行為推導：讀 state 的照片與回報，決定要走哪一個分支。
 * @returns {{ verdict: string, reasons: string[], evidence: object, damage: object,
 *             pairs: Array, focusAngle: string|null }}
 */
function deriveVerdict(state) {
  const pairs = buildPairs(state);
  const damage = collectDamageSignals(state);

  const missingAngles = pairs.filter((p) => !p.return).map((p) => p.angle);
  const skippedAngles = pairs.filter((p) => p.return?.skipped).map((p) => p.angle);
  const warnedAngles = pairs
    .filter((p) => p.return && !p.return.skipped && p.return.quality?.ok === false)
    .map((p) => p.angle);
  const weakBaselineAngles = pairs.filter((p) => !p.baselineOk).map((p) => p.angle);

  const returnCaptures = state.getCaptures("return");
  const evidence = {
    baselineCount: state.getCaptures("pickup").length,
    supplementCount: state.getCaptures("supplement").filter(isSupplementShot).length,
    returnCount: returnCaptures.length,
    returnCornerCount: returnCaptures.filter(
      (c) => c.category === CAPTURE_CATEGORIES.CORNER
    ).length,
    missingAngles,
    skippedAngles,
    warnedAngles,
    weakBaselineAngles,
    damageReportCount: damage.reports.length,
    damagePhotoIds: damage.damagePhotos.map((p) => p.id),
  };

  const reasons = [];
  let verdict;
  let focusAngle = null;

  if (damage.any) {
    verdict = "damage";
    if (damage.reports.length) {
      const first = damage.reports[0];
      reasons.push(
        `使用中曾回報車況異常（${damage.reports.length} 筆）：${first.note || first.type}`
      );
    }
    if (damage.damagePhotos.length) {
      reasons.push(`有 ${damage.damagePhotos.length} 張標記為「損傷」的照片`);
    }
    if (damage.flagged.length) reasons.push(`旗標 ${damage.flagged.join("、")} 為真`);
    focusAngle =
      damage.damagePhotos.find((p) => p.angle)?.angle ||
      damage.reports.find((r) => r.angle)?.angle ||
      "rr";
  } else if (
    missingAngles.length ||
    skippedAngles.length ||
    warnedAngles.length ||
    weakBaselineAngles.length
  ) {
    verdict = "suspect";
    if (missingAngles.length) {
      reasons.push(`還車缺少 ${missingAngles.map((a) => ANGLE_SHORT[a]).join("、")} 角度`);
    }
    if (skippedAngles.length) {
      reasons.push(
        `還車有 ${skippedAngles.length} 角被「先繼續」跳過（${skippedAngles
          .map((a) => ANGLE_SHORT[a])
          .join("、")}）`
      );
    }
    if (warnedAngles.length) {
      reasons.push(
        `還車有 ${warnedAngles.length} 張帶品質警告（${warnedAngles
          .map((a) => ANGLE_SHORT[a])
          .join("、")}）`
      );
    }
    if (weakBaselineAngles.length) {
      reasons.push(
        `取車基準不足：${weakBaselineAngles
          .map((a) => ANGLE_SHORT[a])
          .join("、")}（跳過或有品質警告，且未補拍）`
      );
    }
    focusAngle =
      [...missingAngles, ...skippedAngles, ...warnedAngles, ...weakBaselineAngles].find(
        (a) => a
      ) || null;
  } else {
    verdict = "clean";
    reasons.push(`還車四角完整（${evidence.returnCornerCount}/${CORNERS.length}），皆無品質警告`);
    reasons.push("取車基準四角齊備且品質達標");
    if (evidence.supplementCount) reasons.push(`補拍 ${evidence.supplementCount} 張已併入基準`);
    reasons.push("使用中無車況異常回報");
  }

  return { verdict, reasons, evidence, damage, pairs, focusAngle };
}

/** 組出 diff 高亮框。clean 沒有框（改在畫面上打綠勾）。 */
function buildRegions(verdict, focusAngle, pairs, damage) {
  if (verdict === "clean" || !focusAngle) return [];
  const geom = DIFF_REGIONS[focusAngle] || DIFF_REGIONS.rr;
  const pair = pairs.find((p) => p.angle === focusAngle) || null;
  const corner = CORNERS.find((c) => c.id === focusAngle);
  const damageNote =
    damage.reports[0]?.note ||
    (damage.damagePhotos[0]?.label ? `使用中回報：${damage.damagePhotos[0].label}` : "") ||
    "與取車基準不一致";
  return [
    {
      angle: focusAngle,
      angleLabel: corner?.label || focusAngle,
      part: geom.part,
      kind: verdict === "damage" ? "damage" : "uncertain",
      /** kind 的別名，給 dispute.js 的事證包判定嚴重度用（它讀 severity/level/type） */
      severity: verdict === "damage" ? "damage" : "suspect",
      tag: verdict === "damage" ? "疑似新增" : "無法確認",
      note:
        verdict === "damage"
          ? `${geom.part}：疑似新增痕跡（${damageNote}）`
          : `${geom.part}：照片不足以判定，交人工複審`,
      box: { ...geom.box },
      baselinePhotoId: pair?.baseline?.id || null,
      returnPhotoId: pair?.return?.id || null,
    },
  ];
}

const SUMMARY = {
  clean: "四角基準與還車影像一致，可直接完成還車並結算積分。",
  suspect: "照片被跳過或品質不足，模擬判定無法自動結案 —— 這正是「好好拍」的差別。",
  damage: "與取車基準不一致，需要你確認責任；主動申報可取得減免。",
};

/** 把推導 + 覆寫整理成一份完整的 compareResult 物件。 */
function buildResult(state, forced) {
  const derived = deriveVerdict(state);
  const verdict = forced?.verdict || derived.verdict;
  const spec = VERDICTS[verdict];
  const source = forced ? forced.source : "derived";

  const focusAngle =
    verdict === derived.verdict
      ? derived.focusAngle
      : verdict === "clean"
        ? null
        : derived.focusAngle || (verdict === "damage" ? "rr" : CORNERS[0].id);

  const reasons =
    verdict === derived.verdict
      ? derived.reasons
      : [
          `簡報覆寫：強制走「${spec.badge}」分支（${
            forced?.source === "forced-url" ? "?scenario=" : "畫面內覆寫"
          }）`,
          `依實際拍照行為推導的結果是「${VERDICTS[derived.verdict].badge}」`,
        ];

  const signature = [
    verdict,
    source,
    derived.evidence.missingAngles.join(","),
    derived.evidence.skippedAngles.join(","),
    derived.evidence.warnedAngles.join(","),
    derived.evidence.weakBaselineAngles.join(","),
    derived.evidence.damageReportCount,
    derived.evidence.returnCount,
  ].join("|");

  return {
    simulated: true,
    verdict,
    source,
    at: new Date().toISOString(),
    signature,
    confidence: pickConfidence(spec.confidence, `${state.session.id}:${signature}`),
    confidenceRange: [...spec.confidence],
    headline: spec.headline,
    summary: SUMMARY[verdict],
    reasons,
    nextStep: spec.nextStep,
    suggestedVehicleStatus: spec.status,
    regions: buildRegions(verdict, focusAngle, derived.pairs, derived.damage),
    pairs: derived.pairs.map((p) => ({
      angle: p.angle,
      angleLabel: p.angleLabel,
      baselinePhotoId: p.baseline?.id || null,
      baselineFrom: p.baselineFrom,
      baselineOk: p.baselineOk,
      returnPhotoId: p.return?.id || null,
      returnSkipped: !!p.return?.skipped,
      returnQualityOk: p.return ? p.return.quality?.ok !== false : null,
      flagged: p.angle === focusAngle && verdict !== "clean",
    })),
    evidence: derived.evidence,
    confessed: !!state.getFlag("confessed"),
    confession: state.getFlag("compareResult")?.confession || null,
    resolution: null,
    /** 除錯／簡報用：行為推導原本的答案（覆寫時仍看得到） */
    derivedVerdict: derived.verdict,
  };
}

// ---------------------------------------------------------------------------
// CSS（前綴 .compare-*；共用 kit 直接沿用 styles.css）
// ---------------------------------------------------------------------------

export const css = `
.compare-sim { display: flex; gap: 8px; align-items: flex-start; }
.compare-sim .compare-sim-icon { flex: 0 0 auto; }
.compare-sim strong { color: var(--warn); }

.compare-analyze { margin: 12px 0; }
.compare-analyze .steps li { font-size: 10px; }

.compare-verdict {
  display: flex; gap: 10px; align-items: flex-start;
  border-radius: var(--radius); padding: 12px; margin: 12px 0;
  border: 1px solid var(--line); background: var(--surface);
}
.compare-verdict.ok { background: rgba(0,194,168,.12); border-color: rgba(0,194,168,.45); }
.compare-verdict.warn { background: rgba(245,166,35,.13); border-color: rgba(245,166,35,.5); }
.compare-verdict.danger { background: rgba(255,107,107,.12); border-color: rgba(255,107,107,.5); }
.compare-verdict-icon { font-size: 26px; line-height: 1; flex: 0 0 auto; }
.compare-verdict-body { flex: 1 1 auto; min-width: 0; }
.compare-verdict h2 { margin: 2px 0 4px; font-size: 16px; line-height: 1.35; }
.compare-verdict p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--muted); }
.compare-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 2px; }

.compare-conf { margin-top: 10px; }
.compare-conf-head {
  display: flex; justify-content: space-between; gap: 8px;
  font-size: 11px; color: var(--muted); margin-bottom: 4px;
}
.compare-conf-head b { color: var(--text); font-variant-numeric: tabular-nums; }
.compare-conf-track { height: 5px; border-radius: 3px; background: #2a3545; overflow: hidden; }
.compare-conf-fill { height: 100%; width: var(--pct, 0%); border-radius: 3px; background: var(--accent); }
.compare-verdict.warn .compare-conf-fill { background: var(--warn); }
.compare-verdict.danger .compare-conf-fill { background: var(--danger); }

.compare-angles { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 0; }
.compare-angles::-webkit-scrollbar { display: none; }
.compare-angle {
  flex: 1 1 0; min-width: 58px; border: 1px solid #3a4a5f; background: var(--surface);
  color: var(--muted); border-radius: 999px; padding: 6px 4px; font-size: 11px;
  font-family: inherit; cursor: pointer; white-space: nowrap;
}
.compare-angle.active { border-color: var(--accent); color: var(--accent); background: rgba(0,194,168,.14); }
.compare-angle.flagged { border-color: var(--danger); color: #ffb3b3; }
.compare-angle.flagged.active { background: rgba(255,107,107,.16); }

.compare-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.compare-cell { min-width: 0; }
.compare-cell-head {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  font-size: 11px; color: var(--muted); margin-bottom: 4px;
}
.compare-frame {
  position: relative; aspect-ratio: 3 / 4; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--line); background: #131b24;
}
.compare-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.compare-frame-empty {
  /* 文字靠上，避免和置中的 diff 高亮框疊在一起 */
  position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: center;
  text-align: center; padding: 14% 8px 8px; font-size: 10px; line-height: 1.5; color: var(--muted);
  background: repeating-linear-gradient(45deg, #161f29 0 8px, #131b24 8px 16px);
}
.compare-cell-note { margin: 4px 0 0; font-size: 10px; line-height: 1.45; color: var(--muted); }

.compare-box { position: absolute; border-radius: 5px; pointer-events: none; }
.compare-box > span {
  position: absolute; left: 0; top: 100%; margin-top: 2px;
  font-size: 9px; font-weight: 600; white-space: nowrap;
  padding: 1px 4px; border-radius: 4px; background: rgba(0,0,0,.7);
}
.compare-box.right > span { left: auto; right: 0; }
.compare-box.damage {
  border: 2px solid var(--danger);
  box-shadow: 0 0 0 9999px rgba(255,107,107,.08);
  animation: compare-pulse 1.6s ease-in-out infinite;
}
.compare-box.damage > span { color: #ffb3b3; }
.compare-box.uncertain { border: 2px dashed var(--warn); }
.compare-box.uncertain > span { color: #ffd28a; }
.compare-box.baseline { border: 1.5px dashed rgba(255,255,255,.45); }
.compare-box.baseline > span { color: rgba(255,255,255,.75); }
/* 只讓框線呼吸，標籤保持可讀 */
@keyframes compare-pulse {
  0%, 100% { border-color: var(--danger); }
  50% { border-color: rgba(255,107,107,.35); }
}
@media (prefers-reduced-motion: reduce) { .compare-box.damage { animation: none; } }

.compare-check {
  position: absolute; top: 6px; right: 6px; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; font-size: 12px; font-weight: 700;
  background: var(--accent); color: #002820;
}

.compare-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 10px; color: var(--muted); }
.compare-legend i { display: inline-block; width: 14px; height: 8px; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
.compare-legend i.damage { border: 2px solid var(--danger); }
.compare-legend i.uncertain { border: 2px dashed var(--warn); }
.compare-legend i.baseline { border: 1.5px dashed rgba(255,255,255,.45); }

.compare-why { margin: 12px 0; }
.compare-why summary {
  cursor: pointer; font-size: 13px; font-weight: 600; padding: 10px 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  list-style: none;
}
.compare-why summary::-webkit-details-marker { display: none; }
.compare-why summary::after { content: " ▾"; color: var(--muted); font-weight: 400; }
.compare-why[open] summary { border-radius: var(--radius) var(--radius) 0 0; }
.compare-why-body {
  border: 1px solid var(--line); border-top: none;
  border-radius: 0 0 var(--radius) var(--radius); padding: 10px 12px; background: rgba(26,35,50,.6);
}
.compare-why-body ul { margin: 0 0 8px; padding-left: 18px; font-size: 12px; line-height: 1.6; }
.compare-rule {
  margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; line-height: 1.6; color: var(--muted);
  white-space: pre-wrap; word-break: break-word;
}
.compare-rule b { color: var(--accent); font-weight: 600; }

.compare-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 10px 0 0; }
.compare-choice > div {
  border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; min-width: 0;
}
.compare-choice > div.good { border-color: rgba(0,194,168,.5); background: rgba(0,194,168,.09); }
.compare-choice h4 { margin: 0 0 4px; font-size: 12px; }
.compare-choice ul { margin: 0; padding-left: 14px; font-size: 11px; line-height: 1.55; color: var(--muted); }
@media (max-width: 340px) { .compare-choice { grid-template-columns: 1fr; } }

.compare-force { display: flex; flex-wrap: wrap; gap: 6px; }
.compare-force button {
  flex: 0 0 auto; border: 1px solid #3a4a5f; background: var(--surface); color: var(--muted);
  border-radius: 999px; padding: 5px 10px; font-size: 11px; font-family: inherit; cursor: pointer;
}
.compare-force button.active { border-color: var(--accent); color: var(--accent); }
`;

// ---------------------------------------------------------------------------
// mount
// ---------------------------------------------------------------------------

export function mount(root, ctx) {
  const { state, config, points } = ctx;
  let disposed = false;
  let timer = null;

  state.setPhase("return");
  ctx.setFootnote(
    "本頁的比對結果與信心值都是前端模擬：依你的拍照行為套用固定規則產生，" +
      "未連接任何後端或影像比對模型。積分折抵比例為假設值。"
  );

  // ---------------------------------------------------------------- 覆寫來源
  // 優先序：#/compare?force=… > ?scenario=… > 行為推導（config.scenario 為 null 時）
  const inlineForce = ctx.params.force || null;
  let forced = null;
  if (inlineForce && inlineForce !== "auto" && VERDICTS[inlineForce]) {
    forced = { verdict: inlineForce, source: "forced-inline" };
  } else if (!inlineForce && config.scenario && VERDICTS[config.scenario]) {
    forced = { verdict: config.scenario, source: "forced-url" };
  }

  const returnCaptures = state.getCaptures("return");

  // 沒有任何還車照片，又沒有強制分支 → 不編造結果，引導先去拍照
  if (returnCaptures.length === 0 && !forced) {
    ctx.setHeader({ title: "AI 前後比對（模擬）", subtitle: "尚無還車影像可比對" });
    root.innerHTML = `
      <div class="empty">還沒有還車照片，無法比對。</div>
      <div class="card">
        <h2 class="section-title">這個畫面會做什麼</h2>
        <p class="muted">把「取車基準（含補拍）」與「還車影像」並排，用模擬規則判定是否有新增損傷。
        判定會依你的拍照行為變化：四角都好好拍 → 自動放行；有跳過或品質警告 → 轉人工複審。</p>
        <div class="actions">
          <button type="button" class="btn primary full" data-action="retake">先去完成還車拍照</button>
        </div>
        <p class="muted" style="margin-top:8px">簡報時也可用
          <code>?scenario=clean|suspect|damage</code> 直接強制分支。</p>
      </div>`;
    root.addEventListener("click", (e) => {
      if (e.target.closest('[data-action="retake"]')) ctx.go("capture", { phase: "return" });
    });
    return () => {
      disposed = true;
    };
  }

  // ---------------------------------------------------------------- 判定 + 落地
  // 先寫入 state（Track D 隨時讀得到），再播模擬分析動畫。
  const result = buildResult(state, forced);
  const spec = VERDICTS[result.verdict];
  state.setFlag("compareResult", result);

  const lastCompare = [...state.session.timeline]
    .reverse()
    .find((e) => e.type === EVENTS.AI_COMPARE && e.detail?.kind === "result");
  if (lastCompare?.detail?.signature !== result.signature) {
    state.addEvent(EVENTS.AI_COMPARE, {
      label: `模擬 AI 比對：${spec.badge}（信心 ${result.confidence.toFixed(2)}・模擬值）`,
      kind: "result",
      simulated: true,
      verdict: result.verdict,
      source: result.source,
      confidence: result.confidence,
      signature: result.signature,
      regions: result.regions.map((r) => ({ angle: r.angle, part: r.part, kind: r.kind })),
      reasons: result.reasons,
    });
  }

  ctx.setHeader({
    title: "AI 前後比對（模擬）",
    subtitle: `${state.session.vehicle.plate} · ${spec.badge}（模擬判定）`,
  });

  let activeAngle =
    result.regions[0]?.angle ||
    result.pairs.find((p) => p.returnPhotoId)?.angle ||
    CORNERS[0].id;

  // ---------------------------------------------------------------- 骨架
  root.innerHTML = `
    <div class="notice warn compare-sim">
      <span class="compare-sim-icon">⚠️</span>
      <span><strong>以下判定為模擬</strong>：本原型不接後端，AI 判斷與信心值都是依你的拍照行為
      套用固定規則產生的模擬資料，不是實際影像比對模型的輸出。</span>
    </div>

    <div class="compare-analyze" data-el="analyze">
      <div class="progress">
        <div class="progress-bar" data-el="bar"></div>
        <ol class="steps" data-el="steps">
          ${ANALYZE_STEPS.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ol>
      </div>
      <p class="muted" data-el="analyzeNote">正在比對取車基準與還車影像…（模擬流程，非真實運算）</p>
      <div class="actions">
        <button type="button" class="btn secondary" data-el="btnSkipAnim">跳過動畫</button>
      </div>
    </div>

    <div class="hidden" data-el="result"></div>
  `;

  const els = {};
  root.querySelectorAll("[data-el]").forEach((n) => {
    els[n.dataset.el] = n;
  });

  // ---------------------------------------------------------------- 並排比對

  function frameHtml(photo, { side, region, showCheck }) {
    const src = photo && (photo.fullDataUrl || photo.dataUrl);
    let body;
    if (src) {
      body = `<img src="${src}" alt="${escapeHtml(
        `${side === "baseline" ? "取車基準" : "還車"} ${photo.label || ""}`
      )}" />`;
    } else {
      let msg = "無此角照片";
      if (photo?.skipped) msg = "此角已跳過<br>沒有影像";
      else if (photo) msg = "縮圖未保存<br>（儲存空間不足）";
      body = `<div class="compare-frame-empty">${msg}</div>`;
    }
    const boxes = region
      ? `<div class="compare-box ${side === "baseline" ? "baseline" : region.kind}${
          region.box.x + region.box.w > 0.55 ? " right" : ""
        }" style="left:${region.box.x * 100}%;top:${region.box.y * 100}%;width:${
          region.box.w * 100
        }%;height:${region.box.h * 100}%">
          <span>${escapeHtml(side === "baseline" ? "基準同位置" : `${region.tag}・模擬標記`)}</span>
        </div>`
      : "";
    const check = showCheck && src ? `<span class="compare-check">✓</span>` : "";
    return `<div class="compare-frame">${body}${boxes}${check}</div>`;
  }

  function renderPair() {
    const pairs = buildPairs(state);
    const pair = pairs.find((p) => p.angle === activeAngle) || pairs[0];
    const region = result.regions.find((r) => r.angle === pair.angle) || null;
    const isClean = result.verdict === "clean";

    const baseBadge =
      pair.baselineFrom === "supplement"
        ? `<span class="badge ok">補拍覆蓋</span>`
        : pair.baselineFrom === "pickup"
          ? `<span class="badge">取車</span>`
          : `<span class="badge warn">缺基準</span>`;
    const retBadge = !pair.return
      ? `<span class="badge warn">未拍</span>`
      : pair.return.skipped
        ? `<span class="badge warn">跳過</span>`
        : pair.return.quality?.ok === false
          ? `<span class="badge warn">品質警告</span>`
          : `<span class="badge ok">品質達標</span>`;

    els.angleSlot.innerHTML = pairs
      .map((p) => {
        const flagged = result.regions.some((r) => r.angle === p.angle);
        const mark = flagged ? "●" : isClean ? "✓" : "";
        return `<button type="button" class="compare-angle${
          p.angle === activeAngle ? " active" : ""
        }${flagged ? " flagged" : ""}" data-action="angle" data-angle="${p.angle}">
          ${escapeHtml(ANGLE_SHORT[p.angle] || p.angle)}${mark ? ` ${mark}` : ""}
        </button>`;
      })
      .join("");

    els.pairSlot.innerHTML = `
      <div class="compare-pair">
        <div class="compare-cell">
          <div class="compare-cell-head"><span>取車基準</span>${baseBadge}</div>
          ${frameHtml(pair.baseline, { side: "baseline", region })}
          <p class="compare-cell-note">${escapeHtml(
            pair.baselineFrom === "supplement"
              ? "此角以 15 分鐘窗口內的補拍照片為基準"
              : pair.baseline
                ? "取車前拍攝，作為責任判定基準"
                : "取車未留下此角影像 → 無法比對"
          )}</p>
        </div>
        <div class="compare-cell">
          <div class="compare-cell-head"><span>還車影像</span>${retBadge}</div>
          ${frameHtml(pair.return, {
            side: "return",
            region,
            showCheck: isClean && !region,
          })}
          <p class="compare-cell-note">${escapeHtml(
            region
              ? region.note
              : isClean
                ? "此角度未偵測到差異（模擬判定）"
                : "此角度無標記"
          )}</p>
        </div>
      </div>
      ${
        region
          ? `<div class="compare-legend">
               <span><i class="${region.kind}"></i>${escapeHtml(region.tag)}（模擬標記）</span>
               <span><i class="baseline"></i>基準同位置</span>
               <span>高亮框座標為預先定義的示意位置</span>
             </div>`
          : ""
      }`;
  }

  // ---------------------------------------------------------------- 判定依據

  function whyHtml() {
    const e = result.evidence;
    const rule = [
      `verdict = <b>${result.verdict}</b>   // 來源：${
        result.source === "derived" ? "行為推導" : "簡報覆寫"
      }`,
      `使用中回報損傷 ? damage  →  ${e.damageReportCount + e.damagePhotoIds.length} 筆`,
      `缺角/跳過/品質警告/基準不足 ? suspect  →  ${
        e.missingAngles.length + e.skippedAngles.length + e.warnedAngles.length + e.weakBaselineAngles.length
      } 項`,
      `否則 clean  →  還車 corner ${e.returnCornerCount}/${CORNERS.length}、基準 ${e.baselineCount} 張＋補拍 ${e.supplementCount} 張`,
    ].join("\n");
    return `
      <details class="compare-why">
        <summary>判定依據（模擬規則，可展開給評審看）</summary>
        <div class="compare-why-body">
          <ul>${result.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
          <p class="compare-rule">${rule}</p>
          <p class="compare-rule">模擬信心區間 ${result.confidenceRange[0]}–${
            result.confidenceRange[1]
          }（本分支固定值，非模型輸出）
建議車輛狀態（PIG-13 §4）：${result.suggestedVehicleStatus}${
            result.source !== "derived"
              ? `\n行為推導原本的答案：${VERDICTS[result.derivedVerdict].badge}`
              : ""
          }</p>
        </div>
      </details>`;
  }

  // ---------------------------------------------------------------- 積分區塊

  function pointsHtml() {
    const total = state.totalPoints();
    const honest = points.getRule("honest_report");
    const confessed = !!state.getFlag("confessed");
    return `
      <div class="card">
        <div class="row between">
          <h2 class="section-title" style="margin:0">積分</h2>
          <span class="badge ok">目前 ${total} 分 ≈ 折抵 NT$${points.pointsToTwd(total)}</span>
        </div>
        <p class="muted" style="margin-top:6px">${escapeHtml(points.POINT_VALUE_ASSUMPTION)}</p>
        ${
          result.verdict === "damage"
            ? confessed
              ? `<div class="notice ok" style="margin-bottom:0">已誠實申報：${escapeHtml(
                  honest?.label || "誠實申報損傷"
                )} +${honest?.points ?? 0} 分，既有拍照積分不歸零。</div>`
              : `<div class="compare-choice">
                   <div class="good">
                     <h4>誠實申報（建議）</h4>
                     <ul>
                       <li>${escapeHtml(honest?.label || "誠實申報")} <b>+${honest?.points ?? 0}</b> 分</li>
                       <li>既有拍照積分不歸零</li>
                       <li>簡化賠償流程</li>
                     </ul>
                   </div>
                   <div>
                     <h4>不申報</h4>
                     <ul>
                       <li>無額外積分</li>
                       <li>走一般賠償流程</li>
                       <li>爭議期間車輛待人工</li>
                     </ul>
                   </div>
                 </div>
                 <p class="muted" style="margin-top:8px">積分與流程差異為 PIG-13 §5 的假設值；
                 實際賠償金額依估價，不在本原型範圍。</p>`
            : ""
        }
      </div>`;
  }

  // ---------------------------------------------------------------- 行動按鈕

  function actionsHtml() {
    const confessed = !!state.getFlag("confessed");
    if (result.verdict === "clean") {
      return `
        <div class="actions">
          <button type="button" class="btn primary full" data-action="settle">一鍵還車完成，結算積分</button>
          <button type="button" class="btn secondary" data-action="evidence">查看完整事證包</button>
        </div>`;
    }
    if (result.verdict === "suspect") {
      return `
        <div class="notice warn">還車照片不足以自動判定。<strong>回去補足照片就可能直接放行</strong>——
        這就是「好好拍」的差別。</div>
        <div class="actions">
          <button type="button" class="btn primary full" data-action="retake">回去重拍還車照片</button>
          <button type="button" class="btn ghost" data-action="review">同意轉人工複審</button>
          <button type="button" class="btn ghost" data-action="dispute">我有爭議</button>
        </div>
        <p class="muted" style="margin-top:8px">重拍：在拍照頁點「重新拍攝這一段」即可重跑四角。</p>`;
    }
    // damage
    if (confessed) {
      return `
        <div class="notice ok">已誠實申報，將以簡化流程處理，並保留既有拍照積分。</div>
        <div class="actions">
          <button type="button" class="btn primary full" data-action="settle">完成還車，結算積分</button>
          <button type="button" class="btn secondary" data-action="evidence">查看完整事證包</button>
        </div>`;
    }
    return `
      <div class="actions">
        <button type="button" class="btn primary full" data-action="confess">誠實申報：這是我造成的</button>
        <button type="button" class="btn ghost" data-action="dispute">我有爭議，要說明</button>
        <button type="button" class="btn secondary" data-action="confirm-only">確認損傷但不申報（走一般賠償流程）</button>
      </div>
      <p class="muted" style="margin-top:8px">誠實申報＝主動承認本次造成，換取簡化流程與積分不歸零
      （PIG-13 §5 自首減免）。目的是讓弄壞車的人願意回報，而不是隱瞞讓下一位踩雷。</p>`;
  }

  // ---------------------------------------------------------------- 簡報覆寫

  function forceHtml() {
    const activeKey = inlineForce || (config.scenario ? config.scenario : "auto");
    const opts = [
      ["auto", "自動推導"],
      ["clean", "無新增損傷"],
      ["suspect", "疑似／複審"],
      ["damage", "明顯新增"],
    ];
    return `
      <details class="compare-why">
        <summary>簡報工具：強制分支</summary>
        <div class="compare-why-body">
          <div class="compare-force">
            ${opts
              .map(
                ([k, label]) =>
                  `<button type="button" data-action="force" data-force="${k}"${
                    k === activeKey ? ' class="active"' : ""
                  }>${escapeHtml(label)}</button>`
              )
              .join("")}
          </div>
          <p class="compare-rule" style="margin-top:8px">覆寫優先序：#/compare?force=… &gt; ?scenario=… &gt; 行為推導
目前：${escapeHtml(activeKey)}（${result.source === "derived" ? "推導" : "覆寫"}）</p>
        </div>
      </details>`;
  }

  // ---------------------------------------------------------------- 組裝

  function renderResult() {
    const conf = Math.round(result.confidence * 100);
    els.result.innerHTML = `
      <div class="compare-verdict ${spec.tone}">
        <span class="compare-verdict-icon">${spec.icon}</span>
        <div class="compare-verdict-body">
          <div class="compare-tags">
            <span class="badge ${spec.tone === "ok" ? "ok" : spec.tone === "warn" ? "warn" : "danger"}">${escapeHtml(
              spec.badge
            )}</span>
            <span class="badge warn">模擬結果</span>
            ${
              result.source === "derived"
                ? `<span class="badge">依拍照行為推導</span>`
                : `<span class="badge">簡報覆寫</span>`
            }
          </div>
          <h2>${escapeHtml(result.headline)}</h2>
          <p>${escapeHtml(result.summary)}</p>
          <div class="compare-conf">
            <div class="compare-conf-head">
              <span>模擬信心值（非模型輸出）</span><b>${result.confidence.toFixed(2)}</b>
            </div>
            <div class="compare-conf-track"><div class="compare-conf-fill" style="--pct:${conf}%"></div></div>
          </div>
        </div>
      </div>

      <h2 class="section-title">並排比對 · 取車基準 ↔ 還車</h2>
      <div class="compare-angles" data-el="angleSlot"></div>
      <div data-el="pairSlot"></div>
      ${whyHtml()}
      ${pointsHtml()}
      ${actionsHtml()}
      ${forceHtml()}
    `;
    els.angleSlot = els.result.querySelector('[data-el="angleSlot"]');
    els.pairSlot = els.result.querySelector('[data-el="pairSlot"]');
    renderPair();
  }

  // ---------------------------------------------------------------- 行為

  function persist(patch) {
    Object.assign(result, patch);
    state.setFlag("compareResult", result);
  }

  function goNext(screenId, hint) {
    if (ctx.router.isRegistered(screenId)) {
      ctx.go(screenId);
      return;
    }
    alert(
      `下一站「#/${screenId}」（${hint}）尚未實作。\n` +
        `模擬判定已寫入 flags.compareResult：${result.verdict}（信心 ${result.confidence}・模擬值）\n` +
        `目前積分：${state.totalPoints()}`
    );
  }

  function confess() {
    if (state.getFlag("confessed")) return;
    const region = result.regions[0] || null;
    const entry = state.awardPoints("honest_report", {
      verdict: result.verdict,
      angle: region?.angle || null,
      simulated: true,
    });
    state.setFlag("confessed", true);
    state.addEvent(EVENTS.HONEST_REPORT, {
      label: `誠實申報：${region?.part || "車體"}損傷為本次造成`,
      angle: region?.angle || null,
      part: region?.part || null,
      points: entry?.points ?? 0,
    });
    state.addEvent(EVENTS.DAMAGE_CONFIRMED, {
      label: "確認損傷責任（誠實申報，取得減免）",
      confessed: true,
      angle: region?.angle || null,
      simulated: true,
    });
    persist({
      confessed: true,
      resolution: "confessed",
      confession: {
        at: new Date().toISOString(),
        angle: region?.angle || null,
        pointsAwarded: entry?.points ?? 0,
        note: "主動承認本次造成損傷，換取簡化賠償流程與積分不歸零（PIG-13 §5 假設）",
      },
    });
    renderResult();
  }

  function onResultClick(event) {
    const btn = event.target.closest("[data-action]");
    if (!btn || disposed) return;
    const action = btn.dataset.action;

    if (action === "angle") {
      activeAngle = btn.dataset.angle;
      renderPair();
      return;
    }
    if (action === "force") {
      const value = btn.dataset.force;
      ctx.go("compare", value === "auto" ? { force: "auto" } : { force: value });
      return;
    }
    if (action === "retake") {
      ctx.go("capture", { phase: "return" });
      return;
    }
    if (action === "confess") {
      confess();
      return;
    }
    if (action === "settle") {
      if (!result.resolution) persist({ resolution: "accepted" });
      goNext("settlement", "積分結算");
      return;
    }
    if (action === "confirm-only") {
      state.addEvent(EVENTS.DAMAGE_CONFIRMED, {
        label: "確認損傷責任（未申報，走一般賠償流程）",
        confessed: false,
        angle: result.regions[0]?.angle || null,
        simulated: true,
      });
      persist({ resolution: "accepted" });
      goNext("settlement", "積分結算");
      return;
    }
    if (action === "review") {
      state.addEvent(EVENTS.AI_COMPARE, {
        label: "同意轉人工複審（模擬判定信心不足）",
        kind: "manual_review",
        simulated: true,
        verdict: result.verdict,
        confidence: result.confidence,
      });
      persist({ resolution: "manual-review" });
      goNext("dispute", "事證包 / 人工複審");
      return;
    }
    if (action === "dispute") {
      state.addEvent(EVENTS.DAMAGE_DISPUTED, {
        label: "使用者對模擬比對結果提出爭議",
        verdict: result.verdict,
        confidence: result.confidence,
        angle: result.regions[0]?.angle || null,
        simulated: true,
      });
      persist({ resolution: "disputed" });
      goNext("dispute", "AI 客服管家 / 事證包");
      return;
    }
    if (action === "evidence") {
      goNext("dispute", "事證包");
    }
  }

  root.addEventListener("click", onResultClick);

  // ---------------------------------------------------------------- 分析動畫

  function reveal() {
    if (disposed) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    els.analyze.classList.add("hidden");
    els.result.classList.remove("hidden");
    renderResult();
  }

  function paintSteps(done) {
    els.bar.style.setProperty("--pct", `${(done / ANALYZE_STEPS.length) * 100}%`);
    [...els.steps.children].forEach((li, i) => {
      li.classList.toggle("done", i < done);
      li.classList.toggle("active", i === done);
    });
  }

  const stepMs = config.speed === "fast" ? 130 : 420;
  let step = 0;
  paintSteps(0);
  timer = setInterval(() => {
    step += 1;
    paintSteps(step);
    if (step >= ANALYZE_STEPS.length) reveal();
  }, stepMs);
  els.btnSkipAnim.addEventListener("click", reveal);

  if (state.session.storage === "degraded") {
    els.analyzeNote.textContent =
      "儲存空間不足，部分縮圖未保存（流程仍可繼續，畫面會顯示佔位圖）。";
  }

  // cleanup：只有一個 interval 要收
  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}
