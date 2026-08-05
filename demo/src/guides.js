/**
 * 車身虛線輪廓引導 —— **暫時實作，將被整批取代**
 * ============================================================
 * ⚠️ 下面 GUIDE_PATHS 裡的 path 只是隨手畫的粗略七點多邊形，
 *    **不是任何真實車款的 45° 四分之三視角輪廓**，比例與透視都是假的。
 *    它們的唯一目的是讓 capture.js 在 Wave 1 能跑起來。
 *
 * 由 **Track G**（參數化透視建構的車體輪廓）產生的結果會整批取代
 * GUIDE_PATHS 的內容。取代時：
 *   - 保留 `getGuide(modelId, cornerId, variant)` 與 `CORNERS` 兩個 export 的簽名
 *   - capture.js / supplement.js 不需要任何修改
 *   - 多車型時把 GUIDE_PATHS 換成 { [modelId]: { [cornerId]: ... } } 的實際資料，
 *     getGuide 內的 fallback 邏輯已經預留好
 * ============================================================
 */

import { escapeHtml } from "./util.js";

/** 預設車型 id。state.session.vehicle.modelId 沒有對應資料時 fallback 到這個。 */
export const DEFAULT_MODEL_ID = "generic";

/** 預設輪廓變體。Track G 之後可能有 "sedan" / "suv" / "kei" 等。 */
export const DEFAULT_VARIANT = "default";

/**
 * 四角定義 —— 這份是**正式契約**（不像 path 是暫時的）。
 * 取車 / 補拍 / 還車 都用同一份角度 id，Track G 取代輪廓時必須保留這個 export。
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

/**
 * modelId → cornerId → SVG inner markup（座標系以 (0,0) 為中心，約 ±120 單位）。
 * capture.js 會把它塞進 <g transform="translate(180,340)"> 裡。
 *
 * ⚠️ 暫時資料，見檔頭說明。
 */
const GUIDE_PATHS = {
  [DEFAULT_MODEL_ID]: {
    lf: {
      label: "左前輪廓引導",
      outline: "M -70 -20 L -95 40 L -60 95 L 20 110 L 75 70 L 85 10 L 40 -35 Z",
      inner: "M -55 -5 L -75 35 L -45 80 L 10 90 L 55 55 L 60 15 L 25 -20 Z",
    },
    rf: {
      label: "右前輪廓引導",
      outline: "M 70 -20 L 95 40 L 60 95 L -20 110 L -75 70 L -85 10 L -40 -35 Z",
      inner: "M 55 -5 L 75 35 L 45 80 L -10 90 L -55 55 L -60 15 L -25 -20 Z",
    },
    lr: {
      label: "左後輪廓引導",
      outline: "M -75 10 L -90 70 L -50 115 L 30 105 L 80 50 L 70 -10 L 20 -40 Z",
      inner: "M -58 20 L -70 65 L -38 98 L 15 90 L 55 48 L 48 0 L 12 -25 Z",
    },
    rr: {
      label: "右後輪廓引導",
      outline: "M 75 10 L 90 70 L 50 115 L -30 105 L -80 50 L -70 -10 L -20 -40 Z",
      inner: "M 58 20 L 70 65 L 38 98 L -15 90 L -55 48 L -48 0 L -12 -25 Z",
    },
  },
};

/**
 * 取得某車型某一角的輪廓引導。
 * @param {string} [modelId] 車型 id（state.session.vehicle.modelId）；找不到會 fallback
 * @param {string} cornerId  "lf" | "rf" | "lr" | "rr"
 * @param {string} [variant] 輪廓變體，Wave 1 只有 "default"
 * @returns {{ modelId: string, cornerId: string, variant: string, svg: string,
 *            label: string, provisional: boolean }}
 *   svg = 可直接塞入 <g> 的 inner markup；provisional=true 代表還是暫時輪廓
 */
export function getGuide(modelId = DEFAULT_MODEL_ID, cornerId, variant = DEFAULT_VARIANT) {
  const models = GUIDE_PATHS[modelId] ? modelId : DEFAULT_MODEL_ID;
  const data = GUIDE_PATHS[models]?.[cornerId];
  if (!data) {
    return {
      modelId: models,
      cornerId,
      variant,
      label: "",
      svg: "",
      provisional: true,
    };
  }
  return {
    modelId: models,
    cornerId,
    variant,
    label: data.label,
    provisional: true,
    svg: `
      <path class="guide-stroke" d="${data.outline}" />
      <path class="guide-fill" d="${data.inner}" />
      <text class="guide-sublabel" x="0" y="130" text-anchor="middle">${escapeHtml(data.label)}</text>
    `,
  };
}

/**
 * 輪廓相關的 CSS。
 * 任何用到 getGuide() 的畫面模組，請把這個字串併進自己的 `css` export：
 *   export const css = `${GUIDE_CSS}\n .my-screen { ... }`;
 * （router 只會注入畫面模組的 css，所以引導樣式必須跟著使用者走。）
 */
export const GUIDE_CSS = `
.guide-stroke {
  fill: none;
  stroke: rgba(255, 255, 255, 0.85);
  stroke-width: 2.5;
  stroke-dasharray: 10 8;
  stroke-linecap: round;
}
.guide-fill {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-dasharray: 6 6;
  opacity: 0.9;
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
}
`;
