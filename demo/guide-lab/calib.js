/**
 * guide-lab / calib.js —— 相機視野校正（純計算，完全不碰 DOM）
 *
 * ── 為什麼需要這支 ────────────────────────────────────────────────
 *   整套輪廓的相機假設是等效焦距 26 mm（hFOV 69.39°）。這個假設有兩個破口：
 *
 *   1. 各家手機主鏡頭等效焦距落在 23–28 mm，而且 getUserMedia 給的**視訊串流視野
 *      常常跟相機 App 拍照的視野不一樣**（額外裁切、防手震邊界、不同的 sensor crop）。
 *      所以「EXIF 寫 26 mm」不能拿來當串流的焦距。
 *   2. 這個專案已經被鏡頭問題咬過一次：一張參考照片在無畸變針孔模型下幾何自相矛盾
 *      —— 輪圈橢圓垂直半徑推出到前輪約 2.2 m，輪轂間距加真實軸距卻推出約 4.4 m，
 *      差了快兩倍。原因可能是 EXIF 焦距與實際鏡頭不符，或未校正的桶狀變形。
 *
 *   如果使用者的串流實際是 24 mm 或 28 mm，他站在「正確」位置也會覺得輪廓對不上，
 *   然後誤判成輪廓錯了。這支檔案存在的唯一目的，是把「鏡頭問題」跟「輪廓問題」分開。
 *
 * ── 幾何（針孔模型）──────────────────────────────────────────────
 *   物件實寬 W、鏡頭到物件距離 D、物件在畫面上佔 w 像素、串流總寬 w_total：
 *
 *       tan(hFOV/2) = (W/2)/D · (w_total/w)
 *       hFOV        = 2·atan( (W/2)/D · (w_total/w) )
 *       f_equiv     = 18 / tan(hFOV/2) = 36·D·w / (W·w_total)      （36 mm 全片幅水平寬的一半 = 18）
 *
 *   f_equiv 對 D 與 w 是**線性**、對 W 是反比 —— 所以相對誤差可以直接相加：
 *       δf/f = δD/D ⊕ δw/w ⊕ δW/W
 *   這個性質讓不確定度可以誠實地拆給使用者看，不用假裝有一個很精確的數字。
 *
 * ── 這個量測不保證什麼 ────────────────────────────────────────────
 *   · 假設無畸變。真實手機鏡頭有桶狀變形，物件邊緣越靠畫面邊緣，量到的 hFOV 越偏大。
 *   · 假設物件平面垂直於光軸且大致置中。歪一點就有 cos 誤差。
 *   · 量的是**串流**的視野，不是相機 App 拍照的視野 —— 這正是我們要的，
 *     因為疊圖是疊在串流上。
 */

import { fovFromFocal } from "./geom.js";

/** 35mm 全片幅水平寬 36 mm 的一半。等效焦距的定義基準。 */
export const SENSOR_HALF_W_MM = 18;
/** 整套輪廓的相機假設 */
export const ASSUMED_FOCAL_MM = 26;
export const ASSUMED_HFOV_DEG = fovFromFocal(ASSUMED_FOCAL_MM).hfov; // 69.39…°

const DEG = 180 / Math.PI;

/**
 * 預設的量測不確定度。這些數字是「誠實的悲觀」，不是實驗室規格：
 *   edgePx     每一邊的標線誤差（串流像素，兩邊獨立）—— 手指在手機上大概就是這個量級
 *   distanceCm 捲尺誤差，含「感光元件到底在手機殼內哪個位置」的未知（約 ±1 cm）
 *   widthCm    物件實寬的量測誤差（門框有裝潢收邊、紙箱有鼓起）
 */
export const DEFAULT_SIGMA = { edgePx: 5, distanceCm: 2, widthCm: 0.5 };

/** 明顯不合理的等效焦距界線 —— 超出就不給結論，先請使用者檢查輸入 */
export const PLAUSIBLE = { hardMin: 15, softMin: 20, softMax: 40, hardMax: 50 };

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** hFOV(deg) → 等效焦距(mm) */
export function focalFromHfov(hfovDeg) {
  const t = Math.tan(hfovDeg / DEG / 2);
  return t > 0 ? SENSOR_HALF_W_MM / t : Infinity;
}

/** 等效焦距(mm) → hFOV(deg)。走 geom.js 同一條公式，不另立一套。 */
export function hfovFromFocal(focalMm) {
  return fovFromFocal(focalMm).hfov;
}

/**
 * 核心反推：由「已知寬度的物件」量出串流的水平視野。
 * 單位刻意用 cm（捲尺就是 cm）與串流像素（不是 CSS px —— 那是這類 bug 的經典來源）。
 */
export function measureFocal({ widthCm, distanceCm, widthPx, streamW }) {
  const tanHalf = ((widthCm / 2) / distanceCm) * (streamW / widthPx);
  return {
    tanHalf,
    hfovDeg: 2 * Math.atan(tanHalf) * DEG,
    focalMm: SENSOR_HALF_W_MM / tanHalf,
  };
}

/**
 * 反算：某個焦距下，物件左右緣應該落在串流的哪兩個像素位置（物件置中）。
 * 用途 (1) UI 的「26 mm 自我檢查範例」按鈕 (2) 純計算驗證公式往返一致。
 */
export function syntheticEdges({ focalMm, widthCm, distanceCm, streamW }) {
  const halfPx = ((widthCm / 2) / distanceCm) * (focalMm / SENSOR_HALF_W_MM) * (streamW / 2);
  return { xL: streamW / 2 - halfPx, xR: streamW / 2 + halfPx, widthPx: halfPx * 2 };
}

/**
 * 串流 → 4:3 畫框（object-fit: cover）會裁掉多少水平視野。
 *
 * 這件事很容易被忽略但很致命：疊圖是畫在 4:3 畫框裡的，
 * 串流若是 16:9，cover 會裁掉左右，**畫框看到的 hFOV 比串流本身窄**。
 * 要拿來跟 26 mm 比的是「畫框的」等效焦距，不是串流的。
 */
export function frameCrop({ streamW, streamH, frameAspect = 4 / 3 }) {
  const streamAspect = streamW / streamH;
  const visibleFrac = Math.min(1, frameAspect / streamAspect);
  return {
    streamAspect,
    frameAspect,
    visibleFrac,
    cropped: visibleFrac < 0.995,
    croppedPct: (1 - visibleFrac) * 100,
  };
}

/**
 * 不確定度傳遞。f = 36·D·w/(W·w_total) → 相對誤差可分離，三項用平方和（各自獨立）。
 * 同時回傳「單邊標偏 5 px 會差多少」—— 使用者最能直接感受的那個數字。
 */
export function uncertainty({ focalMm, widthPx, widthCm, distanceCm, sigma = DEFAULT_SIGMA }) {
  const relW = sigma.widthCm / widthCm;                       // 物件實寬
  const relD = sigma.distanceCm / distanceCm;                 // 捲尺距離
  const relE = (Math.SQRT2 * sigma.edgePx) / widthPx;         // 兩邊各一次，獨立 → √2·σ
  const relTotal = Math.hypot(relW, relD, relE);
  const focalSigmaMm = focalMm * relTotal;
  // hfov = 2·atan(18/f) → d(hfov)/df = −36/(f²+324) rad/mm
  const hfovSigmaDeg = (36 / (focalMm * focalMm + 324)) * focalSigmaMm * DEG;
  const term = (k, label, rel) => ({ k, label, rel, pct: rel * 100 });
  return {
    terms: [
      term("edge", `標邊緣 ±${sigma.edgePx} px（每邊）`, relE),
      term("dist", `距離 ±${sigma.distanceCm} cm`, relD),
      term("width", `物寬 ±${sigma.widthCm} cm`, relW),
    ].sort((a, b) => b.rel - a.rel),
    relTotal,
    pctTotal: relTotal * 100,
    focalSigmaMm,
    hfovSigmaDeg,
    // 單邊多標／少標 5 px 的直接後果（δw = 5 px → δf/f = 5/w）
    per5px: { mm: (focalMm * 5) / widthPx, pct: (5 / widthPx) * 100 },
  };
}

/**
 * 「這個偏差對站位的影響」—— 使用者真正需要知道的那一段。
 *
 * 畫面上物體佔畫框的比例 = tan(θ/2)/tan(hFOV/2)，而 tan(hFOV/2)=18/f，
 * 所以同一個距離下，實拍車體 / 疊圖輪廓的大小比 = f_實測 / f_假設。
 *   f 小（鏡頭更廣）→ 車體看起來比輪廓小 → 要往前站。
 *   要維持一樣大小：D' = D · f_實測/f_假設。
 *
 * ⚠ 但走位跟改焦距不等價：走位會同時改變透視（前後端的縮短程度），改焦距不會。
 *   所以優先建議把量到的焦距填回滑桿（geom.js 註明焦距軸是精確解），
 *   走位只是「不能改疊圖時」的替代方案。
 */
export function standingImpact({ focalMm, assumedFocalMm = ASSUMED_FOCAL_MM, baseDistanceM = 3.85 }) {
  const sizeRatio = focalMm / assumedFocalMm;
  return {
    sizeRatio,
    sizePct: (sizeRatio - 1) * 100,              // 負 = 車體比輪廓小
    focalDevPct: (sizeRatio - 1) * 100,          // 與 sizePct 同值（tan 成比例），但語意不同，分開命名
    hfovDevDeg: hfovFromFocal(focalMm) - hfovFromFocal(assumedFocalMm),
    suggestedDistanceM: baseDistanceM * sizeRatio,
    deltaDistanceM: baseDistanceM * (sizeRatio - 1),
  };
}

/** 反推值明顯不合理時，寧可不給結論 */
export function plausibility(focalMm) {
  if (!isFinite(focalMm) || focalMm <= 0) {
    return { level: "invalid", message: "算不出有效值 —— 檢查輸入。" };
  }
  if (focalMm < PLAUSIBLE.hardMin) {
    return {
      level: "invalid",
      message: `等效焦距 ${focalMm.toFixed(1)} mm 低於 ${PLAUSIBLE.hardMin} mm，沒有手機主鏡頭這麼廣。
        多半是：距離填成公尺而不是公分／物件寬度填錯／兩條線標到別的東西上。`,
    };
  }
  if (focalMm > PLAUSIBLE.hardMax) {
    return {
      level: "invalid",
      message: `等效焦距 ${focalMm.toFixed(1)} mm 高於 ${PLAUSIBLE.hardMax} mm（望遠鏡頭等級）。
        多半是：距離量錯／物件寬度填錯／串流實際被數位變焦裁過。`,
    };
  }
  if (focalMm < PLAUSIBLE.softMin) {
    return {
      level: "suspect",
      message: `${focalMm.toFixed(1)} mm 已經是<b>超廣角鏡頭</b>的範圍。
        很可能瀏覽器把串流給了超廣角鏡頭（部分 Android 的 facingMode:environment 會這樣），
        而不是主鏡頭；也可能是明顯的桶狀變形讓邊緣被推開。先確認取到的是主鏡頭。`,
    };
  }
  if (focalMm > PLAUSIBLE.softMax) {
    return {
      level: "suspect",
      message: `${focalMm.toFixed(1)} mm 比一般手機主鏡頭窄很多，
        可能串流被數位變焦或防手震裁切過。數字本身可能是對的（疊圖就該照它算），但值得再量一次確認。`,
    };
  }
  return { level: "ok", message: "" };
}

/** 量測本身的品質提醒（跟結果無關，是「這次量得好不好」） */
export function qualityNotes({ frac, widthCm, distanceCm, per5pxPct }) {
  const out = [];
  if (frac < 0.15) {
    out.push({ level: "bad", text: `物件只佔畫面 ${(frac * 100).toFixed(0)}% 寬 —— 太小了。
      單邊標偏 5 px 就造成 ${per5pxPct.toFixed(1)}% 焦距誤差。靠近一點或換更寬的物件。` });
  } else if (frac < 0.3) {
    out.push({ level: "warn", text: `物件只佔畫面 ${(frac * 100).toFixed(0)}% 寬，標線誤差被放大。理想是 40–70%。` });
  } else if (frac > 0.85) {
    out.push({ level: "warn", text: `物件佔畫面 ${(frac * 100).toFixed(0)}% 寬，左右緣落在<b>桶狀變形最嚴重</b>的區域，
      量到的 hFOV 會偏大（焦距偏小）。退後一點讓物件佔 40–70% 再量一次。` });
  }
  if (distanceCm < widthCm * 0.8) {
    out.push({ level: "warn", text: `距離（${distanceCm} cm）小於物件寬度（${widthCm} cm）。
      這麼近的時候，物件平面只要沒有正對鏡頭就有明顯 cos 誤差。退遠一點比較穩。` });
  }
  if (distanceCm < 40) {
    out.push({ level: "warn", text: "距離小於 40 cm：手機的感光元件到底在機身哪個位置（±1 cm）已經佔可觀比例。" });
  }
  return out;
}

/**
 * 一次算完 UI 需要的全部東西。
 * @param {object} p
 * @param {number} p.widthCm      物件實寬（公分）
 * @param {number} p.distanceCm   鏡頭到物件的實測距離（公分）
 * @param {number} p.xL,p.xR      兩條標線在**串流像素**座標的位置
 * @param {number} p.streamW      串流實際像素寬（video.videoWidth / track.getSettings()）
 * @param {number} p.streamH      串流實際像素高
 * @param {number} [p.frameAspect] 疊圖畫框的長寬比（本頁固定 4:3）
 * @param {number} [p.baseDistanceM] 基準站位，用來換算「該站多遠」
 */
export function assess({
  widthCm, distanceCm, xL, xR, streamW, streamH,
  frameAspect = 4 / 3,
  assumedFocalMm = ASSUMED_FOCAL_MM,
  baseDistanceM = 3.85,
  sigma = DEFAULT_SIGMA,
}) {
  const bad = (error) => ({ ok: false, error });
  if (!(widthCm > 0)) return bad("請填物件實際寬度（公分）。");
  if (!(distanceCm > 0)) return bad("請填物件到手機的距離（公分，用捲尺量）。");
  if (!(streamW > 0 && streamH > 0)) return bad("還沒拿到串流的實際像素尺寸 —— 先開啟相機。");

  const widthPx = Math.abs(xR - xL);
  if (widthPx < 8) return bad("兩條標線幾乎重疊 —— 把它們拖到物件的左右緣。");

  const frac = widthPx / streamW;
  const m = measureFocal({ widthCm, distanceCm, widthPx, streamW });
  const crop = frameCrop({ streamW, streamH, frameAspect });

  // 畫框（cover 裁切後）實際看到的視野 —— 要跟 26 mm 比的是這個
  const frameFocalMm = m.focalMm / crop.visibleFrac;
  const frameHfovDeg = hfovFromFocal(frameFocalMm);

  const unc = uncertainty({ focalMm: frameFocalMm, widthPx, widthCm, distanceCm, sigma });
  const impact = standingImpact({ focalMm: frameFocalMm, assumedFocalMm, baseDistanceM });
  const plaus = plausibility(frameFocalMm);
  const quality = qualityNotes({ frac, widthCm, distanceCm, per5pxPct: unc.per5px.pct });

  const devPct = impact.focalDevPct;
  const absDev = Math.abs(devPct);
  // 偏差比量測誤差還小 → 這次量測分辨不出來，不能宣稱有偏差
  const withinNoise = absDev <= unc.pctTotal;

  let verdict;
  if (plaus.level === "invalid") {
    verdict = {
      level: "invalid",
      headline: "這組數字不合理，先不要拿來下結論",
      advice: "輸入可能有誤，或鏡頭有明顯畸變。修正輸入後再量一次。",
    };
  } else if (withinNoise || absDev <= 3) {
    const noisy = withinNoise && absDev > 3;
    verdict = {
      level: "ok",
      headline: noisy
        ? `偏差 ${absDev.toFixed(1)}% 落在本次量測誤差內 —— 分辨不出跟 ${assumedFocalMm} mm 有沒有差`
        : `視野與 ${assumedFocalMm} mm 假設相符 —— 輪廓對不上就是輪廓的問題`,
      advice: noisy
        ? "先照輪廓的站位評估沒問題。想更有把握就用更寬的物件、或把距離量得更準，再量一次。"
        : "可以直接按輪廓指示的站位評估輪廓，看到的落差不是鏡頭造成的。",
    };
  } else {
    // 有裁切時，偏差不全是鏡頭造成的 —— 講成「鏡頭比較窄」會誤導
    const what = crop.cropped ? "畫框實際視野" : "鏡頭";
    const dir = devPct < 0 ? "廣" : "窄";
    verdict = absDev <= 8
      ? {
        level: "warn",
        headline: `${what}比假設${dir} ${absDev.toFixed(1)}% —— 看得出來，但可修正`,
        advice: "先把量到的焦距套進「相機參數」的焦距滑桿，再評估輪廓。不套的話會把這段差異誤判成輪廓錯。",
      }
      : {
        level: "bad",
        headline: `${what}比假設${dir} ${absDev.toFixed(1)}% —— 這時候評估輪廓一定會誤判`,
        advice: "務必先套用量到的焦距（或照建議距離站），否則你看到的落差主要來自鏡頭，不是輪廓。",
      };
  }

  return {
    ok: true,
    widthPx, frac,
    stream: { w: streamW, h: streamH, hfovDeg: m.hfovDeg, focalMm: m.focalMm },
    frame: { hfovDeg: frameHfovDeg, focalMm: frameFocalMm, ...crop },
    assumed: { focalMm: assumedFocalMm, hfovDeg: hfovFromFocal(assumedFocalMm) },
    unc, impact, plaus, quality, verdict, withinNoise,
    suggestedSliderFocal: clampNum(frameFocalMm, 20, 34),
  };
}
