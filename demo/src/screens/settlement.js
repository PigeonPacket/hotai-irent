/**
 * 積分結算（PIG-13 §5）
 *
 * 路由：#/settlement
 *
 * 兩件事，缺一不可：
 *   1. **積分**：完全以 points.js 的規則資料 + state.pointsBreakdown() 呈現，
 *      畫面裡沒有裸的數字。階段級互斥組（pickup_complete 取代 pickup_partial）會明確畫出來，
 *      並用「分數階梯」證明「亂拍／跳過」的分數一定低於「好好拍」—— 不會有反向激勵。
 *   2. **防禦性收尾**（實測 §3.2 動機雙軌的另一軌）：
 *      「你已建立 N 張存證，時間戳 xx–xx」，讓使用者感覺這些照片是他自己的證據，
 *      不只是流程負擔。沒有存證時也照實說：發生爭議時沒有照片可引用。
 *
 * 折抵比例是**假設值**（PIG-13 §5「具體比例待商業設計」），畫面上有標明。
 */

import { EVENTS } from "../state.js";
import { escapeHtml, formatTime } from "../util.js";

export const id = "settlement";
export const title = "積分結算";
export const subtitle = "本次租借的存證成果與可折抵金額";
export const nav = [{ label: "積分結算", params: {}, order: 80 }];

/** 模擬租金（僅為了讓折抵看得出比例；畫面上標明是模擬資料）。 */
const MOCK_FEE_TWD = 480;

const STAGE_LABEL = {
  pickup: "取車拍照",
  supplement: "開鎖後補拍",
  return: "還車拍照",
  report: "誠實申報",
};

export const css = `
.settle-hero {
  background: linear-gradient(135deg, #10403a, #16283a);
  border: 1px solid rgba(0, 194, 168, 0.35);
  border-radius: var(--radius);
  padding: 14px;
  margin: 12px 0;
}
.settle-hero-top { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.settle-total {
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.settle-total-unit { font-size: 14px; color: var(--muted); padding-bottom: 4px; }
.settle-hero .progress-bar { margin: 12px 0 6px; }
.settle-hero-note { margin: 0; font-size: 11px; color: var(--muted); line-height: 1.45; }

.settle-money {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.settle-money div {
  flex: 1 1 0;
  min-width: 0;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 10px;
  padding: 8px;
  text-align: center;
}
.settle-money b { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
.settle-money span { font-size: 10px; color: var(--muted); }

/* ---------------------------------------------------------------- 明細 */

.settle-group { border-top: 1px solid var(--line); padding: 9px 0; }
.settle-group:first-of-type { border-top: none; }
.settle-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.settle-group-sum { color: var(--accent); font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.settle-group-sum.zero { color: var(--muted); }
.settle-rules { list-style: none; margin: 6px 0 0; padding: 0; }
.settle-rules li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 3px 0;
  color: var(--muted);
}
.settle-rules li.on { color: var(--text); }
.settle-mark { flex: 0 0 15px; text-align: center; }
.settle-rule-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.settle-rule-pts { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.settle-hint { margin: 4px 0 0; font-size: 11px; color: var(--muted); line-height: 1.45; }

/* ---------------------------------------------------------------- 分數階梯 */

.settle-ladder { list-style: none; margin: 8px 0 0; padding: 0; }
.settle-ladder li { margin-bottom: 9px; }
.settle-ladder li:last-child { margin-bottom: 0; }
.settle-ladder-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  margin-bottom: 4px;
}
.settle-ladder-top b { font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.settle-ladder-label { min-width: 0; overflow-wrap: anywhere; }
.settle-bar { height: 8px; border-radius: 4px; background: #223047; overflow: hidden; }
.settle-bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: #3f5a72;
  transition: width 0.3s ease;
}
.settle-ladder li.mine .settle-bar i { background: var(--accent); }
.settle-ladder li.mine .settle-ladder-top { color: var(--accent); font-weight: 600; }
.settle-ladder li.best .settle-bar i { background: rgba(0, 194, 168, 0.45); }

/* ---------------------------------------------------------------- 存證資產 */

.settle-evidence {
  background: linear-gradient(135deg, #1e3a4f, #1a2332);
  border: 1px solid #2a3f55;
}
.settle-count {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.settle-count b { font-size: 30px; line-height: 1; font-variant-numeric: tabular-nums; }
.settle-stamp {
  font-size: 12.5px;
  color: #9fd8cf;
  font-variant-numeric: tabular-nums;
}
.settle-groups { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
.settle-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 10px 0 0;
  padding-bottom: 2px;
  scrollbar-width: none;
}
.settle-strip::-webkit-scrollbar { display: none; }
.settle-strip figure {
  flex: 0 0 56px;
  margin: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #1d2532;
}
.settle-strip img { width: 56px; height: 56px; object-fit: cover; display: block; }
.settle-strip .settle-noimg {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--muted);
}
.settle-strip figcaption {
  font-size: 9px;
  color: var(--muted);
  padding: 2px 3px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.settle-defense { margin: 10px 0 0; font-size: 12.5px; line-height: 1.55; }
.settle-defense strong { color: #9fd8cf; }
`;

// ------------------------------------------------------------------ helpers

function ms(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function dayLabel(t) {
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 一組時間戳的範圍字串（含日期；跨日會顯示兩個日期）。 */
function stampRange(list) {
  const times = list.map(ms).filter((t) => t != null);
  if (!times.length) return null;
  const first = Math.min(...times);
  const last = Math.max(...times);
  const sameDay = dayLabel(first) === dayLabel(last);
  return {
    first,
    last,
    text: sameDay
      ? `${dayLabel(first)} ${formatTime(new Date(first))}–${formatTime(new Date(last))}`
      : `${dayLabel(first)} ${formatTime(new Date(first))} – ${dayLabel(last)} ${formatTime(new Date(last))}`,
  };
}

export function mount(root, ctx) {
  const { state, points } = ctx;
  const session = state.session;

  const safeGroup = (g) => {
    try {
      return state.getCaptures(g) || [];
    } catch {
      return [];
    }
  };

  const groupsOfCaptures = {
    pickup: safeGroup("pickup"),
    supplement: safeGroup("supplement"),
    return: safeGroup("return"),
  };
  const captures = [
    ...groupsOfCaptures.pickup,
    ...groupsOfCaptures.supplement,
    ...groupsOfCaptures.return,
  ];
  const shots = captures.filter((c) => !c.skipped);
  const skipped = captures.length - shots.length;
  const range = stampRange(captures.map((c) => c.at));

  /**
   * 使用中回報的照片借用 supplement 群組存放（inuse.js 的 `meta.stage='inuse'`，
   * **不**併入租前基準）。凡是「補拍」的統計都要排除它們，否則回報一張照片就會
   * 讓「開鎖後補拍」看起來有做，數字也會多一張。
   */
  const supplementShots = groupsOfCaptures.supplement.filter((c) => c?.meta?.stage !== "inuse");
  const inuseShots = groupsOfCaptures.supplement.filter((c) => c?.meta?.stage === "inuse");

  // ---------------------------------------------------------------- 積分（全部來自 points.js）

  const total = state.totalPoints();
  const twd = points.pointsToTwd(total);
  const ruleP = (rid) => points.getRule(rid)?.points ?? 0;
  /** 拍照類上限（不含可重複的誠實申報）= 20 + 10 + 20 */
  const photoCap = ruleP("pickup_complete") + ruleP("supplement_complete") + ruleP("return_complete");
  const honest = ruleP("honest_report");
  const maxAttainable = points.maxAttainable(); // 含誠實申報 1 次
  const lazyPath = ruleP("pickup_partial") + ruleP("return_partial");
  const ladderMax = Math.max(maxAttainable, total, 1);

  // 互斥組 → 一個區塊（互斥組沒有的規則各自成組）
  const breakdown = state.pointsBreakdown();
  const groupMap = new Map();
  for (const row of breakdown) {
    const key = row.rule.exclusive ? `ex:${row.rule.exclusive}` : `solo:${row.rule.id}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        exclusive: row.rule.exclusive || null,
        stage: row.rule.stage || null,
        rows: [],
      });
    }
    groupMap.get(key).rows.push(row);
  }
  const pointGroups = [...groupMap.values()].map((g) => {
    g.earned = g.rows.reduce((s, r) => s + r.earned, 0);
    g.rows.sort((a, b) => b.rule.points - a.rule.points);
    g.label = STAGE_LABEL[g.stage] || g.rows[0].rule.label;
    // 尚未授予但已有照片 → 提示「由拍照畫面授予」，避免 demo 中看起來像壞掉
    g.pending = null;
    if (g.earned === 0 && (g.stage === "pickup" || g.stage === "return")) {
      const est = points.estimateCaptureSetPoints(g.stage, groupsOfCaptures[g.stage], 4);
      if (est.rule) g.pending = `已有 ${groupsOfCaptures[g.stage].length} 張紀錄，預估「${est.label}」+${est.points}（由拍照畫面授予）`;
    }
    if (g.earned === 0 && g.stage === "supplement" && supplementShots.length) {
      g.pending = `已補拍 ${supplementShots.length} 張，但尚未授予補拍積分（逾時或補拍畫面未授予）`;
    }
    return g;
  });

  // ---------------------------------------------------------------- 存證鏈狀態（防禦性視角）

  const timeline = Array.isArray(session.timeline) ? session.timeline : [];
  const hasType = (t) => timeline.some((e) => e?.type === t);
  const chainChips = [
    { label: "取車基準", ok: groupsOfCaptures.pickup.some((c) => !c.skipped) },
    { label: "開鎖後補拍", ok: supplementShots.some((c) => !c.skipped) },
    { label: "使用中回報", ok: (session.reports || []).length > 0 },
    { label: "還車存證", ok: groupsOfCaptures.return.some((c) => !c.skipped) },
    { label: "AI 比對", ok: hasType(EVENTS.AI_COMPARE) },
  ];
  const missing = chainChips.filter((c) => !c.ok);
  const exportedAtRaw = state.getFlag("evidenceExportedAt", null);
  const exportedAt = exportedAtRaw ? formatTime(new Date(ms(exportedAtRaw) ?? Number(exportedAtRaw))) : null;

  ctx.setHeader({
    title: "積分結算",
    subtitle: `+${total} 積分 · 可折抵 NT$${twd}（假設值） · ${shots.length} 張存證`,
  });
  ctx.setFootnote(
    `${points.POINT_VALUE_ASSUMPTION}。模擬租金 NT$${MOCK_FEE_TWD} 僅為示意，非 iRent 實際費率。`
  );

  // ---------------------------------------------------------------- 版面

  const thumbs = captures.slice(0, 24);

  root.innerHTML = `
    <div class="settle-hero">
      <div class="settle-hero-top">
        <span class="settle-total">${total}</span>
        <span class="settle-total-unit">／ ${maxAttainable} 積分（本輪上限，含誠實申報 1 次）</span>
      </div>
      <div class="progress-bar" style="--pct:${Math.min(100, (total / ladderMax) * 100).toFixed(1)}%"></div>
      <p class="settle-hero-note">拍照類上限 ${photoCap} 分（取車 ${ruleP("pickup_complete")}
        ＋補拍 ${ruleP("supplement_complete")} ＋還車 ${ruleP("return_complete")}）；
        誠實申報每次 +${honest}，可重複。規則來源：<code>src/points.js</code>。</p>
      <div class="settle-money">
        <div><b>NT$${twd}</b><span>可折抵租車費</span></div>
        <div><b>NT$${MOCK_FEE_TWD}</b><span>本次租金（模擬）</span></div>
        <div><b>NT$${Math.max(0, MOCK_FEE_TWD - twd)}</b><span>折抵後應付</span></div>
      </div>
      <p class="settle-hero-note" style="margin-top:8px">
        <span class="badge warn">假設值</span> ${escapeHtml(points.POINT_VALUE_ASSUMPTION)}。
        PIG-13 §5 記載「積分用途：租車費折抵（具體比例待商業設計）」，此處比例與租金均為模擬。</p>
    </div>

    <div class="card settle-evidence">
      <h2 class="section-title">你的存證資產</h2>
      <div class="settle-count">
        <b>${shots.length}</b>
        <span>張存證影像${skipped ? `（另有 ${skipped} 張為「先繼續」跳過，無影像）` : ""}</span>
      </div>
      <p class="settle-stamp">${
        range ? `時間戳 ${escapeHtml(range.text)}` : "尚無時間戳 —— 這次沒有建立任何存證"
      }</p>
      <div class="settle-groups">
        <span class="badge ${groupsOfCaptures.pickup.length ? "ok" : ""}">取車 ${groupsOfCaptures.pickup.length}</span>
        <span class="badge ${supplementShots.length ? "ok" : ""}">補拍 ${supplementShots.length}</span>
        <span class="badge ${groupsOfCaptures.return.length ? "ok" : ""}">還車 ${groupsOfCaptures.return.length}</span>
        <span class="badge ${(session.reports || []).length ? "ok" : ""}">回報 ${(session.reports || []).length}${
          inuseShots.length ? `（附 ${inuseShots.length} 張）` : ""
        }</span>
      </div>
      ${
        thumbs.length
          ? `<div class="settle-strip">${thumbs
              .map((c) => {
                const src = c.fullDataUrl || c.dataUrl;
                const cap = `${c.label || c.category || "照片"}`;
                return `<figure>${
                  src
                    ? `<img src="${src}" alt="${escapeHtml(cap)}" />`
                    : `<div class="settle-noimg">${c.skipped ? "跳過" : "無縮圖"}</div>`
                }<figcaption>${escapeHtml(formatTime(c.at))}</figcaption></figure>`;
              })
              .join("")}${
              captures.length > thumbs.length
                ? `<figure><div class="settle-noimg">+${captures.length - thumbs.length}</div><figcaption>更多</figcaption></figure>`
                : ""
            }</div>`
          : ""
      }
      ${
        shots.length
          ? `<p class="settle-defense">這 ${shots.length} 張照片和它們的時間戳<strong>是你的證據，不是流程負擔</strong>：
              取車前的存證可以證明既有損傷不是你造成的；還車前的存證可以證明你交還時車況正常，
              避免被下一位使用者的損傷賴到你頭上。發生爭議時，客服會直接引用這條時間軸。</p>`
          : `<p class="settle-defense">你這次<strong>沒有建立任何存證</strong>。
              若日後對車損認定有爭議，沒有照片與時間戳可以引用 —— 責任會改由車輛歷史紀錄與現場勘查認定。</p>`
      }
      ${
        missing.length
          ? `<p class="settle-hint">事證鏈缺漏：${missing
              .map((c) => escapeHtml(c.label))
              .join("、")}。缺漏區段在事證包中會被標註出來。</p>`
          : `<p class="settle-hint">事證鏈完整：取車 → 補拍 → 使用中 → 還車 → AI 比對都有紀錄。</p>`
      }
      ${
        session.storage === "degraded"
          ? `<p class="settle-hint">⚠ 本機儲存空間不足，縮圖已被捨棄，僅保留 metadata 與時間戳（正式版影像存雲端，不受影響）。</p>`
          : ""
      }
      ${
        exportedAt
          ? `<p class="settle-hint">事證包已於 ${escapeHtml(exportedAt)} 產出（<code>flags.evidenceExportedAt</code>）。</p>`
          : ""
      }
    </div>

    <div class="card">
      <h2 class="section-title">積分明細</h2>
      <p class="muted" style="margin:0 0 4px">同一階段是<strong>互斥組</strong>：拿到「完整達標」就會取代「有警告仍跳過」的基礎分，
      不是每張照片各自計分。以下直接讀 <code>state.pointsBreakdown()</code>。</p>
      ${pointGroups
        .map((g) => {
          const rows = g.rows
            .map((r) => {
              const on = r.entries.length > 0;
              const times = r.entries.map((e) => formatTime(e.at)).join("、");
              return `<li class="${on ? "on" : ""}">
                <span class="settle-mark">${on ? "✓" : "—"}</span>
                <span class="settle-rule-label">${escapeHtml(r.rule.label)}
                  ${
                    on && times
                      ? `<span class="muted"> · ${escapeHtml(times)}${
                          r.entries.length > 1 ? `（${r.entries.length} 次）` : ""
                        }</span>`
                      : ""
                  }</span>
                <span class="settle-rule-pts">${on ? `+${r.earned}` : `(+${r.rule.points})`}</span>
              </li>`;
            })
            .join("");
          return `<div class="settle-group">
            <div class="settle-group-head">
              <span>${escapeHtml(g.label)}${
                g.exclusive ? ` <span class="badge">互斥組</span>` : ""
              }</span>
              <span class="settle-group-sum ${g.earned ? "" : "zero"}">${g.earned ? `+${g.earned}` : "0"}</span>
            </div>
            <ul class="settle-rules">${rows}</ul>
            ${g.pending ? `<p class="settle-hint">${escapeHtml(g.pending)}</p>` : ""}
          </div>`;
        })
        .join("")}
      <div class="settle-group">
        <div class="settle-group-head"><span>合計</span>
          <span class="settle-group-sum">+${total}</span></div>
        <p class="settle-hint">合計 = <code>state.totalPoints()</code>，與 timeline 的
          <code>points_awarded</code> 事件一致（共 ${
            timeline.filter((e) => e?.type === EVENTS.POINTS_AWARDED).length
          } 筆授予紀錄）。</p>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">分數階梯（為什麼「亂拍」不會比較划算）</h2>
      <ul class="settle-ladder">
        <li>
          <div class="settle-ladder-top"><span class="settle-ladder-label">全部有警告仍跳過（取車＋還車基礎分）</span><b>${lazyPath}</b></div>
          <div class="settle-bar"><i style="width:${((lazyPath / ladderMax) * 100).toFixed(1)}%"></i></div>
        </li>
        <li class="mine">
          <div class="settle-ladder-top"><span class="settle-ladder-label">你這一次</span><b>${total}</b></div>
          <div class="settle-bar"><i style="width:${((total / ladderMax) * 100).toFixed(1)}%"></i></div>
        </li>
        <li class="best">
          <div class="settle-ladder-top"><span class="settle-ladder-label">四角＋補拍全達標（＋誠實申報 1 次）</span><b>${maxAttainable}</b></div>
          <div class="settle-bar"><i style="width:100%"></i></div>
        </li>
      </ul>
      <p class="settle-hint">${
        lazyPath < photoCap
          ? `跳過路線 ${lazyPath} 分 &lt; 好好拍 ${photoCap} 分，激勵方向正確；「亂拍通過 +${ruleP(
              "pickup_partial"
            )}」保留基礎分，是為了鼓勵至少拍（PIG-13 §5），但不會划算過認真拍。`
          : `⚠ 規則異常：跳過路線 ${lazyPath} 分 ≥ 好好拍 ${photoCap} 分，points.js 的規則需要修正。`
      }</p>
    </div>

    <div class="card">
      <h2 class="section-title">積分用途</h2>
      <p class="muted" style="margin:0">
        <span class="badge warn">假設值</span> 折抵比例、模擬租金與「本輪上限」都是原型的假設設定，
        PIG-13 §5 明載具體比例待商業設計。真實方案需與營運／財務確認（例如是否設每月折抵上限、
        是否與會員等級連動、誠實申報的重複授予是否要設上限）。</p>
    </div>

    <div class="actions">
      <button type="button" class="btn ghost" data-el="btnDispute">查看事證包 / 提出爭議</button>
      <button type="button" class="btn primary" data-el="btnOps">營運視角</button>
      <button type="button" class="btn secondary" data-el="btnRestart">重跑一次完整劇本（清空 session）</button>
    </div>
  `;

  const els = {};
  root.querySelectorAll("[data-el]").forEach((n) => {
    els[n.dataset.el] = n;
  });

  const goOr = (target, label) => {
    if (ctx.router.isRegistered(target)) ctx.go(target);
    else alert(`「#/${target}」（${label}）尚未實作，其他 track 完成後就會自動上線。`);
  };

  els.btnDispute.addEventListener("click", () => goOr("dispute", "爭議／事證包"));
  els.btnOps.addEventListener("click", () => goOr("ops", "營運視角"));
  els.btnRestart.addEventListener("click", () => {
    if (!confirm("清空這個 session 的所有照片、積分與時間軸，重新開始？")) return;
    state.reset();
    const first = ctx.router.listScreens().find((s) => s.id === "vehicle") ? "vehicle" : "capture";
    if (first === "capture") ctx.go("capture", { phase: "pickup" });
    else ctx.go("vehicle");
  });

  // 本畫面沒有 timer / 全域 listener，cleanup 只是明確表態
  return () => {};
}
