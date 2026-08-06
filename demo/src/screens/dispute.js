/**
 * Screen 6 —— 爭議：AI 客服管家 → 事證包（PIG-13 §3 Screen 6）
 *
 * 路由：#/dispute（Track C 的 #/compare 點「我有爭議」時導過來）
 *
 * 四個步驟（對齊 PIG-13）
 *   1 自動彙整：取車基準 / 補拍 / 使用中回報 / 還車 / 比對 diff → 有時間戳的證據鏈
 *   2 對話式引導：「請描述您認為有爭議的部分」（模擬 AI，回應由真實事證推導，不編造統計）
 *   3 引用 iRent FAQ／條款（模擬 RAG，畫面明確標示為示意條文）
 *   4 輸出「事證包」JSON 給人工客服（複製到剪貼簿）
 *
 * 設計要點：**優雅處理缺漏**。
 *   其他 track 尚未上線時 timeline 可能只有一部分事件、flags.compareResult 可能不存在
 *   或形狀不同。本畫面一律容錯讀取，並把「這一段沒有存證」當成有意義的資訊顯示出來
 *   （沒補拍就是沒證據），而不是拋錯或假裝有資料。
 *
 * 擁有的 flags：flags.disputeOpened、flags.evidenceExportedAt
 */

import { EVENTS } from "../state.js";
import { escapeHtml, formatTime } from "../util.js";

export const id = "dispute";
export const title = "爭議 · AI 客服管家";
export const subtitle = "彙整全部存證，產出可交接人工客服的事證包";
export const nav = [{ label: "爭議／事證包", params: {}, order: 70 }];

/** 事證包 JSON 的 schema 名稱（人工客服端解析時的識別字串）。 */
const PACKAGE_SCHEMA = "pigeonpacket.irent.evidence-package/1";

const SIM_NOTE =
  "此頁的 AI 回應、條款引用與交接結論皆為 **模擬資料**，用於流程演示；非 iRent 官方條款，也不是真實 AI 輸出。";

// ------------------------------------------------------------------ 證據鏈定義

/**
 * 使用中回報的照片借用 `supplement` 群組存放（見 inuse.js：`meta.stage='inuse'`，
 * **不**併入租前基準）。證據鏈一定要按 `meta.stage` 分流，否則回報照片會被算成
 * 「補拍」——「開鎖後沒有補拍」這個缺漏會被回報照片蓋掉。
 */
const isSupplementShot = (p) => p?.meta?.stage !== "inuse";
const isInuseShot = (p) => p?.meta?.stage === "inuse";

/**
 * 證據鏈分段。`types` = 這一段要顯示哪些 timeline 事件；
 * `keyTypes` = 哪些事件才算「這一段有存證」（例：補拍窗口只有開啟與逾時事件，
 * 卻沒有任何 SUPPLEMENT_CAPTURE，那就是「窗口開了但沒補拍」= 沒有存證）。
 * `group` = 對應的照片群組，用來跟 timeline 交叉檢查（有照片卻沒事件也要講出來）。
 */
const CHAIN = [
  {
    key: "baseline",
    label: "取車基準（解鎖前）",
    group: "pickup",
    types: [EVENTS.VEHICLE_PREVIEW, EVENTS.PICKUP_CAPTURE, EVENTS.PICKUP_COMPLETE],
    keyTypes: [EVENTS.PICKUP_CAPTURE],
    gap: "沒有取車前存證 —— 無法證明既有損傷在你取車之前就已存在。",
    tone: "danger",
  },
  {
    key: "supplement",
    label: "開鎖後補拍窗口",
    group: "supplement",
    photoFilter: isSupplementShot,
    types: [
      EVENTS.UNLOCK,
      EVENTS.SUPPLEMENT_OPEN,
      EVENTS.SUPPLEMENT_CAPTURE,
      EVENTS.SUPPLEMENT_COMPLETE,
      EVENTS.SUPPLEMENT_EXPIRED,
    ],
    keyTypes: [EVENTS.SUPPLEMENT_CAPTURE],
    gap: "開鎖後沒有補拍 —— 車內狀況、以及取車時拍不清的角度沒有存證。",
    tone: "warn",
  },
  {
    key: "inuse",
    label: "使用中回報",
    /** 回報照片存在 supplement 群組，用 meta.stage 撈回來（見上方註解）。 */
    group: "supplement",
    photoFilter: isInuseShot,
    types: [EVENTS.REPORT_CREATED],
    keyTypes: [EVENTS.REPORT_CREATED],
    gap: "使用期間沒有任何回報 —— 若問題發生在使用中，缺少即時存證。",
    tone: "warn",
  },
  {
    key: "return",
    label: "還車存證",
    group: "return",
    types: [EVENTS.RETURN_CAPTURE, EVENTS.RETURN_COMPLETE],
    keyTypes: [EVENTS.RETURN_CAPTURE],
    gap: "沒有還車存證 —— 無法證明你交還車輛時的狀態。",
    tone: "danger",
  },
  {
    key: "compare",
    label: "AI 前後比對與判定",
    types: [
      EVENTS.AI_COMPARE,
      EVENTS.DAMAGE_CONFIRMED,
      EVENTS.DAMAGE_DISPUTED,
      EVENTS.HONEST_REPORT,
    ],
    keyTypes: [EVENTS.AI_COMPARE],
    gap: "尚未進行 AI 前後比對 —— 事證包會標記為「比對未完成」。",
    tone: "warn",
  },
];

const SEGMENT_OF_TYPE = new Map();
for (const seg of CHAIN) for (const t of seg.types) SEGMENT_OF_TYPE.set(t, seg.key);

/** 使用者可選的爭議理由；`focus` = 這個理由最需要哪一段存證。 */
const REASONS = [
  {
    id: "pre_existing",
    label: "這個刮痕取車時就有",
    focus: "baseline",
    text: "我認為這個痕跡在我取車前就已經存在了。",
  },
  {
    id: "not_mine",
    label: "不是我使用期間造成的",
    focus: "return",
    text: "這個損傷不是我使用期間造成的。",
  },
  {
    id: "interior",
    label: "車內髒污取車時就有",
    focus: "supplement",
    text: "車內的髒污／異味在我取車時就已經有了。",
  },
  {
    id: "after_return",
    label: "還車後才被弄壞",
    focus: "return",
    text: "我還車時車況正常，應該是還車之後才發生的。",
  },
  {
    id: "ai_wrong",
    label: "AI 判斷有誤",
    focus: "compare",
    text: "我認為 AI 的比對結果判斷有誤。",
  },
  { id: "other", label: "其他（自行描述）", focus: null, text: "" },
];

/** 模擬 RAG 引用來源。**全部標示為示意條文**，不是 iRent 官方原文。 */
const CITATIONS = [
  {
    id: "faq-pre-check",
    title: "租前車況確認與存證",
    quote:
      "會員應於取車前確認車輛外觀並拍照存證。已於取車前完成存證之既有損傷，不列入本次租借之損害責任範圍。",
    source: "模擬 FAQ 條目（示意，非 iRent 官方原文）",
    focus: ["baseline", "pre_existing"],
  },
  {
    id: "faq-liability",
    title: "車輛損傷責任認定基礎",
    quote:
      "車輛損傷之責任認定，以取車前與還車後之影像存證及其時間戳比對為基礎；缺乏影像存證者，依現場勘查與營運紀錄綜合認定。",
    source: "模擬條款（示意，非 iRent 官方原文）",
    focus: ["return", "compare", "not_mine", "after_return", "ai_wrong"],
  },
  {
    id: "faq-supplement",
    title: "開鎖後補拍存證窗口",
    quote:
      "開鎖後 15 分鐘內補拍之影像併入租前基準存證；逾時上傳之影像不列為正式存證鏈，僅供客服參考。",
    source: "PigeonPacket 設計提案（PIG-13 Screen 2），非現行條款",
    focus: ["supplement", "interior"],
  },
  {
    id: "faq-dispute-window",
    title: "爭議提出方式與時限",
    quote:
      "對車損認定有異議者，應於收到通知後 7 日內提出，並得檢附影像、時間戳及行車紀錄等事證，由客服人員複核。",
    source: "模擬 FAQ 條目（示意，非 iRent 官方原文）",
    focus: ["*"],
  },
  {
    id: "faq-self-report",
    title: "誠實申報減免",
    quote:
      "主動申報本次租借造成之損傷者，得依規定簡化理賠程序並保留既有回饋權益。",
    source: "PigeonPacket 設計提案（PIG-13 Screen 5），非現行條款",
    focus: ["compare"],
  },
];

// ------------------------------------------------------------------ CSS

export const css = `
.dispute-sim {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.45;
}
.dispute-sim .badge { flex: 0 0 auto; }

.dispute-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.dispute-stat {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 6px;
  text-align: center;
  min-width: 0;
}
.dispute-stat b { display: block; font-size: 19px; line-height: 1.15; }
.dispute-stat span { font-size: 10px; color: var(--muted); }

/* ---------------------------------------------------------------- 證據鏈 */

.dispute-chain { list-style: none; margin: 0; padding: 0; }
.dispute-seg {
  display: flex;
  gap: 10px;
  padding-bottom: 12px;
  position: relative;
}
.dispute-seg:last-child { padding-bottom: 0; }
.dispute-rail {
  flex: 0 0 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.dispute-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  margin-top: 4px;
  border: 2px solid var(--accent);
  background: var(--accent);
}
.dispute-seg.is-weak .dispute-dot { border-color: var(--warn); background: var(--warn); }
.dispute-seg.is-missing .dispute-dot { background: transparent; border-color: #4a5a6f; border-style: dashed; }
.dispute-seg.is-missing.tone-danger .dispute-dot { border-color: var(--danger); }
.dispute-line {
  flex: 1 1 auto;
  width: 2px;
  min-height: 12px;
  background: var(--line);
  margin: 3px 0 0;
}
.dispute-seg:last-child .dispute-line { display: none; }

.dispute-seg-body { flex: 1 1 auto; min-width: 0; }
.dispute-seg-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}
.dispute-seg-meta {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  margin: 2px 0 0;
}

.dispute-events { list-style: none; margin: 6px 0 0; padding: 0; }
.dispute-events li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.45;
  padding: 3px 0;
  border-top: 1px solid rgba(42, 53, 69, 0.7);
}
.dispute-events li:first-child { border-top: none; }
.dispute-ts {
  flex: 0 0 40px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  padding-top: 1px;
}
.dispute-ev { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dispute-ev small { display: block; color: var(--muted); font-size: 10.5px; }

.dispute-gap {
  margin: 6px 0 0;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px dashed rgba(245, 166, 35, 0.55);
  background: rgba(245, 166, 35, 0.08);
  font-size: 12px;
  line-height: 1.45;
  color: #f3d3a0;
}
.dispute-gap.tone-danger {
  border-color: rgba(255, 107, 107, 0.55);
  background: rgba(255, 107, 107, 0.08);
  color: #ffc4c4;
}

.dispute-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 6px 0 0;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.dispute-strip::-webkit-scrollbar { display: none; }
.dispute-strip figure {
  flex: 0 0 54px;
  margin: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #1d2532;
}
.dispute-strip img { width: 54px; height: 54px; object-fit: cover; display: block; }
.dispute-strip .dispute-noimg {
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--muted);
  text-align: center;
  padding: 2px;
}
.dispute-strip figcaption {
  font-size: 9px;
  color: var(--muted);
  padding: 2px 3px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------------------------------------------------------------- 比對結果 */

.dispute-findings { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12.5px; }
.dispute-findings li {
  display: flex;
  gap: 6px;
  padding: 4px 0;
  border-top: 1px solid rgba(42, 53, 69, 0.7);
  overflow-wrap: anywhere;
}
.dispute-findings li:first-child { border-top: none; }

/* ---------------------------------------------------------------- 對話 */

.dispute-chat { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.dispute-msg {
  max-width: 92%;
  padding: 8px 10px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dispute-msg.ai {
  align-self: flex-start;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-bottom-left-radius: 4px;
}
.dispute-msg.me {
  align-self: flex-end;
  background: rgba(0, 194, 168, 0.16);
  border: 1px solid rgba(0, 194, 168, 0.4);
  border-bottom-right-radius: 4px;
}
.dispute-msg .dispute-msg-ts {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.dispute-msg ul { margin: 6px 0 0; padding-left: 18px; }
.dispute-msg li { margin: 2px 0; }
.dispute-typing { color: var(--muted); font-size: 12px; }

.dispute-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 8px; }
.dispute-chip {
  border: 1px solid #3a4a5f;
  background: var(--surface);
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.dispute-chip.active { border-color: var(--accent); color: var(--accent); background: rgba(0, 194, 168, 0.13); }

.dispute-input {
  width: 100%;
  max-width: 100%;
  min-height: 68px;
  resize: vertical;
  background: #131b26;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.dispute-input:focus { outline: 1px solid var(--accent); border-color: var(--accent); }

/* ---------------------------------------------------------------- 條款引用 */

.dispute-cite { border-top: 1px solid var(--line); padding: 8px 0 0; margin-top: 8px; }
.dispute-cite:first-of-type { border-top: none; }
.dispute-cite h3 { margin: 0 0 4px; font-size: 13px; }
.dispute-cite blockquote {
  margin: 0;
  padding-left: 9px;
  border-left: 2px solid var(--accent-dim);
  font-size: 12.5px;
  line-height: 1.5;
  color: #d8e2ee;
  overflow-wrap: anywhere;
}
.dispute-cite p { margin: 4px 0 0; font-size: 10.5px; color: var(--muted); }

/* ---------------------------------------------------------------- 事證包 */

.dispute-json {
  margin: 8px 0 0;
  max-height: 260px;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  background: #0c1218;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre;
  color: #b9ccdf;
  tab-size: 2;
}
.dispute-copy-state { font-size: 12px; margin: 8px 0 0; min-height: 17px; }

.dispute-log { margin-top: 10px; }
.dispute-log > summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
  padding: 4px 0;
}
.dispute-log[open] > summary { color: var(--text); }
.dispute-log .dispute-events { max-height: 240px; overflow-y: auto; }
`;

// ------------------------------------------------------------------ helpers

function ms(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function dateLabel(iso) {
  const t = ms(iso);
  if (t == null) return "--";
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** timeline 依時間排序（時間無效的事件退回原始順序，不會炸也不會被吃掉）。 */
function sortedTimeline(timeline) {
  const rows = (Array.isArray(timeline) ? timeline : [])
    .filter((e) => e && typeof e === "object")
    .map((e, i) => ({ e, i, t: ms(e.at) }));
  rows.sort((a, b) => {
    const at = a.t == null ? Number.POSITIVE_INFINITY : a.t;
    const bt = b.t == null ? Number.POSITIVE_INFINITY : b.t;
    if (at !== bt) return at < bt ? -1 : 1;
    return a.i - b.i;
  });
  return rows.map((r) => r.e);
}

/** 事件 detail 摘要（只取原始型別的欄位，長值截斷；純顯示用）。 */
function detailSummary(detail) {
  if (!detail || typeof detail !== "object") return "";
  const parts = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || typeof v === "object") continue;
    let text = String(v);
    if (text.length > 26) text = `${text.slice(0, 25)}…`;
    parts.push(`${k}=${text}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ");
}

const RANGE = (list) => {
  const times = list.map((x) => ms(x)).filter((t) => t != null);
  if (!times.length) return null;
  return { first: Math.min(...times), last: Math.max(...times) };
};

function rangeLabel(range) {
  if (!range) return "";
  const a = formatTime(new Date(range.first));
  const b = formatTime(new Date(range.last));
  return a === b ? a : `${a}–${b}`;
}

/**
 * 容錯讀取 Track C 的 flags.compareResult。
 * 欄位名一律「猜多個常見寫法」，猜不到就原樣顯示 JSON —— 絕不因為形狀不符而拋錯。
 */
function readCompare(state, hasCompareEvent) {
  const out = {
    present: false,
    raw: null,
    rawText: null,
    shapeKnown: false,
    verdict: null,
    verdictLabel: null,
    tone: "muted",
    summary: null,
    findings: [],
    note: null,
  };
  let raw = null;
  try {
    raw = state.getFlag("compareResult", null);
  } catch {
    raw = null;
  }
  if (raw == null || raw === "") {
    out.note = hasCompareEvent
      ? "時間軸有比對事件，但 flags.compareResult 尚未寫入（比對模組可能仍在開發中）。事證包會標記為「比對結果缺漏」。"
      : "尚未進行 AI 前後比對，或比對模組尚未上線。";
    return out;
  }
  out.present = true;
  out.raw = raw;
  try {
    out.rawText = JSON.stringify(raw, null, 2);
  } catch {
    out.rawText = String(raw);
  }

  const pickString = (obj, keys) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  let verdictRaw = null;
  if (typeof raw === "string") {
    verdictRaw = raw;
    out.shapeKnown = true;
  } else if (typeof raw === "object") {
    verdictRaw = pickString(raw, ["verdict", "result", "status", "level", "outcome", "scenario"]);
    out.summary = pickString(raw, ["summary", "note", "message", "description", "detail", "label"]);
    const listKey = [
      "findings",
      "diffs",
      "regions",
      "items",
      "damages",
      "issues",
      "suspects",
      "areas",
      "marks",
      "boxes",
    ].find((k) => Array.isArray(raw[k]));
    if (listKey) {
      out.findings = raw[listKey].slice(0, 12).map((item) => {
        if (item == null) return { label: "（空白項目）", severity: null, note: null };
        if (typeof item !== "object") return { label: String(item), severity: null, note: null };
        return {
          label:
            pickString(item, ["label", "title", "name", "area", "part", "zone", "angle", "id"]) ||
            "未命名差異",
          severity: pickString(item, ["severity", "level", "type", "verdict", "status"]),
          note: pickString(item, ["note", "detail", "description", "summary", "reason"]),
        };
      });
    }
    out.shapeKnown = !!(verdictRaw || out.summary || out.findings.length);
  }

  if (verdictRaw) {
    const v = verdictRaw.toLowerCase();
    if (/clean|ok|pass|none|no_?damage|無/.test(v)) {
      out.verdict = "clean";
      out.verdictLabel = "無新增損傷";
      out.tone = "ok";
    } else if (/suspect|maybe|warn|possible|疑/.test(v)) {
      out.verdict = "suspect";
      out.verdictLabel = "疑似新增差異";
      out.tone = "warn";
    } else if (/damage|confirm|new|明顯|損/.test(v)) {
      out.verdict = "damage";
      out.verdictLabel = "偵測到新增損傷";
      out.tone = "danger";
    } else {
      out.verdict = verdictRaw;
      out.verdictLabel = verdictRaw;
      out.tone = "muted";
    }
  }
  if (!out.shapeKnown) {
    out.note = "比對結果的欄位格式無法辨識，以下原樣呈現（事證包會完整帶上原始物件）。";
  }
  return out;
}

/** 建立證據鏈：每一段的事件、照片、時間範圍與狀態（ok / weak / missing）。 */
function buildChain(state, events) {
  const byKey = new Map(CHAIN.map((seg) => [seg.key, []]));
  const others = [];
  for (const ev of events) {
    const key = SEGMENT_OF_TYPE.get(ev.type);
    if (key) byKey.get(key).push(ev);
    else others.push(ev);
  }
  const segments = CHAIN.map((seg) => {
    const list = byKey.get(seg.key) || [];
    let photos = [];
    if (seg.group) {
      try {
        photos = state.getCaptures(seg.group) || [];
      } catch {
        photos = [];
      }
      if (seg.photoFilter) photos = photos.filter(seg.photoFilter);
    }
    const hasKey = list.some((e) => seg.keyTypes.includes(e.type));
    const range = RANGE([...list.map((e) => e.at), ...photos.map((p) => p.at)]);
    let status = "missing";
    let gap = seg.gap;
    if (hasKey || photos.some((p) => !p.skipped)) {
      status = "ok";
      gap = null;
    } else if (list.length || photos.length) {
      status = "weak";
      gap = photos.length
        ? `這一段的 ${photos.length} 張紀錄全部是「跳過」，沒有實際影像 —— 等同沒有存證。`
        : `${seg.gap}（時間軸只有流程事件，沒有存證事件）`;
    }
    if (status === "ok" && photos.length && !list.length) {
      gap = `有 ${photos.length} 張照片，但時間軸缺少對應事件（拍照畫面尚未寫入 timeline）。`;
    }
    return { ...seg, events: list, photos, hasKey, range, status, gap };
  });
  return { segments, others };
}

/** 依證據鏈與使用者描述生成「模擬 AI 分析」—— 只陳述事實，不編造統計數字。 */
function buildAnalysis(chain, compare, reason) {
  const seg = (key) => chain.segments.find((s) => s.key === key);
  const lines = [];
  for (const s of chain.segments) {
    if (s.key === "compare") continue;
    const shots = s.photos.filter((p) => !p.skipped).length;
    if (s.status === "ok") {
      const bits = [];
      if (s.photos.length) bits.push(`${shots} 張影像`);
      if (s.events.length) bits.push(`${s.events.length} 筆事件`);
      lines.push(`${s.label}：${bits.join("、") || "有紀錄"}，時間 ${rangeLabel(s.range) || "--"}`);
    } else {
      lines.push(`${s.label}：無存證 ⚠`);
    }
  }
  if (compare.present) {
    lines.push(
      `AI 比對結果：${compare.verdictLabel || "（格式未辨識）"}${
        compare.findings.length ? `，${compare.findings.length} 處差異` : ""
      }`
    );
  } else {
    lines.push("AI 比對結果：尚未取得（事證包標記為缺漏）");
  }

  const focus = reason?.focus ? seg(reason.focus) : null;
  let opinion;
  if (focus && focus.status !== "ok") {
    opinion =
      `你的爭議點最需要「${focus.label}」這一段的證據，而這一段目前沒有存證。` +
      "客服會改以車輛歷史紀錄與現場勘查判斷，結論可能對你不利 —— 這正是取車／還車當下多拍幾張的價值。";
  } else if (focus && focus.status === "ok") {
    opinion =
      `你的爭議點對應「${focus.label}」，這一段有影像與時間戳可以直接引用，` +
      "我會把它放在事證包最前面供人工客服比對。";
  } else {
    const missing = chain.segments.filter((s) => s.status !== "ok");
    opinion = missing.length
      ? `本案的事證鏈有 ${missing.length} 段缺漏，我已在事證包中逐段標註，避免人工客服誤判為「沒查」。`
      : "本案事證鏈完整（取車、補拍、還車、比對皆有紀錄），可直接交人工客服複核。";
  }
  return { lines, opinion };
}

function pickCitations(reason, chain) {
  const focusKeys = new Set(["*"]);
  if (reason?.focus) focusKeys.add(reason.focus);
  if (reason?.id) focusKeys.add(reason.id);
  for (const s of chain.segments) if (s.status !== "ok") focusKeys.add(s.key);
  const hit = CITATIONS.filter((c) => c.focus.some((f) => focusKeys.has(f)));
  return (hit.length ? hit : CITATIONS).slice(0, 3);
}

// ------------------------------------------------------------------ mount

export function mount(root, ctx) {
  const { state, config } = ctx;
  const session = state.session;
  const timers = new Set();
  const later = (fn, delay) => {
    const t = setTimeout(() => {
      timers.delete(t);
      try {
        fn();
      } catch (err) {
        console.error("[dispute] 延遲工作失敗", err);
      }
    }, delay);
    timers.add(t);
    return t;
  };
  const AI_DELAY = config.speed === "fast" ? 180 : 640;

  // ---- 進入爭議流程（idempotent：直接從跳頁列進來也要成立）
  if (!state.getFlag("disputeOpened")) {
    state.setFlag("disputeOpened", new Date().toISOString());
  }
  const events = sortedTimeline(session.timeline);
  if (!events.some((e) => e.type === EVENTS.DAMAGE_DISPUTED)) {
    state.addEvent(EVENTS.DAMAGE_DISPUTED, { label: "使用者提出爭議，進入 AI 客服管家" });
  }

  const chain = buildChain(
    state,
    sortedTimeline(session.timeline) // 重新取，含剛寫入的 DAMAGE_DISPUTED
  );
  const compare = readCompare(
    state,
    chain.segments.some((s) => s.key === "compare" && s.hasKey)
  );

  const captures = state.allCaptures();
  const shots = captures.filter((c) => !c.skipped);
  const capRange = RANGE(captures.map((c) => c.at));
  const missingSegments = chain.segments.filter((s) => s.status !== "ok");

  ctx.setHeader({
    title: "爭議 · AI 客服管家",
    subtitle: `已彙整 ${shots.length} 張存證 · ${session.timeline.length} 筆時間軸事件${
      missingSegments.length ? ` · ${missingSegments.length} 段缺漏` : " · 事證鏈完整"
    }`,
  });
  ctx.setFootnote(
    "事證包為模擬資料，僅含 metadata 與時間戳（不含影像位元）。條款引用為示意條文，非 iRent 官方原文。"
  );

  const local = {
    reason: null,
    messages: [],
    submitted: false,
    // 已經產出過事證包（回訪時不要重複寫 timeline 事件）
    exported: !!state.getFlag("evidenceExportedAt"),
  };

  // ---------------------------------------------------------------- 版面

  root.innerHTML = `
    <div class="notice warn dispute-sim">
      <span class="badge warn">模擬資料</span>
      <span>本畫面的 AI 客服回應、條款引用與交接結論皆為<strong>模擬</strong>，用於流程演示；
      非 iRent 官方條款，也不是真實 AI 輸出。事證鏈的照片張數與時間戳則來自本次 demo 的真實操作紀錄。</span>
    </div>

    <div class="progress">
      <div class="progress-bar" data-el="bar" style="--pct:25%"></div>
      <ol class="steps" data-el="steps">
        <li class="active">1 彙整事證</li>
        <li>2 描述爭議</li>
        <li>3 條款引用</li>
        <li>4 事證包</li>
      </ol>
    </div>

    <div class="card">
      <h2 class="section-title">① 自動彙整</h2>
      <div class="dispute-summary">
        <div class="dispute-stat"><b>${shots.length}</b><span>張存證影像</span></div>
        <div class="dispute-stat"><b>${session.timeline.length}</b><span>筆時間軸事件</span></div>
        <div class="dispute-stat">
          <b>${missingSegments.length}</b><span>段事證缺漏</span></div>
      </div>
      <dl class="kv" style="margin-top:10px">
        <dt>車輛</dt><dd>${escapeHtml(session.vehicle?.plate || "--")} ${escapeHtml(
          session.vehicle?.model || ""
        )}</dd>
        <dt>案件時間</dt><dd>${capRange ? escapeHtml(dateLabel(new Date(capRange.first).toISOString())) : "--"} ${
          capRange ? escapeHtml(rangeLabel(capRange)) : ""
        }</dd>
        <dt>爭議開啟</dt><dd>${escapeHtml(
          formatTime(state.getFlag("disputeOpened") || new Date().toISOString())
        )}</dd>
      </dl>
      ${
        session.storage === "degraded"
          ? `<div class="notice warn" style="margin-bottom:0">本機儲存空間不足，影像縮圖已被捨棄，僅保留 metadata 與時間戳（事證包不受影響）。</div>`
          : ""
      }
    </div>

    <div class="card">
      <h2 class="section-title">事證時間軸（證據鏈）</h2>
      <p class="muted" style="margin:0 0 10px">依時間順序串起取車基準 → 補拍 → 使用中回報 → 還車 → 比對。
      <strong>沒有存證的區段會直接標示出來</strong> —— 那本身就是判斷責任的重要資訊。</p>
      <ul class="dispute-chain" data-el="chain"></ul>

      <details class="dispute-log">
        <summary>顯示完整事件流（${session.timeline.length} 筆，含系統事件）</summary>
        <ul class="dispute-events" data-el="fullLog"></ul>
      </details>
    </div>

    <div class="card" data-el="compareCard">
      <h2 class="section-title">比對 diff（來自比對模組）</h2>
      <div data-el="compareBody"></div>
    </div>

    <div class="card">
      <h2 class="section-title">② 對話式引導 <span class="badge warn">模擬 AI</span></h2>
      <div class="dispute-chat" data-el="chat"></div>
      <div class="dispute-chips" data-el="chips"></div>
      <label class="muted" for="dispute-text" style="display:block;margin-bottom:4px">
        請描述您認為有爭議的部分</label>
      <textarea class="dispute-input" id="dispute-text" data-el="text"
        placeholder="例：左後保桿的刮痕在我取車前就有，取車時的照片可以看到。"></textarea>
      <div class="actions">
        <button type="button" class="btn secondary" data-el="btnSkip">略過描述，直接產生事證包</button>
        <button type="button" class="btn primary full" data-el="btnSend">送出給 AI 客服管家</button>
      </div>
    </div>

    <div class="card hidden" data-el="citeCard">
      <h2 class="section-title">③ 條款／FAQ 引用 <span class="badge warn">模擬 RAG</span></h2>
      <p class="muted" style="margin:0">以下條文為<strong>示意內容</strong>，用於演示 RAG 引用格式，
      並非 iRent 官方條款原文。正式版應改接真實條款庫。</p>
      <div data-el="citeBody"></div>
    </div>

    <div class="card hidden" data-el="pkgCard">
      <h2 class="section-title">④ 事證包（交人工客服）</h2>
      <p class="muted" style="margin:0 0 6px">
        schema <code>${escapeHtml(PACKAGE_SCHEMA)}</code>｜僅含 metadata、時間戳、缺漏標註與模擬對話紀錄，
        <strong>不含影像位元</strong>（原型不輸出照片檔）。</p>
      <pre class="dispute-json" data-el="json" tabindex="0"></pre>
      <div class="actions">
        <button type="button" class="btn ghost" data-el="btnCopy">複製事證包 JSON</button>
        <button type="button" class="btn primary" data-el="btnHandoff">送交人工客服</button>
      </div>
      <p class="dispute-copy-state muted" data-el="copyState"></p>
      <div class="actions">
        <button type="button" class="btn secondary" data-el="btnSettle">前往積分結算</button>
      </div>
    </div>
  `;

  const els = {};
  root.querySelectorAll("[data-el]").forEach((n) => {
    els[n.dataset.el] = n;
  });

  // ---------------------------------------------------------------- 渲染：證據鏈

  function eventRow(ev) {
    const detail = detailSummary(ev.detail);
    return `<li>
      <span class="dispute-ts">${escapeHtml(formatTime(ev.at))}</span>
      <span class="dispute-ev">${escapeHtml(ev.label || ev.type)}
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</span>
    </li>`;
  }

  function stripHtml(photos) {
    if (!photos.length) return "";
    return `<div class="dispute-strip">${photos
      .map((p) => {
        const src = p.fullDataUrl || p.dataUrl;
        const cap = `${p.label || p.category || "照片"}${p.skipped ? "（跳過）" : ""}`;
        return `<figure>${
          src
            ? `<img src="${src}" alt="${escapeHtml(cap)}" />`
            : `<div class="dispute-noimg">${p.skipped ? "跳過" : "無縮圖"}</div>`
        }<figcaption>${escapeHtml(cap)}</figcaption></figure>`;
      })
      .join("")}</div>`;
  }

  els.chain.innerHTML = chain.segments
    .map((s, i) => {
      const badge =
        s.status === "ok"
          ? `<span class="badge ok">有存證</span>`
          : s.status === "weak"
            ? `<span class="badge warn">不足</span>`
            : `<span class="badge ${s.tone === "danger" ? "danger" : "warn"}">缺漏</span>`;
      const shotCount = s.photos.filter((p) => !p.skipped).length;
      const meta = [
        s.range ? rangeLabel(s.range) : "無時間戳",
        s.photos.length ? `${shotCount}/${s.photos.length} 張有影像` : null,
        `${s.events.length} 筆事件`,
      ]
        .filter(Boolean)
        .join(" ｜ ");
      return `<li class="dispute-seg is-${s.status} tone-${s.tone}">
        <span class="dispute-rail"><span class="dispute-dot"></span><span class="dispute-line"></span></span>
        <div class="dispute-seg-body">
          <div class="dispute-seg-head"><span>${i + 1}. ${escapeHtml(s.label)}</span>${badge}</div>
          <p class="dispute-seg-meta">${escapeHtml(meta)}</p>
          ${s.events.length ? `<ul class="dispute-events">${s.events.map(eventRow).join("")}</ul>` : ""}
          ${stripHtml(s.photos)}
          ${
            s.gap
              ? `<p class="dispute-gap ${s.tone === "danger" && s.status === "missing" ? "tone-danger" : ""}">
                  ${escapeHtml(s.gap)}</p>`
              : ""
          }
        </div>
      </li>`;
    })
    .join("");

  const allSorted = sortedTimeline(session.timeline);
  els.fullLog.innerHTML =
    allSorted.map(eventRow).join("") ||
    `<li><span class="dispute-ev muted">時間軸沒有任何事件。</span></li>`;

  // ---------------------------------------------------------------- 渲染：比對

  function renderCompare() {
    const parts = [];
    if (compare.present && compare.verdictLabel) {
      const cls =
        compare.tone === "ok" ? "ok" : compare.tone === "danger" ? "danger" : compare.tone === "warn" ? "warn" : "";
      parts.push(
        `<div class="notice ${cls}" style="margin-top:0"><strong>${escapeHtml(
          compare.verdictLabel
        )}</strong>${compare.summary ? `　${escapeHtml(compare.summary)}` : ""}</div>`
      );
    }
    if (compare.findings.length) {
      parts.push(
        `<ul class="dispute-findings">${compare.findings
          .map(
            (f) =>
              `<li><span class="badge ${
                /damage|明顯|high|嚴重/i.test(f.severity || "")
                  ? "danger"
                  : /suspect|疑|medium|warn/i.test(f.severity || "")
                    ? "warn"
                    : ""
              }">${escapeHtml(f.severity || "差異")}</span>
              <span>${escapeHtml(f.label)}${f.note ? `<br><small class="muted">${escapeHtml(f.note)}</small>` : ""}</span></li>`
          )
          .join("")}</ul>`
      );
    }
    if (compare.note) {
      parts.push(`<p class="muted" style="margin:8px 0 0">${escapeHtml(compare.note)}</p>`);
    }
    if (compare.present && !compare.shapeKnown && compare.rawText) {
      parts.push(`<pre class="dispute-json">${escapeHtml(compare.rawText)}</pre>`);
    }
    if (!compare.present) {
      parts.push(
        `<p class="muted" style="margin:8px 0 0">爭議仍可送出：事證包會把 <code>compare</code> 標記為
        <code>null</code> 並附上缺漏原因，人工客服看得到「這裡本來應該有比對結果」。</p>`
      );
    }
    els.compareBody.innerHTML = parts.join("");
  }
  renderCompare();

  // ---------------------------------------------------------------- 事證包

  function buildPackage() {
    const now = new Date().toISOString();
    // timeline 現場重讀：產出當下的完整事件流（含其他 track 在本畫面停留期間寫入的事件）
    const tl = sortedTimeline(session.timeline);
    const flags = { ...(session.flags || {}) };
    delete flags.compareResult; // 已完整放在 compare.raw，避免重複
    return {
      schema: PACKAGE_SCHEMA,
      generatedAt: now,
      simulated: true,
      simulationNote:
        "由 PigeonPacket iRent 原型產生。AI 回應與條款引用為模擬資料；照片張數、時間戳與缺漏標註來自本次 demo 的真實操作紀錄。不含影像位元。",
      case: {
        sessionId: session.id,
        startedAt: session.startedAt,
        phase: session.phase,
        scenario: session.scenario ?? null,
        disputeOpenedAt: state.getFlag("disputeOpened", null),
        storage: session.storage,
      },
      vehicle: { ...(session.vehicle || {}) },
      claim: {
        reasonId: local.reason?.id ?? null,
        reasonLabel: local.reason?.label ?? null,
        statement: (els.text.value || "").trim() || null,
      },
      captures: {
        counts: {
          total: captures.length,
          withImage: shots.length,
          skipped: captures.length - shots.length,
          pickup: safeCount("pickup"),
          // supplement 群組同時存了「補拍」與「使用中回報」的照片，分開報數
          supplement: safeGroup("supplement").filter(isSupplementShot).length,
          inuseReport: safeGroup("supplement").filter(isInuseShot).length,
          return: safeCount("return"),
        },
        timestampRange: capRange
          ? {
              first: new Date(capRange.first).toISOString(),
              last: new Date(capRange.last).toISOString(),
            }
          : null,
        imagesIncluded: false,
        imagesNote: "原型僅輸出 metadata；正式版應改為附件或物件儲存連結。",
        items: captures.map((c) => ({
          id: c.id,
          group: c.group,
          category: c.category,
          angle: c.angle ?? null,
          label: c.label,
          at: c.at,
          skipped: !!c.skipped,
          qualityOk: c.quality?.ok ?? null,
          qualityIssues: Array.isArray(c.quality?.issues) ? c.quality.issues : [],
          hasImage: !!(c.fullDataUrl || c.dataUrl),
        })),
      },
      reports: (session.reports || []).map((r) => ({
        id: r.id,
        at: r.at,
        type: r.type,
        note: r.note,
        photoIds: r.photoIds || [],
      })),
      evidenceChain: chain.segments.map((s) => ({
        segment: s.key,
        label: s.label,
        status: s.status,
        eventCount: s.events.length,
        photoCount: s.photos.length,
        photoWithImage: s.photos.filter((p) => !p.skipped).length,
        firstAt: s.range ? new Date(s.range.first).toISOString() : null,
        lastAt: s.range ? new Date(s.range.last).toISOString() : null,
        gap: s.gap ?? null,
      })),
      gaps: chain.segments.filter((s) => s.status !== "ok").map((s) => `${s.label}：${s.gap}`),
      timeline: tl.map((e) => ({
        at: e.at,
        type: e.type,
        phase: e.phase ?? null,
        label: e.label,
        detail: e.detail ?? {},
      })),
      compare: compare.present
        ? { available: true, verdict: compare.verdict, shapeRecognized: compare.shapeKnown, raw: compare.raw }
        : { available: false, reason: compare.note },
      points: {
        total: state.totalPoints(),
        awarded: (session.points?.awarded || []).map((a) => ({
          ruleId: a.ruleId,
          points: a.points,
          at: a.at,
        })),
      },
      aiTranscript: local.messages.map((m) => ({
        role: m.role,
        at: m.at,
        text: m.role === "ai" ? [m.text, ...(m.lines || [])].filter(Boolean).join("\n") : m.text,
        simulated: m.role === "ai",
      })),
      citations: pickCitations(local.reason, chain).map((c) => ({
        id: c.id,
        title: c.title,
        quote: c.quote,
        source: c.source,
        simulated: true,
      })),
      flags,
      handoff: {
        channel: "人工客服",
        suggestedNextStep: missingSegments.length
          ? "事證鏈有缺漏區段，建議客服補問使用者並調閱車輛歷史紀錄"
          : "事證鏈完整，建議客服直接比對取車／還車影像時間戳",
      },
    };
  }

  function safeGroup(group) {
    try {
      return state.getCaptures(group) || [];
    } catch {
      return [];
    }
  }

  function safeCount(group) {
    return safeGroup(group).length;
  }

  let packageText = "";
  function renderPackage() {
    try {
      packageText = JSON.stringify(buildPackage(), null, 2);
    } catch (err) {
      console.warn("[dispute] 事證包序列化失敗，改用精簡版", err);
      packageText = JSON.stringify(
        { schema: PACKAGE_SCHEMA, error: "序列化失敗", sessionId: session.id },
        null,
        2
      );
    }
    els.json.textContent = packageText;
    // 事證包已經產出並顯示在畫面上 → 這就是 flags.evidenceExportedAt 的語意。
    // （複製 / 送交只是後續動作，剪貼簿被瀏覽器擋住時旗標也不會漏寫。）
    markExported("產出事證包");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        // 有些環境（無焦點的分頁 / 權限未決）writeText 的 promise 會一直不 settle，
        // 這裡加一個逾時，避免按鈕永遠停在 disabled。
        const ok = await Promise.race([
          navigator.clipboard.writeText(text).then(() => true),
          new Promise((resolve) => later(() => resolve(false), 1200)),
        ]);
        if (ok) return true;
      }
    } catch {
      /* 往下走 fallback */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) return true;
    } catch {
      /* 最後才放棄 */
    }
    return false;
  }

  function markExported(how) {
    if (!state.getFlag("evidenceExportedAt")) {
      state.setFlag("evidenceExportedAt", new Date().toISOString());
    }
    if (!local.exported) {
      local.exported = true;
      state.addEvent(EVENTS.EVIDENCE_EXPORTED, {
        label: `事證包產出（${how}）`,
        via: how,
        segments: chain.segments.length,
        gaps: missingSegments.length,
        captures: captures.length,
      });
    }
  }

  async function onCopy() {
    els.btnCopy.disabled = true;
    const ok = await copyText(packageText);
    els.btnCopy.disabled = false;
    if (ok) {
      markExported("複製到剪貼簿");
      els.copyState.className = "dispute-copy-state";
      els.copyState.innerHTML = `<span class="badge ok">已複製</span> ${packageText.length.toLocaleString()} 字元已進剪貼簿 · flags.evidenceExportedAt = ${escapeHtml(
        formatTime(state.getFlag("evidenceExportedAt"))
      )}`;
    } else {
      // 剪貼簿被瀏覽器擋住時：幫使用者選好文字，請他自己按 Cmd/Ctrl+C
      try {
        const range = document.createRange();
        range.selectNodeContents(els.json);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        /* ignore */
      }
      els.copyState.className = "dispute-copy-state";
      els.copyState.innerHTML = `<span class="badge warn">剪貼簿被瀏覽器封鎖</span> 已選取 JSON 內容，請按 ⌘/Ctrl + C 複製。`;
    }
  }

  function onHandoff() {
    markExported("送交人工客服");
    els.btnHandoff.disabled = true;
    els.btnHandoff.textContent = "已送交人工客服（模擬）";
    pushAi(
      "事證包已送交人工客服（模擬）。",
      [
        `案件編號（模擬）：${session.id}`,
        `交接內容：${chain.segments.length} 段證據鏈、${captures.length} 筆照片 metadata、${session.timeline.length} 筆時間軸事件`,
        missingSegments.length
          ? `已標註 ${missingSegments.length} 段缺漏，客服會依此補問`
          : "事證鏈完整，客服可直接比對",
      ],
      { scrollTo: els.chat }
    );
    renderPackage();
  }

  // ---------------------------------------------------------------- 對話

  function messageHtml(m) {
    const body =
      m.role === "ai"
        ? `${escapeHtml(m.text)}${
            m.lines?.length
              ? `<ul>${m.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
              : ""
          }`
        : escapeHtml(m.text);
    return `<div class="dispute-msg ${m.role === "ai" ? "ai" : "me"}">${body}
      <span class="dispute-msg-ts">${m.role === "ai" ? "AI 客服管家（模擬）· " : "你 · "}${escapeHtml(
        formatTime(m.at)
      )}</span></div>`;
  }

  function renderChat(typing) {
    els.chat.innerHTML =
      local.messages.map(messageHtml).join("") +
      (typing ? `<div class="dispute-msg ai dispute-typing">AI 客服管家正在整理事證…</div>` : "");
  }

  function pushAi(text, lines, options = {}) {
    local.messages.push({ role: "ai", at: new Date().toISOString(), text, lines: lines || [] });
    renderChat(false);
    if (options.scrollTo) {
      try {
        options.scrollTo.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } catch {
        /* ignore */
      }
    }
  }

  function setStep(n) {
    els.bar.style.setProperty("--pct", `${(n / 4) * 100}%`);
    [...els.steps.children].forEach((li, i) => {
      li.classList.toggle("active", i === n - 1);
      li.classList.toggle("done", i < n - 1);
    });
  }

  function renderCitations() {
    const list = pickCitations(local.reason, chain);
    els.citeBody.innerHTML = list
      .map(
        (c) => `<div class="dispute-cite">
          <h3>${escapeHtml(c.title)}</h3>
          <blockquote>${escapeHtml(c.quote)}</blockquote>
          <p>來源：${escapeHtml(c.source)}</p>
        </div>`
      )
      .join("");
  }

  function submit(reasonFallbackText) {
    if (local.submitted) return;
    const typed = (els.text.value || "").trim();
    const statement = typed || local.reason?.text || reasonFallbackText || "（未填寫描述，直接請求事證包）";
    if (!typed) els.text.value = statement;
    local.submitted = true;
    els.btnSend.disabled = true;
    els.btnSkip.disabled = true;

    local.messages.push({ role: "me", at: new Date().toISOString(), text: statement });
    renderChat(true);
    setStep(2);

    later(() => {
      const analysis = buildAnalysis(chain, compare, local.reason);
      pushAi("我已比對你這次租借的全部存證，逐段結果如下（模擬分析，僅陳述紀錄事實）：", analysis.lines, {
        scrollTo: els.chat,
      });
      later(() => {
        pushAi(analysis.opinion, [], { scrollTo: els.chat });
        renderCitations();
        els.citeCard.classList.remove("hidden");
        setStep(3);
        later(() => {
          renderPackage();
          els.pkgCard.classList.remove("hidden");
          setStep(4);
          try {
            els.pkgCard.scrollIntoView({ behavior: "smooth", block: "start" });
          } catch {
            /* ignore */
          }
        }, AI_DELAY);
      }, AI_DELAY);
    }, AI_DELAY);
  }

  // 理由 chips
  els.chips.innerHTML = REASONS.map(
    (r) => `<button type="button" class="dispute-chip" data-reason="${r.id}">${escapeHtml(r.label)}</button>`
  ).join("");
  els.chips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-reason]");
    if (!btn || local.submitted) return;
    local.reason = REASONS.find((r) => r.id === btn.dataset.reason) || null;
    [...els.chips.children].forEach((c) => c.classList.toggle("active", c === btn));
    if (local.reason?.text && !els.text.value.trim()) els.text.value = local.reason.text;
    els.text.focus();
  });

  els.btnSend.addEventListener("click", () => submit());
  els.btnSkip.addEventListener("click", () => submit("（略過描述，請直接產生事證包）"));
  els.btnCopy.addEventListener("click", onCopy);
  els.btnHandoff.addEventListener("click", onHandoff);
  els.btnSettle.addEventListener("click", () => {
    if (ctx.router.isRegistered("settlement")) ctx.go("settlement");
    else alert("「#/settlement」尚未實作。");
  });

  // 開場訊息（步驟 1 已完成 → 引導使用者描述）
  const opening = [
    `取車基準：${chain.segments[0].status === "ok" ? `${chain.segments[0].photos.filter((p) => !p.skipped).length} 張` : "無存證"}`,
    `補拍：${chain.segments[1].status === "ok" ? `${chain.segments[1].photos.filter((p) => !p.skipped).length} 張` : "無存證"}`,
    `還車：${chain.segments[3].status === "ok" ? `${chain.segments[3].photos.filter((p) => !p.skipped).length} 張` : "無存證"}`,
    `AI 比對：${compare.present ? compare.verdictLabel || "已取得（格式未辨識）" : "尚未取得"}`,
  ];
  pushAi(
    `我是 AI 客服管家（模擬）。你這次租借的存證我已經整理好了 —— 共 ${shots.length} 張影像、${session.timeline.length} 筆時間軸事件。請描述您認為有爭議的部分，或直接點下方的常見理由。`,
    opening
  );
  setStep(1);

  if (state.getFlag("evidenceExportedAt")) {
    // 回訪：已產出過事證包 → 直接把步驟 3/4 攤開，簡報時不用重跑對話
    local.reason = null;
    renderCitations();
    els.citeCard.classList.remove("hidden");
    renderPackage();
    els.pkgCard.classList.remove("hidden");
    els.copyState.innerHTML = `<span class="badge ok">已產出</span> 上次事證包產出時間 ${escapeHtml(
      formatTime(state.getFlag("evidenceExportedAt"))
    )}（可重新複製）`;
    setStep(4);
  }

  // cleanup：清掉所有延遲工作（沒有 document/window listener 需要拆）
  return () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
  };
}
