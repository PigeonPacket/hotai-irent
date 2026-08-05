/**
 * 輕量影像品質啟發式（原封不動搬自 PoC app.js:109-148）。
 *
 * ⚠️ Wave 1 不改演算法。清晰度改良（Laplacian 之類）與「輪廓占比 / 角度偏離」
 *    檢查是 Wave 3 / Track G 的工作 —— 等虛線輪廓定案後才做。
 *
 * 擴充方式（給 Wave 3）：
 *   - 閾值都在 THRESHOLDS，不要寫死在函式裡
 *   - 訊息都在 ISSUE_MESSAGES，用 code 對應
 *   - 新增檢查 = 新增一個 check 函式並 push code；回傳結構的 { ok, issues, avg }
 *     三個欄位是對外契約，只能加欄位不能改語意
 */

export const THRESHOLDS = {
  /** 取樣寬度（縮到這麼小再逐 pixel 掃，維持 60fps 以外的餘裕） */
  sampleWidth: 160,
  fallbackHeight: 120,
  darkLum: 40,
  brightLum: 220,
  minAvg: 55,
  maxDarkRatio: 0.45,
  maxBrightRatio: 0.25,
  minVariance: 120,
  /** 只在平均亮度落在這個區間時才判斷模糊（太暗/太亮時 variance 不可靠） */
  varianceAvgRange: [30, 200],
};

export const ISSUE_CODES = Object.freeze({
  DARK: "dark",
  OVEREXPOSED: "overexposed",
  BLURRY: "blurry",
});

export const ISSUE_MESSAGES = {
  [ISSUE_CODES.DARK]: "光線偏暗，建議移到較亮處或開啟手電筒",
  [ISSUE_CODES.OVEREXPOSED]: "畫面過曝，請避開直射光源",
  [ISSUE_CODES.BLURRY]: "畫面可能模糊，請對焦後再拍",
};

/**
 * 取得畫面來源的實際尺寸。
 * 來源可能是 <video>（真相機）或 <canvas>/<img>（模擬相機）。
 */
export function sourceSize(source) {
  const width = source?.videoWidth || source?.naturalWidth || source?.width || 0;
  const height = source?.videoHeight || source?.naturalHeight || source?.height || 0;
  return { width, height };
}

/**
 * 分析一格畫面。
 * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} source 畫面來源
 * @param {HTMLCanvasElement} canvas 暫存用 canvas（會被覆寫，呼叫端自備一個重複用）
 * @returns {{ ok: boolean, issues: string[], avg: number, codes: string[], metrics: object }}
 */
export function analyzeFrame(source, canvas) {
  const { width: srcW, height: srcH } = sourceSize(source);
  const w = THRESHOLDS.sampleWidth;
  const h = Math.round((srcH / srcW) * w) || THRESHOLDS.fallbackHeight;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let sum = 0;
  let dark = 0;
  let bright = 0;
  const pixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += lum;
    if (lum < THRESHOLDS.darkLum) dark++;
    if (lum > THRESHOLDS.brightLum) bright++;
  }

  const avg = sum / pixels;
  const darkRatio = dark / pixels;
  const brightRatio = bright / pixels;

  const codes = [];
  if (avg < THRESHOLDS.minAvg || darkRatio > THRESHOLDS.maxDarkRatio) {
    codes.push(ISSUE_CODES.DARK);
  }
  if (brightRatio > THRESHOLDS.maxBrightRatio) {
    codes.push(ISSUE_CODES.OVEREXPOSED);
  }

  let variance = null;
  const [vLo, vHi] = THRESHOLDS.varianceAvgRange;
  if (avg > vLo && avg < vHi) {
    variance = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      variance += (lum - avg) ** 2;
    }
    variance /= pixels;
    if (variance < THRESHOLDS.minVariance) codes.push(ISSUE_CODES.BLURRY);
  }

  return {
    ok: codes.length === 0,
    issues: codes.map((c) => ISSUE_MESSAGES[c]),
    avg,
    codes,
    metrics: { avg, darkRatio, brightRatio, variance, sample: { w, h } },
  };
}
