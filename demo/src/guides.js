/**
 * 車身虛線輪廓引導 —— Toyota Corolla Cross XG10 專屬版（Track G / D3）
 * ============================================================
 * 輪廓不再是 Wave 1 的暫時七點多邊形，而是
 * `demo/assets/car-reference/generated/guide-cuv-{lf,rf,lr,rr}.svg`
 * 的實際車體幾何（折線資料烘在 `./guides-cuv.js`）。
 *
 * ── 授權（強制標示，散布時必須保留）─────────────────────────────
 *   本檔與 `guides-cuv.js` 的輪廓幾何衍生自 CC BY 4.0 的 3D 模型：
 *
 *     "Toyota Corolla Cross" by Nieve5677 (https://sketchfab.com/niev),
 *     licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/).
 *     Source: https://sketchfab.com/3d-models/toyota-corolla-cross-cc503d26ea694dce85e7d0f1491b0e30
 *
 *   CC BY 無 copyleft 感染性，可商用、可交付，唯一義務是**保留上述標示**。
 *   完整標示與授權鏈見 `demo/assets/car-reference/ATTRIBUTION.md` §2 / §3。
 *
 * ── 為什麼是專屬版而不是 Monk BSD 版 ────────────────────────────
 *   Monk 版已實測否決：套到本專案站位的 rms 誤差 15.8%，與「一個橢圓」
 *   （15.7%）無法區分，85% 的誤差來自站位差異。2D 疊圖成品是站位鎖定的、
 *   無法重新投影，所以不能靠調參數救。詳見 `assets/guides/monk/NOTICE.md` §6。
 * ============================================================
 */

import { escapeHtml } from "./util.js";
import { CUV_CATS, CUV_GUIDES, CUV_CAMERA_BASIS, CUV_SOURCE_VIEWBOX } from "./guides-cuv.js";

/* ══════════════════════════════════════════════════════════════════
 *  G5 之後要改的就是這一段 —— 兩個暫定值，各自只有一處
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者還沒站到實車前做最終確認（G5）。他會帶回三個決定：
 *   (1) 輪廓對不對得上　(2) 密度選哪一級　(3) 相機參數要不要微調
 * 下面兩個常數就是 (2) 與 (3) 的落點。
 */

/**
 * 【暫定預設 · G5 後可改】細節線密度。
 *
 *   "all"     130 條 —— 全部疊在即時畫面上是視覺噪音，只建議在 guide-lab 裡看
 *   "medium"   36 條 —— **目前預設**
 *   "minimal"  13 條 —— 可能失去對齊線索，等實車確認
 *
 * 改這一個字串就能整批切換（四角同時生效）。也可以在單次呼叫覆寫：
 *   getGuide(modelId, "lf", "minimal")
 *
 * ⚠️ 輪胎接地點與地面線（`ground`）**不受密度影響，任何級別都全開** ——
 *    它們對相機高度最敏感，是垂直校正最有效的線索（見 GROUND_ALWAYS_ON）。
 */
export const GUIDE_DENSITY = "medium";

/**
 * 【暫定預設 · G5 後可改】密度級別的配額表。
 * 沿用 `demo/guide-lab/sources.js` 的 `TIERS`（同一套分群與排名，見下方 §分群）。
 *   win    車窗帶（形心在腰線之上）
 *   arch   輪拱（形心落在輪心投影半徑內）
 *   crease 車身摺線（其餘）
 * `perWheel` = 該級別每個輪拱至少保留幾條，避免某個輪子整個消失。
 *
 * 實際條數（四角皆同）：all 130 / medium 36 / minimal 13。
 */
export const GUIDE_DENSITY_TIERS = Object.freeze({
  all: { label: "全部", quota: null },
  medium: { label: "中等", quota: { win: 14, arch: 12, crease: 10 } },
  minimal: { label: "極簡", quota: { win: 5, arch: 6, crease: 0 }, perWheel: 2 },
});

/**
 * 【暫定預設 · G5 後可改】相機基準 —— 輪廓幾何就是用這組參數渲出來的。
 *
 * ⚠️ 這是**紀錄值，不是輸入值**：改這裡不會重算輪廓。要換基準必須重跑
 *    產生器（見檔尾 §如何重新產生），把 `guides-cuv.js` 整份換掉。
 *    放在這裡是為了讓 G5 一眼看到「目前疊圖假設你站在哪」，並與
 *    `quality.js` 的 `STANDING_GUIDE`（distanceM 3.85 / heightM 1.5）對照 ——
 *    兩邊不一致時，畫面上的文案就會跟疊圖幾何互相矛盾。
 */
export const GUIDE_CAMERA = Object.freeze({
  distanceM: CUV_CAMERA_BASIS.distanceM, // 3.85 m 水平距離
  heightM: CUV_CAMERA_BASIS.heightM, // 1.5 m 相機高（胸口平舉）
  yawDeg: CUV_CAMERA_BASIS.yawDeg, // 偏擺 45°
  focalEquivMm: CUV_CAMERA_BASIS.focalEquivMm, // 等效 26 mm
  aspect: "4:3",
  orientation: "landscape",
});

/** 地面線 / 輪胎接地十字：任何密度都保留（見 GUIDE_DENSITY 的說明）。 */
export const GROUND_ALWAYS_ON = true;

/* ══════════════════════════════════════════════════════════════════
 *  以下是實作
 * ══════════════════════════════════════════════════════════════════ */

/** 預設車型 id。state.session.vehicle.modelId 沒有對應資料時 fallback 到這個。 */
export const DEFAULT_MODEL_ID = "generic";

/** 預設輪廓變體 = 預設密度級別（`variant` 參數同時當密度選擇器用）。 */
export const DEFAULT_VARIANT = GUIDE_DENSITY;

/**
 * 四角定義 —— 這份是**正式契約**。
 * 取車 / 補拍 / 還車 都用同一份角度 id。
 */
export const CORNERS = Object.freeze([
  { id: "lf", label: "左前 45°", hint: "請站在車輛左前方，對準虛線輪廓" },
  { id: "rf", label: "右前 45°", hint: "請站在車輛右前方，對準虛線輪廓" },
  { id: "lr", label: "左後 45°", hint: "請站在車輛左後方，對準虛線輪廓" },
  { id: "rr", label: "右後 45°", hint: "請站在車輛右後方，對準虛線輪廓" },
]);

export function getCorner(cornerId) {
  return CORNERS.find((c) => c.id === cornerId) || null;
}

/* ── viewBox 換算 ──────────────────────────────────────────────────
 *
 * 來源：`generated/guide-cuv-*.svg` 的 viewBox 是 **500 × 375**。
 * 目標：`capture.js` 的疊圖 SVG viewBox 是 **360 × 270**
 *       （`GUIDE_VB`；D 組改橫向 4:3 時設的），輪廓群組再包一層
 *       `<g transform="translate(180, 128)">`（`GUIDE_ORIGIN`）。
 *
 * 兩者都是 4:3，所以是單純等比縮放，沒有 letterbox：
 *       360 / 500 = 0.72
 *       270 / 375 = 0.72   ← 兩軸相同，已在載入時斷言（見 SCALE 下方）
 *
 * 我們發出的座標是「相對於 GUIDE_ORIGIN」的，所以要先縮放再減掉原點：
 *       X = x·0.72 − 180        Y = y·0.72 − 128
 * capture.js 的 translate 會把原點加回去 → 畫面上的絕對位置剛好等於
 * `x·0.72 / y·0.72`，也就是**與來源渲圖同一個取景**。這是整段換算的重點：
 * 輪廓在 4:3 畫框裡的位置與大小必須逐點等於 26 mm 等效鏡頭實際會看到的樣子，
 * 不能為了「看起來剛好」而縮放或平移。
 */

/** 來源 SVG 的 viewBox（= `guides-cuv.js` 的座標系） */
const SOURCE_VB = CUV_SOURCE_VIEWBOX;

/**
 * 目標疊圖畫框。**必須與 `src/screens/capture.js` 的 `GUIDE_VB` / `GUIDE_ORIGIN` 一致**；
 * 那支檔案是 Wave 1 凍結檔（唯讀），所以這裡只能鏡射它的值，改的時候兩邊要一起改。
 */
const TARGET_FRAME = Object.freeze({ w: 360, h: 270, originX: 180, originY: 128 });

const SCALE = TARGET_FRAME.w / SOURCE_VB.w;

// 4:3 → 4:3 的等比縮放前提；不成立就是有人改了其中一邊的 viewBox。
if (Math.abs(TARGET_FRAME.h / SOURCE_VB.h - SCALE) > 1e-9) {
  throw new Error(
    `guides.js: viewBox 換算不是等比（${SOURCE_VB.w}×${SOURCE_VB.h} → ` +
      `${TARGET_FRAME.w}×${TARGET_FRAME.h}）—— 請重新確認 capture.js 的 GUIDE_VB`
  );
}

/** 來源座標 → 目標座標（相對 GUIDE_ORIGIN） */
function tx(x) {
  return x * SCALE - TARGET_FRAME.originX;
}
function ty(y) {
  return y * SCALE - TARGET_FRAME.originY;
}

/** 座標輸出精度：0.01 個 360 單位 ≈ 0.003% 畫面寬，遠低於一個螢幕 px。 */
function num(v) {
  return Math.round(v * 100) / 100;
}

/** "x,y x,y …" → "M x y L x y …"（換算 + 選擇性收尾） */
function toPathD(flat, close) {
  const parts = flat.split(" ");
  let d = "";
  for (let i = 0; i < parts.length; i++) {
    const c = parts[i].split(",");
    const x = num(tx(+c[0]));
    const y = num(ty(+c[1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "";
    d += `${i === 0 ? "M" : " L"} ${x} ${y}`;
  }
  return close ? `${d} Z` : d;
}

/* ── 密度分級 ──────────────────────────────────────────────────────
 *
 * 分群（win / arch / crease）與群內排名是**離線算好的**，直接烘在
 * `guides-cuv.js` 每一條細節線的前綴裡。演算法沒有重寫 ——
 * 產生器直接 import `demo/guide-lab/sources.js` 的 `classifyIRent()`：
 * 用基準相機把腰線與輪拱圓投影到畫面 → 依細節線形心落點分三群 →
 * 群內用 `max(bbox 對角線, 0.6 × 總長)` 排名。
 * （`guide-lab/` 唯讀，只 import 不修改。）
 *
 * 執行期只剩「這一級要留幾條」這個過濾，等價於 `sources.js` 的 `visibleSet()`。
 */

/** @returns {{cat: string, rank: number, wheel: number, flat: string}} */
function parseDetail(entry) {
  const bar1 = entry.indexOf("|");
  const bar2 = entry.indexOf("|", bar1 + 1);
  const bar3 = entry.indexOf("|", bar2 + 1);
  return {
    cat: CUV_CATS[+entry.slice(0, bar1)],
    rank: +entry.slice(bar1 + 1, bar2),
    wheel: +entry.slice(bar2 + 1, bar3),
    flat: entry.slice(bar3 + 1),
  };
}

/**
 * 這一級要顯示哪些細節線（對應 `guide-lab/sources.js` 的 `visibleSet`）。
 * @returns {Array<{cat: string, flat: string}>}
 */
function pickDetail(detail, tierId) {
  const tier = GUIDE_DENSITY_TIERS[tierId] || GUIDE_DENSITY_TIERS[GUIDE_DENSITY];
  const parsed = detail.map(parseDetail);
  if (!tier.quota) return parsed;

  const keep = new Set();
  parsed.forEach((m, i) => {
    if (m.rank < (tier.quota[m.cat] ?? 0)) keep.add(i);
  });
  if (tier.perWheel) {
    // 每個輪拱至少留 perWheel 條，不然某個輪子會整個消失（rank 已是群內排名，
    // 同一輪的線之間比 rank 就等於比 score）
    const byWheel = new Map();
    parsed.forEach((m, i) => {
      if (m.cat !== "arch") return;
      const list = byWheel.get(m.wheel) || [];
      list.push(i);
      byWheel.set(m.wheel, list);
    });
    for (const list of byWheel.values()) {
      list.sort((a, b) => parsed[a].rank - parsed[b].rank);
      list.slice(0, tier.perWheel).forEach((i) => keep.add(i));
    }
  }
  return parsed.filter((_, i) => keep.has(i));
}

/* ── 資料表 ────────────────────────────────────────────────────────
 *
 * modelId → cornerId → 折線資料。目前只有一組真實車體（Corolla Cross XG10，
 * body_class = cuv）；`state.js` 的 mock 車輛 modelId 是 "generic"，
 * 所以兩個 key 指到同一份資料。多車型時在這裡加 key 即可，getGuide 的
 * fallback 邏輯不用動。
 */
const GUIDE_PATHS = {
  [DEFAULT_MODEL_ID]: CUV_GUIDES,
  "corolla-cross": CUV_GUIDES,
};

const CORNER_LABELS = {
  lf: "左前輪廓引導",
  rf: "右前輪廓引導",
  lr: "左後輪廓引導",
  rr: "右後輪廓引導",
};

/**
 * 取得某車型某一角的輪廓引導。
 *
 * @param {string} [modelId] 車型 id（state.session.vehicle.modelId）；找不到會 fallback
 * @param {string} cornerId  "lf" | "rf" | "lr" | "rr"
 * @param {string} [variant] 密度級別 `"all" | "medium" | "minimal"`；
 *                           省略或給不認識的值 → `GUIDE_DENSITY`
 * @returns {{ modelId: string, cornerId: string, variant: string, svg: string,
 *             label: string, provisional: boolean, lineCount: object, camera: object }}
 *   `svg` = 可直接塞入 `<g>` 的 inner markup（座標相對 capture.js 的 GUIDE_ORIGIN）。
 *   `provisional` = true 代表「站位/密度尚未經 G5 實車確認」，幾何本身已是真實車體。
 */
export function getGuide(modelId = DEFAULT_MODEL_ID, cornerId, variant = DEFAULT_VARIANT) {
  const resolvedModel = GUIDE_PATHS[modelId] ? modelId : DEFAULT_MODEL_ID;
  const tier = GUIDE_DENSITY_TIERS[variant] ? variant : GUIDE_DENSITY;
  const data = GUIDE_PATHS[resolvedModel]?.[cornerId];
  const label = CORNER_LABELS[cornerId] || "";

  if (!data) {
    return {
      modelId: resolvedModel,
      cornerId,
      variant: tier,
      label: "",
      svg: "",
      provisional: true,
      lineCount: { outline: 0, detail: 0, ground: 0 },
      camera: GUIDE_CAMERA,
    };
  }

  // 順序很重要：`capture.js` 的 readGuideGeometry() 抓**第一個** .guide-stroke
  // 當對齊判定用的多邊形，所以主輪廓必須是第一條，而且只能有一條。
  // （它用 querySelector + getScreenCTM()，所以多包一層 <g> 不影響。）
  let body = `<path class="guide-stroke" d="${toPathD(data.outline, true)}" />`;

  const detail = pickDetail(data.detail, tier);
  for (const m of detail) {
    body += `\n        <path class="guide-fill guide-detail-${m.cat}" d="${toPathD(m.flat, false)}" />`;
  }

  // 地面線 / 接地十字：任何密度都全開。用 guide-fill 是為了讓 capture.js 的
  // `.overlay.aligned .guide-fill` 對齊變綠規則同樣吃得到（那支檔案唯讀）。
  const ground = GROUND_ALWAYS_ON ? data.ground : [];
  for (const flat of ground) {
    body += `\n        <path class="guide-fill guide-ground" d="${toPathD(flat, false)}" />`;
  }

  // 副標籤壓在輪廓下緣底下，不要蓋到車體也不要掉出畫框。
  const labelY = Math.min(num(ty(data.bbox[3]) + 20), TARGET_FRAME.h - TARGET_FRAME.originY - 8);

  // halo 掛在這一層 <g>，不是逐條 path —— 中等密度就有 42 條線，
  // 逐條套 filter 在手機上會拖垮 800ms 的品質檢查迴圈。
  const svg = `
      <g class="guide-body">${body}</g>
      <text class="guide-sublabel" x="${num(tx(SOURCE_VB.w / 2))}" y="${labelY}"
            text-anchor="middle">${escapeHtml(label)}</text>
    `;

  return {
    modelId: resolvedModel,
    cornerId,
    variant: tier,
    label,
    svg,
    // 幾何已是真實車體，但密度與站位仍是暫定預設，等 G5 實車確認
    provisional: true,
    lineCount: { outline: 1, detail: detail.length, ground: ground.length },
    camera: GUIDE_CAMERA,
  };
}

/**
 * 輪廓相關的 CSS。
 * 任何用到 getGuide() 的畫面模組，請把這個字串併進自己的 `css` export：
 *   export const css = `${GUIDE_CSS}\n .my-screen { ... }`;
 * （router 只會注入畫面模組的 css，所以引導樣式必須跟著使用者走。）
 *
 * 線條樣式已定案（PIG-13 §1.2 G5）：
 *   - 主輪廓**實線**、內部細節**虛線**，線重約 2:1（2.4 : 1.2）
 *   - `vector-effect: non-scaling-stroke` —— 線寬等於螢幕 px，
 *     不會被 viewBox 縮成次像素而消失
 *   - 深色 halo 墊底（`paint-order: stroke` + 半透明黑描邊），
 *     白線疊在白車 / 亮地面上才看得見
 *   - 對準後由呼叫端加 `.aligned`（見 capture.js）→ 全部轉實線變綠
 */
export const GUIDE_CSS = `
/* 深色 halo 墊底。掛在整個群組上（不是逐條 path）—— 中等密度 42 條線，
   逐條套 filter 會拖垮手機上的 800ms 品質檢查迴圈。 */
.guide-body {
  filter: drop-shadow(0 0 1.8px rgba(0, 0, 0, 0.9));
}
.guide-stroke,
.guide-fill {
  fill: none;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.guide-stroke {
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 2.4;
}
.guide-fill {
  stroke: rgba(255, 255, 255, 0.78);
  stroke-width: 1.2;
  stroke-dasharray: 5 4;
}
/* 地面線 / 輪胎接地十字：任何密度都在，用**實線 + 較粗**與細節線區隔
   （不換顏色 —— 綠色是「已對準」的保留訊號，不能先用掉）。
   放在 .guide-fill 之後才蓋得掉它的 dasharray（同特異度，後者勝）。 */
.guide-ground {
  stroke: rgba(255, 255, 255, 0.95);
  stroke-width: 1.6;
  stroke-dasharray: none;
}
.guide-label {
  fill: #fff;
  font-size: 16px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
.guide-sublabel {
  fill: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  paint-order: stroke;
  stroke: rgba(0, 0, 0, 0.65);
  stroke-width: 2.5;
}
`;

/* ── 如何重新產生 `guides-cuv.js` ──────────────────────────────────
 *
 * 這份 repo 零依賴、零 build step，所以資料是**烘進版控**的，不在執行期抓 SVG
 * （`getGuide()` 是同步 API，capture.js 在 render 中直接呼叫，不能改成 async）。
 *
 * 要換車款 / 換相機基準時：
 *   1. 重新渲出 `assets/car-reference/generated/guide-cuv-<corner>.svg`
 *      （outline 恰好一條、detail 任意條、ground 為接地十字 + 地面線），
 *      並把相機參數寫進 `<metadata id="guide-params">`。
 *   2. 用一支 node 腳本讀那四個 SVG：把 `M x y L x y …` 解析成折線，
 *      import `demo/guide-lab/sources.js` 的 `baseCamFor()` + `classifyIRent()`
 *      做分群與排名，再依 `guides-cuv.js` 檔頭的格式輸出。
 *      （`guide-lab/` 是唯讀素材，只 import，不要改。）
 *   3. 更新本檔的 `GUIDE_CAMERA` 與 `quality.js` 的 `STANDING_GUIDE`。
 */
