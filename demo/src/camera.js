/**
 * 相機控制器（抽自 PoC app.js:160-200 的 startCamera / loopQualityCheck / capturePhoto）。
 *
 * 兩種模式
 *   live —— getUserMedia，畫面來源是 <video>
 *   mock —— ?mock=1、瀏覽器無相機 API、或 getUserMedia 失敗/被拒時自動降級，
 *           畫面來源改成 <canvas>（畫一張明顯是佔位用的圖）。
 *           這樣整條 demo 劇本在筆電上（甚至拒絕授權後）都還能點完。
 *
 * 換成真實車輛照片
 *   把照片放到 `demo/assets/car-<cornerId>.jpg`
 *   （cornerId = lf / rf / lr / rr，見 src/guides.js 的 CORNERS）
 *   例：demo/assets/car-lf.jpg、demo/assets/car-rf.jpg …
 *   另外 `demo/assets/car-default.jpg` 會被當作沒有對應角度時的通用底圖。
 *   檔案存在就會自動被載入當畫面來源，**不需要改任何程式碼**
 *   （偵測用 fetch HEAD，所以檔案不存在也不會在 console 留 404 紅字）。
 *
 * 畫面幾何（Wave 3 / Track G）
 *   串流尺寸一律以 **video.videoWidth/Height** 為準（那才是實際解碼出來的畫格），
 *   track.getSettings() 只在 metadata 還沒到時當備援 —— 兩者常常不一致。
 *   `onStream` 會在尺寸確定 / 改變時回呼，呼叫端要用它把畫框設成串流的長寬比，
 *   **絕對不要用 object-fit: cover 把串流裁進固定畫框**：16:9 串流被 4:3 畫框
 *   cover 之後等效焦距從 26 mm 變成 34.7 mm（+33%），疊圖就跟影像幾何完全脫鉤了。
 *
 * 資源釋放
 *   stop() 會關掉 MediaStream track 與品質檢查 interval。
 *   畫面模組必須在 cleanup 裡呼叫 stop()。
 */

import { config } from "./config.js";
import { analyzeFrame, sourceSize } from "./quality.js";
import { resourceExists } from "./util.js";

export const MOCK_ASSET_DIR = "assets";
export const MOCK_ASSET_PATTERN = "assets/car-<cornerId>.jpg";
/**
 * 模擬相機畫布的預設尺寸 —— 直向 3:4，維持補拍 / 使用中回報兩個畫面既有的版面。
 * 四角拍照畫面是橫向 4:3（幾何硬需求，PIG-13 §1.2 G1），
 * 由 createCamera({ mockSize }) 自己指定，不改這個預設值。
 */
export const DEFAULT_MOCK_SIZE = Object.freeze({ width: 1080, height: 1440 });
const MOCK_W = DEFAULT_MOCK_SIZE.width;
const MOCK_H = DEFAULT_MOCK_SIZE.height;

/** 已載入的 asset 影像快取：cornerId → HTMLImageElement | null */
const assetCache = new Map();

async function loadCornerAsset(cornerId) {
  const key = cornerId || "default";
  if (assetCache.has(key)) return assetCache.get(key);
  const path = `${MOCK_ASSET_DIR}/car-${key}.jpg`;
  const promise = (async () => {
    if (!(await resourceExists(path))) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = path;
    });
  })();
  assetCache.set(key, promise);
  return promise;
}

/**
 * 假車體剪影（純示意，不是任何車款）。座標定義在單位框 [0,1]²，
 * 這樣同一份形狀可以塞進任何長寬比的畫布 / 任何目標方框。
 */
const MOCK_CAR = (() => {
  // 原始座標（以車體中心為原點）→ 正規化到單位框
  const body = [
    [-360, 60], [-300, -40], [-140, -80], [120, -90], [300, -30], [360, 50], [340, 140], [-340, 150],
  ];
  const roof = [[-250, -42], [-150, -74], [100, -80], [230, -34]];
  const wheels = [[-215, 150, 78], [215, 150, 78]];
  const X0 = -360, X1 = 360, Y0 = -90, Y1 = 228; // 含輪胎下緣
  const u = (x) => (x - X0) / (X1 - X0);
  const v = (y) => (y - Y0) / (Y1 - Y0);
  return {
    body: body.map(([x, y]) => [u(x), v(y)]),
    roof: roof.map(([x, y]) => [u(x), v(y)]),
    wheels: wheels.map(([x, y, r]) => [u(x), v(y), r / (X1 - X0)]),
  };
})();

/**
 * 加一層感光雜訊。
 *
 * 不是為了好看：canvas 畫出來的畫面**完全沒有高頻成分**（純色塊 + 漸層），
 * 而 quality.js 的清晰度判準正是「高頻能量 ÷ 對比」。實測沒有雜訊的佔位圖
 * sharpness 只有 0.055，門檻是 0.05 —— 只差 10%，隨便一點改動就會被判成模糊，
 * 整段 demo 的積分等第就從「品質達標」掉下來。真的相機串流一定有雜訊，
 * 補上它同時比較真實，也讓餘裕變成 40%。
 *
 * 雜訊格子刻意畫成 (canvas 寬 / 160) 大小 —— quality.js 取樣寬度就是 160，
 * 更細的雜訊會在降取樣時被平均掉，等於沒加。
 */
function drawSensorGrain(ctx, width, height) {
  const gw = 160;
  const gh = Math.max(1, Math.round((height / width) * gw));
  const grain = document.createElement("canvas");
  grain.width = gw;
  grain.height = gh;
  const g = grain.getContext("2d");
  const img = g.createImageData(gw, gh);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    // 中性灰 ±32：overlay 混色下 128 是恆等元，所以整體亮度不會被推走
    const v = 128 + (Math.random() - 0.5) * 65;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(grain, 0, 0, width, height);
  ctx.restore();
}

function drawMockCar(ctx, box) {
  const px = (p) => [box.x + p[0] * box.w, box.y + p[1] * box.h];
  const poly = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = px(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = "#c2cbd6";
  poly(MOCK_CAR.body);
  ctx.fillStyle = "#8d99a8";
  poly(MOCK_CAR.roof);
  ctx.fillStyle = "#20262e";
  for (const [cx, cy, r] of MOCK_CAR.wheels) {
    const [x, y] = px([cx, cy]);
    ctx.beginPath();
    ctx.ellipse(x, y, r * box.w, r * box.w, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 畫一張「明顯是佔位用」的模擬相機畫面。
 * 亮度/對比刻意調成能通過 quality.js 檢查（不會一直跳警告）。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @param {string} [opts.label] 角度標籤
 * @param {string} [opts.note]  底部說明
 * @param {number} [opts.width]  畫布寬（預設直向 1080）
 * @param {number} [opts.height] 畫布高（預設直向 1440）
 * @param {{x:number,y:number,w:number,h:number}} [opts.guideBox]
 *   引導輪廓在畫面上的**正規化**位置。給了就把假車體畫進這個框裡 ——
 *   模擬相機才演得出「站對位置 → 輪廓變綠」，不然疊圖占比檢查在 mock 模式下
 *   永遠是隨機結果，demo 講不出東西。
 */
export function drawMockFrame(canvas, opts = {}) {
  const { label = "", note = "", width = MOCK_W, height = MOCK_H, guideBox = null } = opts;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const S = Math.min(width, height) / 1080; // 字級 / 線寬的縮放基準

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#3b4552");
  bg.addColorStop(1, "#2f3844");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 網格（強調這是佔位圖）
  const step = Math.round(90 * S) || 90;
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // 假車體：有 guideBox 就對齊輪廓（略縮 8%，看起來像「站得剛剛好」）；
  // 沒有就用原本那個位置（= 直向 1080×1440 時與 Wave 1 的畫面完全一致）
  const box = guideBox
    ? {
      x: (guideBox.x + guideBox.w * 0.04) * width,
      y: (guideBox.y + guideBox.h * 0.04) * height,
      w: guideBox.w * 0.92 * width,
      h: guideBox.h * 0.92 * height,
    }
    : { x: width * 0.166667, y: height * 0.465278, w: width * 0.666667, h: height * 0.220833 };
  drawMockCar(ctx, box);
  drawSensorGrain(ctx, width, height);

  ctx.textAlign = "center";
  if (guideBox) {
    // 對齊輪廓的版本（四角拍照）：說明文字降成淡淡的浮水印。
    // 理由不是美觀 —— 大字高對比的文字會主導整張畫面的邊緣能量統計，
    // 讓 quality.js 的輪廓占比永遠算不出「車體在輪廓裡」。真相機也不會拍到這種字。
    ctx.font = `600 ${Math.round(30 * S)}px -apple-system, 'Noto Sans TC', sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    ctx.fillText("模擬相機 · MOCK CAMERA", width / 2, 44 * S);
    ctx.font = `400 ${Math.round(24 * S)}px -apple-system, 'Noto Sans TC', sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.26)";
    ctx.fillText(
      label ? `${label}　·　${MOCK_ASSET_PATTERN} 可換成真實照片` : MOCK_ASSET_PATTERN,
      width / 2,
      height - 26 * S
    );
    return canvas;
  }

  // 文字說明（直向預設版面，補拍 / 使用中回報沿用）
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `700 ${Math.round(92 * S)}px -apple-system, 'Noto Sans TC', sans-serif`;
  ctx.fillText("模擬相機", width / 2, 300 * S);
  ctx.font = `600 ${Math.round(46 * S)}px -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("MOCK CAMERA", width / 2, 370 * S);

  if (label) {
    ctx.font = `700 ${Math.round(60 * S)}px -apple-system, 'Noto Sans TC', sans-serif`;
    ctx.fillStyle = "#00e0c2";
    ctx.fillText(label, width / 2, height - 260 * S);
  }
  ctx.font = `400 ${Math.round(34 * S)}px -apple-system, 'Noto Sans TC', sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(note || `放入 ${MOCK_ASSET_PATTERN} 可換成真實照片`, width / 2, height - 180 * S);
  return canvas;
}

/**
 * 把真實素材照片畫成模擬「串流」。
 * 這裡用 cover 是刻意的：canvas 模擬的是感光元件輸出，真相機不會有黑邊。
 * （顯示層才必須用 contain —— 那是 capture.js 的事。）
 */
function drawAssetFrame(canvas, img, label, size = DEFAULT_MOCK_SIZE) {
  const width = size.width;
  const height = size.height;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const S = Math.min(width, height) / 1080;
  const scale = Math.max(width / img.width, height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
  if (label) {
    // 靠左下角的小標，不要用整條置中橫幅 —— 那會蓋到 guides.js 畫在正下方的輪廓副標籤
    const text = `模擬素材 · ${label}`;
    ctx.textAlign = "left";
    ctx.font = `600 ${Math.round(38 * S)}px -apple-system, 'Noto Sans TC', sans-serif`;
    const pad = 16 * S;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(24 * S, height - 86 * S, w + pad * 2, 56 * S);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, 24 * S + pad, height - 48 * S);
  }
  return canvas;
}

/**
 * 建立相機控制器。
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video       live 模式的畫面元素
 * @param {HTMLCanvasElement} opts.mockCanvas mock 模式的畫面元素（會被 show/hide）
 * @param {HTMLCanvasElement} opts.scratchCanvas 品質分析用暫存 canvas（hidden）
 * @param {(result: object) => void} [opts.onQuality] 每次品質檢查的回呼
 * @param {(mode: string, info: object) => void} [opts.onMode] 模式確定 / 改變時的回呼
 * @param {(size: {width:number,height:number,aspect:number,source:string}) => void} [opts.onStream]
 *   **串流實際像素尺寸**確定 / 改變時的回呼。畫框要照這個設長寬比（見檔頭）。
 * @param {() => object} [opts.qualityOptions] 每次分析前呼叫，回傳傳給 analyzeFrame 的 options
 *   （例：`() => ({ polygon })`，讓品質檢查知道引導輪廓在哪裡）
 * @param {{width:number,height:number}} [opts.mockSize] 模擬畫布尺寸（預設直向 1080×1440）
 * @param {number} [opts.intervalMs=800] 品質檢查間隔
 */
export function createCamera(opts) {
  const {
    video,
    mockCanvas,
    scratchCanvas,
    onQuality = () => {},
    onMode = () => {},
    onStream = () => {},
    qualityOptions = () => ({}),
    mockSize = DEFAULT_MOCK_SIZE,
    intervalMs = 800,
  } = opts;

  let stream = null;
  let timer = null;
  let paused = false;
  let mode = "idle"; // idle | live | mock
  let mockLabel = "";
  let mockLabelCornerId = null;
  let mockGuideBox = null;
  let stopped = false;
  let settings = null;
  let lastSize = { width: 0, height: 0 };

  function setMode(next, info = {}) {
    mode = next;
    const isMock = next === "mock";
    if (video) video.hidden = isMock;
    if (mockCanvas) mockCanvas.hidden = !isMock;
    onMode(next, info);
    notifySize();
  }

  function currentSource() {
    return mode === "mock" ? mockCanvas : video;
  }

  /**
   * 串流的**實際**像素尺寸。
   * 一律以 videoWidth 為準（那是真的解碼出來的畫格），
   * track.getSettings() 只在 metadata 還沒到時當備援 —— 兩者常常不一致。
   */
  function streamSize() {
    if (mode === "mock") {
      const { width, height } = sourceSize(mockCanvas);
      return { width, height, aspect: height ? width / height : 0, source: "mock" };
    }
    const { width, height } = sourceSize(video);
    if (width > 0 && height > 0) {
      return { width, height, aspect: width / height, source: "video" };
    }
    if (settings?.width && settings?.height) {
      return {
        width: settings.width,
        height: settings.height,
        aspect: settings.width / settings.height,
        source: "settings",
      };
    }
    return { width: 0, height: 0, aspect: 0, source: "none" };
  }

  function notifySize() {
    const size = streamSize();
    if (!size.width || !size.height) return;
    if (size.width === lastSize.width && size.height === lastSize.height) return;
    lastSize = { width: size.width, height: size.height };
    onStream(size);
  }

  // <video> 的 metadata 常常晚於 play() 才到，resize 則是相機中途換解析度時觸發。
  // 兩個都要聽，不然畫框會停在錯的長寬比（= 疊圖與影像脫鉤）。
  const onVideoSize = () => notifySize();
  function bindVideo() {
    if (!video) return;
    video.addEventListener("loadedmetadata", onVideoSize);
    video.addEventListener("resize", onVideoSize);
  }
  function unbindVideo() {
    if (!video) return;
    video.removeEventListener("loadedmetadata", onVideoSize);
    video.removeEventListener("resize", onVideoSize);
  }

  function ready() {
    const source = currentSource();
    if (!source) return false;
    if (mode === "live") return video.readyState >= 2;
    const { width, height } = sourceSize(source);
    return width > 0 && height > 0;
  }

  function startQualityLoop() {
    clearInterval(timer);
    // stop() 可能在 start() 的 await 期間就被呼叫了 —— 那時候再建 interval
    // 就變成沒有人收得掉的殘留 timer（切走再切回來會一直疊加）。
    if (stopped) return;
    timer = setInterval(() => {
      if (paused || stopped) return;
      if (!ready()) return;
      try {
        notifySize();
        onQuality(analyzeFrame(currentSource(), scratchCanvas, qualityOptions() || {}));
      } catch (err) {
        console.warn("[camera] 品質檢查失敗", err);
      }
    }, intervalMs);
  }

  async function startLive() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        // 明確要 4:3：整套輪廓的 hFOV 是照 4:3 算的。拿 16:9 來用的話，
        // 顯示端不裁切就得上下留黑（可接受），裁切就等效焦距 +33%（不可接受）。
        aspectRatio: { ideal: 4 / 3 },
        width: { ideal: 1440 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    settings = stream.getVideoTracks()[0]?.getSettings?.() || null;
    video.srcObject = stream;
    await video.play();
    setMode("live", { settings });
  }

  function paintMock() {
    return loadCornerAsset(mockLabelCornerId).then((img) => {
      if (img) drawAssetFrame(mockCanvas, img, mockLabel, mockSize);
      else {
        drawMockFrame(mockCanvas, {
          label: mockLabel,
          width: mockSize.width,
          height: mockSize.height,
          guideBox: mockGuideBox,
        });
      }
      return img;
    });
  }

  async function startMock(reason) {
    await paintMock();
    setMode("mock", { reason });
  }

  /**
   * 啟動相機。永不 throw —— 失敗會自動降級成 mock。
   * @returns {Promise<{mode: string, reason?: string, error?: Error}>}
   */
  async function start() {
    stopped = false;
    lastSize = { width: 0, height: 0 };
    bindVideo();
    if (config.mock || !config.cameraApiAvailable) {
      const reason = config.mock ? "url-flag" : "no-api";
      await startMock(reason);
      startQualityLoop();
      return { mode: "mock", reason };
    }
    try {
      await startLive();
      startQualityLoop();
      return { mode: "live" };
    } catch (err) {
      console.info("[camera] 無法啟用實體相機，改用模擬相機：", err.message);
      await startMock("getusermedia-failed");
      startQualityLoop();
      return { mode: "mock", reason: "getusermedia-failed", error: err };
    }
  }

  /** 停止一切：關掉 track、清掉 interval、解除 srcObject。 */
  function stop() {
    stopped = true;
    clearInterval(timer);
    timer = null;
    unbindVideo();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (video) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
    }
    settings = null;
    lastSize = { width: 0, height: 0 };
    mode = "idle";
  }

  /**
   * 設定目前拍的是哪一角（mock 模式會據此換素材 / 換標籤）。
   * @param {string|null} cornerId lf|rf|lr|rr
   * @param {string} label 顯示文字
   * @param {{guideBox?: {x:number,y:number,w:number,h:number}}} [options]
   *   guideBox = 引導輪廓的正規化位置，只有 mock 佔位圖會用到（見 drawMockFrame）
   */
  async function setCorner(cornerId, label = "", options = {}) {
    mockLabelCornerId = cornerId;
    mockLabel = label;
    if (options.guideBox !== undefined) mockGuideBox = options.guideBox;
    if (mode === "mock") await paintMock();
  }

  /** 暫停 / 恢復品質檢查（例如進入預覽畫面時）。 */
  function pauseQuality() {
    paused = true;
  }
  function resumeQuality() {
    paused = false;
  }

  /**
   * 拍一張。
   * @returns {Promise<{dataUrl: string, blob: Blob|null, width: number, height: number, quality: object, mode: string}>}
   */
  function capture() {
    const source = currentSource();
    const { width, height } = sourceSize(source);
    const canvas = document.createElement("canvas");
    // 存的是**整張串流**，跟預覽（contain）看到的一模一樣。
    // 之前預覽用 cover、存檔用全幅，兩者根本不是同一張圖。
    canvas.width = width || mockSize.width;
    canvas.height = height || mockSize.height;
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const quality = analyzeFrame(source, scratchCanvas, qualityOptions() || {});
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) =>
          resolve({ dataUrl, blob, width: canvas.width, height: canvas.height, quality, mode }),
        "image/jpeg",
        0.85
      );
    });
  }

  return {
    start,
    stop,
    capture,
    setCorner,
    pauseQuality,
    resumeQuality,
    get mode() {
      return mode;
    },
    get isMock() {
      return mode === "mock";
    },
    get source() {
      return currentSource();
    },
    /** track.getSettings()（可能為 null）—— 對帳用，計算一律以 streamSize 為準 */
    get settings() {
      return settings;
    },
    /** 串流實際像素尺寸 { width, height, aspect, source } */
    get streamSize() {
      return streamSize();
    },
  };
}
