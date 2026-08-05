/**
 * 單一 session 狀態 + localStorage 持久化。
 *
 * 兩個關鍵約定
 * ------------------------------------------------------------------
 * 1. **照片降階**：存進 localStorage 前，每張照片的 `dataUrl` 一定是縮圖
 *    （長邊 ≤ 640px、JPEG 0.6）。全解析度只放在 `fullDataUrl`，**不持久化**，
 *    重新整理後會消失。畫面顯示請一律寫 `photo.fullDataUrl || photo.dataUrl`。
 *    取車 4 + 補拍 n + 還車 4 > 10 張，全解析度 dataURL 必定撞爆 ~5MB 配額。
 *
 * 2. **所有寫入都經過本模組的方法**，方法內部會自動 save()。
 *    畫面模組不要自己 localStorage.setItem。
 */

import { config } from "./config.js";
import { downscaleDataUrl, uid } from "./util.js";
import { POINT_RULES, getRule, totalOf } from "./points.js";

export const STORAGE_KEY = "pigeonpacket.irent.session";
export const SCHEMA_VERSION = 3;
export const THUMB = Object.freeze({ maxEdge: 640, quality: 0.6 });

/** 存放照片的三個群組（= session 上的欄位名 prefix）。 */
export const CAPTURE_GROUPS = Object.freeze(["pickup", "supplement", "return"]);
const GROUP_FIELD = Object.freeze({
  pickup: "pickupCaptures",
  supplement: "supplementCaptures",
  return: "returnCaptures",
});

/** 照片類別。corner 才會被算進「四角完整」。 */
export const CAPTURE_CATEGORIES = Object.freeze({
  CORNER: "corner",
  INTERIOR: "interior",
  DAMAGE: "damage",
  DASHBOARD: "dashboard",
  OTHER: "other",
});

/**
 * timeline 事件類型。**請用這裡的常數**，不要自己打字串，
 * 事證包（dispute）與結算（settlement）畫面會依 type 分組與上圖示。
 * 需要新類型就在這裡加一筆。
 */
export const EVENTS = Object.freeze({
  SESSION_START: "session_start",
  VEHICLE_PREVIEW: "vehicle_preview",
  PICKUP_CAPTURE: "pickup_capture",
  PICKUP_COMPLETE: "pickup_complete",
  UNLOCK: "unlock",
  SUPPLEMENT_OPEN: "supplement_open",
  SUPPLEMENT_CAPTURE: "supplement_capture",
  SUPPLEMENT_COMPLETE: "supplement_complete",
  SUPPLEMENT_EXPIRED: "supplement_expired",
  REPORT_CREATED: "report_created",
  RETURN_CAPTURE: "return_capture",
  RETURN_COMPLETE: "return_complete",
  AI_COMPARE: "ai_compare",
  DAMAGE_CONFIRMED: "damage_confirmed",
  DAMAGE_DISPUTED: "damage_disputed",
  HONEST_REPORT: "honest_report",
  POINTS_AWARDED: "points_awarded",
  EVIDENCE_EXPORTED: "evidence_exported",
  VEHICLE_STATUS: "vehicle_status",
});

/** demo 車輛（模擬資料）。Wave 2 的 ops 畫面可以再擴充欄位。 */
export const MOCK_VEHICLE = Object.freeze({
  id: "irent-0731",
  plate: "RAE-3721",
  model: "Toyota Yaris",
  modelId: "generic", // ← 對應 guides.js 的 modelId
  color: "白",
  station: "台北車站西三門",
  fuel: 78,
  status: "待取車",
});

function emptySession() {
  return {
    version: SCHEMA_VERSION,
    id: uid("sess"),
    startedAt: new Date().toISOString(),
    vehicle: { ...MOCK_VEHICLE },
    /** "pickup" | "return" —— 目前使用者處在哪一段劇本 */
    phase: "pickup",
    pickupCaptures: [],
    supplementCaptures: [],
    returnCaptures: [],
    /** 使用中回報（Screen 3）：{ id, at, type, note, photoIds[] } */
    reports: [],
    /** { awarded: [{ id, ruleId, points, label, at, meta }], total } */
    points: { awarded: [], total: 0 },
    /** [{ id, type, at, label, phase, detail }] */
    timeline: [],
    /** 模擬 AI 比對分支："clean" | "suspect" | "damage" | null */
    scenario: config.scenario,
    /**
     * 自由欄位袋 —— Wave 2 各 track 把自己的旗標放這裡，
     * 就不必為了加一個欄位而改 emptySession()（避免互相衝突）。
     * 例：flags.unlockedAt / flags.supplementDeadline / flags.disputeOpened
     */
    flags: {},
    /** "ok" | "degraded"（縮圖也存不下時只存 metadata） */
    storage: "ok",
  };
}

function mergeLoaded(raw) {
  const base = emptySession();
  if (!raw || typeof raw !== "object") return base;
  const merged = { ...base, ...raw };
  // 巢狀欄位逐一補齊，讓舊資料 / 未來新增欄位都不會炸
  merged.vehicle = { ...base.vehicle, ...(raw.vehicle || {}) };
  merged.points = {
    awarded: Array.isArray(raw.points?.awarded) ? raw.points.awarded : [],
    total: 0,
  };
  merged.points.total = totalOf(merged.points.awarded);
  merged.flags = { ...(raw.flags || {}) };
  for (const field of Object.values(GROUP_FIELD)) {
    merged[field] = Array.isArray(raw[field]) ? raw[field] : [];
  }
  merged.reports = Array.isArray(raw.reports) ? raw.reports : [];
  merged.timeline = Array.isArray(raw.timeline) ? raw.timeline : [];
  merged.version = SCHEMA_VERSION;
  return merged;
}

function isQuotaError(err) {
  return (
    err &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22)
  );
}

/** 產生可持久化的複本：拔掉 fullDataUrl（全解析度只留在記憶體）。 */
function serialize(session, { includeThumbs = true } = {}) {
  const copy = { ...session };
  for (const field of Object.values(GROUP_FIELD)) {
    copy[field] = (session[field] || []).map((photo) => {
      const { fullDataUrl, ...rest } = photo;
      return includeThumbs ? rest : { ...rest, dataUrl: null };
    });
  }
  return copy;
}

export const state = {
  /** 目前的 session 物件（load()/reset() 會換掉整個物件參考） */
  session: emptySession(),

  // ---------------------------------------------------------------- 持久化

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.session;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SCHEMA_VERSION) {
        console.info("[state] schema 版本不同，重建 session");
        return this.reset();
      }
      this.session = mergeLoaded(parsed);
      // URL 參數優先於存檔：簡報時 ?scenario= 一定要能覆蓋舊 session
      if (config.scenario) this.session.scenario = config.scenario;
    } catch (err) {
      console.warn("[state] 讀取 session 失敗，重建", err);
      this.session = emptySession();
    }
    return this.session;
  },

  /**
   * 寫入 localStorage。**永不 throw**：
   * 配額爆掉時先降級成「只存 metadata」，再不行就清掉 key 並標記 degraded。
   */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(this.session)));
      return true;
    } catch (err) {
      if (!isQuotaError(err)) {
        console.warn("[state] save 失敗", err);
        return false;
      }
      console.warn("[state] localStorage 配額不足，降級為只存 metadata");
      this.session.storage = "degraded";
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(serialize(this.session, { includeThumbs: false }))
        );
        return true;
      } catch (err2) {
        console.warn("[state] 降級後仍存不下，放棄持久化（記憶體仍可運作）", err2);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return false;
      }
    }
  },

  reset() {
    this.session = emptySession();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.addEvent(EVENTS.SESSION_START, { label: "開始新的 demo session" });
    return this.session;
  },

  // ---------------------------------------------------------------- 一般寫入

  /** 淺層 merge 到 session 並存檔。 */
  patch(fields) {
    Object.assign(this.session, fields);
    this.save();
    return this.session;
  },

  /** 設定 flags（Wave 2 放自己的旗標）。 */
  setFlag(key, value) {
    this.session.flags[key] = value;
    this.save();
    return value;
  },

  getFlag(key, fallback = null) {
    return this.session.flags[key] ?? fallback;
  },

  setPhase(phase) {
    if (this.session.phase !== phase) {
      this.session.phase = phase;
      this.save();
    }
    return phase;
  },

  // ---------------------------------------------------------------- timeline

  /**
   * 追加一筆 timeline 事件。
   * @param {string} type EVENTS 裡的常數
   * @param {{label?: string, [k: string]: any}} [detail] label 會被拉到頂層當顯示文字
   * @returns 新增的事件物件
   */
  addEvent(type, detail = {}) {
    const { label, ...rest } = detail;
    const event = {
      id: uid("evt"),
      type,
      at: new Date().toISOString(),
      phase: this.session.phase,
      label: label || type,
      detail: rest,
    };
    this.session.timeline.push(event);
    this.save();
    return event;
  },

  // ---------------------------------------------------------------- 照片

  getCaptures(group) {
    const field = GROUP_FIELD[group];
    if (!field) throw new Error(`[state] 未知的 capture group: ${group}`);
    return this.session[field];
  },

  /** 某一角是否已拍（含跳過）。 */
  findCapture(group, angle) {
    return this.getCaptures(group).find((c) => c.angle === angle) || null;
  },

  /**
   * 新增一張照片。**async**：內部會做縮圖降階。
   * @param {"pickup"|"supplement"|"return"} group
   * @param {object} input
   *   { angle?, category?, label?, skipped?, quality?, fullDataUrl?, note?, meta? }
   * @returns {Promise<object>} 完整的照片紀錄
   */
  async addCapture(group, input = {}) {
    const captures = this.getCaptures(group);
    const full = input.fullDataUrl ?? input.dataUrl ?? null;
    const record = {
      id: uid(`ph_${group}`),
      group,
      category: input.category || CAPTURE_CATEGORIES.CORNER,
      angle: input.angle ?? null,
      label: input.label || "",
      at: new Date().toISOString(),
      skipped: !!input.skipped,
      quality: input.quality || null,
      /** 縮圖（持久化） */
      dataUrl: null,
      /** 全解析度（記憶體 only，不持久化） */
      fullDataUrl: full,
      note: input.note || "",
      meta: input.meta || {},
    };
    if (full) {
      record.dataUrl = await downscaleDataUrl(full, THUMB);
    }
    captures.push(record);
    this.save();
    return record;
  },

  /** 移除一張照片（重拍某一角時用）。 */
  removeCapture(group, photoId) {
    const captures = this.getCaptures(group);
    const idx = captures.findIndex((c) => c.id === photoId);
    if (idx >= 0) {
      captures.splice(idx, 1);
      this.save();
    }
    return idx >= 0;
  },

  /** 清空一組照片（demo 重跑某一段時用）。 */
  clearCaptures(group) {
    this.getCaptures(group).length = 0;
    this.save();
  },

  /** 所有群組的照片攤平（事證包用）。 */
  allCaptures() {
    return CAPTURE_GROUPS.flatMap((g) => this.getCaptures(g));
  },

  // ---------------------------------------------------------------- 回報

  /** 使用中回報（Screen 3）。 */
  addReport(report = {}) {
    const entry = {
      id: uid("rep"),
      at: new Date().toISOString(),
      type: report.type || "other",
      note: report.note || "",
      photoIds: report.photoIds || [],
      ...report,
    };
    this.session.reports.push(entry);
    this.addEvent(EVENTS.REPORT_CREATED, { label: `回報：${entry.type}`, reportId: entry.id });
    return entry;
  },

  // ---------------------------------------------------------------- 積分

  /**
   * 授予積分。規則定義在 points.js（POINT_RULES）。
   * - rule.once（預設 true）：已存在同 id 就不重複給
   * - rule.exclusive：同一互斥組只保留這一筆（例：pickup_complete 取代 pickup_partial）
   * @returns {object|null} 新增的授予紀錄；沒授予則 null
   */
  awardPoints(ruleId, meta = {}) {
    const rule = getRule(ruleId);
    if (!rule) {
      console.warn(`[state] 未知的積分規則: ${ruleId}（請先加到 points.js 的 POINT_RULES）`);
      return null;
    }
    const awarded = this.session.points.awarded;
    if (rule.exclusive) {
      for (let i = awarded.length - 1; i >= 0; i -= 1) {
        const other = getRule(awarded[i].ruleId);
        if (other?.exclusive === rule.exclusive) awarded.splice(i, 1);
      }
    } else if (rule.once !== false && awarded.some((a) => a.ruleId === ruleId)) {
      return null;
    }
    const entry = {
      id: uid("pt"),
      ruleId,
      points: rule.points,
      label: rule.label,
      stage: rule.stage || null,
      at: new Date().toISOString(),
      meta,
    };
    awarded.push(entry);
    this.session.points.total = totalOf(awarded);
    this.addEvent(EVENTS.POINTS_AWARDED, {
      label: `${rule.label} +${rule.points}`,
      ruleId,
      points: rule.points,
    });
    return entry;
  },

  /** 目前總積分。 */
  totalPoints() {
    return this.session.points.total;
  },

  /** 所有規則 + 是否已取得（settlement 畫面用）。 */
  pointsBreakdown() {
    const awarded = this.session.points.awarded;
    return POINT_RULES.map((rule) => ({
      rule,
      entries: awarded.filter((a) => a.ruleId === rule.id),
      earned: awarded
        .filter((a) => a.ruleId === rule.id)
        .reduce((s, a) => s + a.points, 0),
    }));
  },
};
