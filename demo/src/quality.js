/**
 * 輕量影像品質啟發式（Wave 3 / Track G：清晰度改用梯度能量 + 輪廓占比檢查）。
 *
 * ── 對外契約（只能加欄位，不能改語意）─────────────────────────────
 *   analyzeFrame(source, canvas, options?) → { ok, issues, avg, ... }
 *
 *   ok      是否沒有「阻擋級」問題（太暗 / 過曝 / 模糊）。
 *           ⚠️ points.js 用 `quality.ok` 決定積分等第（complete / all_angles），
 *              所以**站位類的建議一律不進 ok**，只走 hints。
 *   issues  阻擋級問題的中文訊息（對應 codes）。
 *   avg     平均亮度 0–255。
 *
 *   新增欄位：
 *   hints / hintCodes  非阻擋建議（站位、輪廓占比）—— 只是引導，不影響 ok / 積分。
 *   aligned            true｜false｜null，車體是否大致落在輪廓內（null = 沒給輪廓、判不出來）。
 *   metrics            所有中間量，方便在 console 對帳。
 *
 * ── 為什麼把「亮度變異數」換成梯度能量 ─────────────────────────────
 *   variance 量的是**全域對比**，不是清晰度：
 *     · 低對比但對焦正確（陰天的白色車身、地下停車場的灰牆）variance 很低 → 被誤判成模糊。
 *     · 高對比但失焦（強烈明暗分區的畫面糊掉）variance 幾乎不變 → 模糊漏判。
 *   舊版還額外套了 `avg > 30 && avg < 200` 才判斷模糊 —— 實際效果是把清晰度檢查
 *   在偏暗/偏亮時整段關掉，等於沒有檢查。兩者一起移除。
 *
 *   改用 Sobel **梯度能量**（平方，即 Tenengrad），並且除以變異數做正規化：
 *       energy     = mean(gx² + gy²)   邊緣能量
 *       gradient   = sqrt(energy)      同量綱的 RMS 梯度（亮度單位／像素，給人看的）
 *       variance   = var(I)            畫面本身的明暗落差
 *       sharpness  = energy / variance 與對比無關的「邊緣有多銳」
 *
 *   ⚠️ 一定要用**平方**：mean|∇I|（一階絕對值）在模糊前後幾乎不變 ——
 *      模糊把一條階梯邊緣攤成 σ 個像素、每個像素的梯度變成 1/σ，總變差（total variation）
 *      是守恆的。實測合成影像 σ=3 的模糊只讓 mean|∇I| 掉 20%，分不出來。
 *      平方之後能量會集中衰減（∝1/σ），才有鑑別力。
 *
 *   正規化的作用：對同一個場景把振幅調小（低對比），energy 與 variance 都 ∝ 振幅²，
 *   sharpness 不變 → 「低對比但對焦正確」不再被誤判；模糊時 energy 掉而 variance 幾乎不動，
 *   sharpness 明顯下降 → 真正的模糊抓得到。
 *
 *   判定刻意用 **AND**（gradient 低 **而且** sharpness 低才算模糊），
 *   理由見 §G6：疊圖與品質提示是「哄使用者站對位置」，不是閘門，寧可放過。
 *
 * ── 輪廓占比（D5）────────────────────────────────────────────────
 *   比較輪廓多邊形**內外**的邊緣密度。車體沒落進輪廓時（站太遠 → 輪廓內大半是背景；
 *   站太近 → 車體邊緣溢出到輪廓外），輪廓外的邊緣密度會相對變高。
 *   文案一律偏向「往後退」：站太近的角點偏差是站太遠的八倍（PIG-13 §1.2 G3）。
 */

/** 站位基準（PIG-13 §1.2 站位表）。文案與 UI 共用同一份數字。 */
export const STANDING_GUIDE = Object.freeze({
  /** 基準相機水平距離（m）—— build-report.json 的渲圖相機 */
  distanceM: 3.85,
  /** 換算成步數的每步長度（m）。3.85 / 0.77 = 5 步 */
  stepM: 0.77,
  /** 顯示用步數 */
  steps: 5,
  /** 相機高（m），胸口平舉 */
  heightM: 1.5,
});

export const THRESHOLDS = {
  /** 取樣寬度（縮到這麼小再逐 pixel 掃，維持 60fps 以外的餘裕） */
  sampleWidth: 160,
  fallbackHeight: 120,

  // ---- 亮度 ----
  darkLum: 40,
  brightLum: 220,
  minAvg: 55,
  maxDarkRatio: 0.45,
  maxBrightRatio: 0.25,

  // ---- 清晰度（梯度能量）----
  /** 正規化銳利度 energy/variance（1/px²）低於此值才算模糊。這是主要判準 */
  minSharpness: 0.05,
  /** 對比低於此值代表畫面幾乎沒有內容（白牆 / 全黑），此時無從判斷清晰度 → 不判 */
  minContrastForBlur: 8,
  /**
   * RMS 梯度高於此值就不判模糊 —— 邊緣本身這麼強，對焦一定是準的。
   * 這條是「寧可放過」的保險絲：畫面若是大面積雙色塊（例如一半天空一半地面），
   * variance 很大但高頻很少，sharpness 會偏低而被誤判成模糊；那種畫面的
   * RMS 梯度反而很高，用它擋掉。代價是極高對比的模糊畫面會漏判 —— 這是我們要的方向。
   */
  maxGradientForBlur: 9,

  // ---- 輪廓占比 / 站位 ----
  /** 邊緣能量落在輪廓內的比例（面積正規化的 RMS）低於此值 → 提示站位 */
  minCoverage: 0.62,
  /** 高於此值就算「大致對上」→ 輪廓轉綠（判定刻意寬鬆，見 G6） */
  alignCoverage: 0.66,
  /** 強邊緣門檻 = 平均能量的幾倍（用來把背景紋理排除在「主體尺度」之外） */
  strongEdgeFactor: 4,
  /** 強邊緣的擴散半徑 ÷ 輪廓半徑；低於此值代表車體遠小於輪廓（站太遠） */
  minSpreadRatio: 0.72,
  /** 整個畫面的 RMS 梯度低於此值 = 沒東西可看（鏡頭遮住 / 全霧），不給站位提示 */
  minSceneGradient: 1.5,
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

/** 非阻擋建議 —— 不會讓 ok 變 false，也不影響積分。 */
export const HINT_CODES = Object.freeze({
  FRAMING: "framing",
});

export const HINT_MESSAGES = {
  [HINT_CODES.FRAMING]:
    `車輛沒對進輪廓：往後退約 ${STANDING_GUIDE.steps} 步（約 ${STANDING_GUIDE.distanceM} m），` +
    "手機橫向、胸口高度，讓全車落進虛線",
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
 * 把多邊形（**正規化座標** 0–1，相對整張畫面）掃描填成遮罩。
 *
 * 用 scanline + even-odd，複雜度 O(h × 邊數)；
 * 逐點做 point-in-polygon 是 O(w × h × 邊數)，在 800ms 迴圈裡沒必要那麼貴。
 *
 * @param {Array<[number, number]>} polygon
 * @param {number} w 取樣寬
 * @param {number} h 取樣高
 * @returns {Uint8Array|null} 1 = 在輪廓內
 */
export function polygonMask(polygon, w, h) {
  if (!Array.isArray(polygon) || polygon.length < 3 || w < 1 || h < 1) return null;
  const n = polygon.length;
  const mask = new Uint8Array(w * h);
  const xs = [];
  let filled = 0;
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ay = polygon[i][1] * h;
      const by = polygon[j][1] * h;
      if (ay > py === by > py) continue;
      const t = (py - ay) / (by - ay);
      xs.push((polygon[i][0] + (polygon[j][0] - polygon[i][0]) * t) * w);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) {
        if (!mask[y * w + x]) filled++;
        mask[y * w + x] = 1;
      }
    }
  }
  // 全部在內 / 全部在外都沒有比較的意義
  if (filled === 0 || filled === w * h) return null;
  return mask;
}

/**
 * 遮罩的重心與 RMS 半徑（像素單位）。拿來當「輪廓有多大」的尺標。
 * @param {Uint8Array} mask
 */
export function maskSpread(mask, w, h) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      n++;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
    }
  }
  if (!n) return null;
  const cx = sx / n;
  const cy = sy / n;
  return {
    cx,
    cy,
    area: n / (w * h),
    spread: Math.sqrt(Math.max(0, sxx / n - cx * cx) + Math.max(0, syy / n - cy * cy)),
  };
}

/**
 * 純計算核心：吃一張亮度圖，吐出全部指標與判定。
 * 不碰 DOM，所以可以在 node 裡對合成影像直接驗算（見 §檔頭）。
 *
 * @param {Float32Array|Uint8Array|number[]} lum 長度 w*h 的亮度（0–255）
 * @param {number} w
 * @param {number} h
 * @param {{ polygon?: Array<[number,number]> }} [options]
 */
export function analyzeLuma(lum, w, h, options = {}) {
  const { polygon = null } = options;
  const pixels = w * h;

  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < pixels; i++) {
    const v = lum[i];
    sum += v;
    if (v < THRESHOLDS.darkLum) dark++;
    if (v > THRESHOLDS.brightLum) bright++;
  }
  const avg = sum / pixels;
  const darkRatio = dark / pixels;
  const brightRatio = bright / pixels;

  let varSum = 0;
  for (let i = 0; i < pixels; i++) varSum += (lum[i] - avg) ** 2;
  const variance = varSum / pixels;
  const contrast = Math.sqrt(variance);

  // ---- Sobel 梯度能量 ----
  const energyMap = new Float32Array(pixels);
  let energySum = 0;
  let gradCount = 0;

  for (let y = 1; y < h - 1; y++) {
    const rowUp = (y - 1) * w;
    const row = y * w;
    const rowDn = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      const tl = lum[rowUp + x - 1];
      const tc = lum[rowUp + x];
      const tr = lum[rowUp + x + 1];
      const ml = lum[row + x - 1];
      const mr = lum[row + x + 1];
      const bl = lum[rowDn + x - 1];
      const bc = lum[rowDn + x];
      const br = lum[rowDn + x + 1];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      // /64 = (1/8)²，8 是 Sobel 核的權重總和 → 量綱回到 (亮度單位/像素)²
      const e = (gx * gx + gy * gy) / 64;
      energyMap[row + x] = e;
      energySum += e;
      gradCount++;
    }
  }

  const energy = gradCount ? energySum / gradCount : 0;
  const gradient = Math.sqrt(energy);
  // 除以變異數 → 與畫面明暗落差無關的「邊緣銳利度」
  const sharpness = energy / Math.max(variance, 1);

  // ---- 輪廓占比 + 主體尺度（需要輪廓才算得出來）----
  const mask = polygonMask(polygon, w, h);
  let insideDensity = null;
  let outsideDensity = null;
  let coverage = null;
  let spreadRatio = null;

  if (mask && energySum > 0) {
    let inSum = 0;
    let inCount = 0;
    let outSum = 0;
    let outCount = 0;
    // 只有「強邊緣」才算進主體尺度。
    // 全部像素一起加權沒有用：背景紋理鋪滿整張畫面，會把擴散半徑一路拉到畫框大小，
    // 站太遠與站對量出來會一模一樣（實測 1.345 vs 1.350）。
    // 強邊緣門檻取平均能量的 k 倍 —— 相對量，不受場景整體對比影響。
    const strong = energy * THRESHOLDS.strongEdgeFactor;
    let sw2 = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const e = energyMap[row + x];
        if (mask[row + x]) {
          inSum += e;
          inCount++;
        } else {
          outSum += e;
          outCount++;
        }
        if (e > strong) {
          sw2 += e;
          sx += e * x;
          sy += e * y;
          sxx += e * x * x;
          syy += e * y * y;
        }
      }
    }

    // 用 RMS 而不是能量本身來比：能量是平方量，少數幾條強邊緣就會把比值推到極端，
    // RMS 跟亮度同量綱，比值比較溫和也比較好定門檻。
    insideDensity = inCount ? Math.sqrt(inSum / inCount) : null;
    outsideDensity = outCount ? Math.sqrt(outSum / outCount) : null;
    if (insideDensity != null && outsideDensity != null && insideDensity + outsideDensity > 0) {
      // 面積已各自正規化，所以 0.5 = 內外一樣密；> 0.5 = 邊緣集中在輪廓內
      coverage = insideDensity / (insideDensity + outsideDensity);
    }

    // 「車體有沒有大到填滿輪廓」—— coverage 抓不到這一項：
    // 車體遠小於輪廓時它整個落在輪廓內，coverage 反而很高。
    const outline = maskSpread(mask, w, h);
    if (sw2 > 0 && outline && outline.spread > 0) {
      const cx = sx / sw2;
      const cy = sy / sw2;
      const subjectSpread = Math.sqrt(
        Math.max(0, sxx / sw2 - cx * cx) + Math.max(0, syy / sw2 - cy * cy)
      );
      spreadRatio = subjectSpread / outline.spread;
    }
  }

  // ---- 判定 ----
  const codes = [];
  if (avg < THRESHOLDS.minAvg || darkRatio > THRESHOLDS.maxDarkRatio) {
    codes.push(ISSUE_CODES.DARK);
  }
  if (brightRatio > THRESHOLDS.maxBrightRatio) {
    codes.push(ISSUE_CODES.OVEREXPOSED);
  }
  // 模糊：gradient 低「而且」正規化後也不銳利，才算數（見檔頭：刻意寬鬆）
  // 對比太低時整張畫面沒有內容可判，直接不判（不是「不模糊」，是「不知道」）
  const blurJudgeable =
    contrast >= THRESHOLDS.minContrastForBlur && gradient < THRESHOLDS.maxGradientForBlur;
  if (blurJudgeable && sharpness < THRESHOLDS.minSharpness) {
    codes.push(ISSUE_CODES.BLURRY);
  }

  const sceneHasContent = gradient >= THRESHOLDS.minSceneGradient;
  const measurable = coverage != null && sceneHasContent;
  const tooSmall = spreadRatio != null && spreadRatio < THRESHOLDS.minSpreadRatio;

  const hintCodes = [];
  if (measurable && (coverage < THRESHOLDS.minCoverage || tooSmall)) {
    hintCodes.push(HINT_CODES.FRAMING);
  }

  // 對齊只看幾何，不看光線 —— 綠色輪廓回答的是「我站對了嗎」，
  // 太暗 / 過曝由 issues 各自提醒，兩者不互相蓋台。
  const aligned = !measurable ? null : coverage >= THRESHOLDS.alignCoverage && !tooSmall;

  return {
    ok: codes.length === 0,
    issues: codes.map((c) => ISSUE_MESSAGES[c]),
    avg,
    codes,
    hints: hintCodes.map((c) => HINT_MESSAGES[c]),
    hintCodes,
    aligned,
    metrics: {
      avg,
      darkRatio,
      brightRatio,
      variance,
      contrast,
      energy,
      gradient,
      sharpness,
      blurJudgeable,
      coverage,
      insideDensity,
      outsideDensity,
      spreadRatio,
      sample: { w, h },
    },
  };
}

/**
 * 分析一格畫面。
 * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement} source 畫面來源
 * @param {HTMLCanvasElement} canvas 暫存用 canvas（會被覆寫，呼叫端自備一個重複用）
 * @param {{ polygon?: Array<[number,number]> }} [options]
 *   polygon = 引導輪廓，**正規化到整張來源畫面**的 0–1 座標
 *             （呼叫端要自己處理疊圖畫框與串流之間的 letterbox 位移）
 * @returns {{ ok: boolean, issues: string[], avg: number, codes: string[],
 *             hints: string[], hintCodes: string[], aligned: boolean|null, metrics: object }}
 */
export function analyzeFrame(source, canvas, options = {}) {
  const { width: srcW, height: srcH } = sourceSize(source);
  const w = THRESHOLDS.sampleWidth;
  const h = srcW > 0 ? Math.round((srcH / srcW) * w) || THRESHOLDS.fallbackHeight : THRESHOLDS.fallbackHeight;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }

  return analyzeLuma(lum, w, h, options);
}
