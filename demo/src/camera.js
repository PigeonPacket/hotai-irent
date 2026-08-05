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
 * 資源釋放
 *   stop() 會關掉 MediaStream track 與品質檢查 interval。
 *   畫面模組必須在 cleanup 裡呼叫 stop()。
 */

import { config } from "./config.js";
import { analyzeFrame, sourceSize } from "./quality.js";
import { resourceExists } from "./util.js";

export const MOCK_ASSET_DIR = "assets";
export const MOCK_ASSET_PATTERN = "assets/car-<cornerId>.jpg";
const MOCK_W = 1080;
const MOCK_H = 1440;

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
 * 畫一張「明顯是佔位用」的模擬相機畫面。
 * 亮度/對比刻意調成能通過 quality.js 檢查（不會一直跳警告）。
 */
export function drawMockFrame(canvas, { label = "", note = "" } = {}) {
  canvas.width = MOCK_W;
  canvas.height = MOCK_H;
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, MOCK_W, MOCK_H);
  bg.addColorStop(0, "#3b4552");
  bg.addColorStop(1, "#2f3844");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, MOCK_W, MOCK_H);

  // 網格（強調這是佔位圖）
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= MOCK_W; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MOCK_H);
    ctx.stroke();
  }
  for (let y = 0; y <= MOCK_H; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MOCK_W, y);
    ctx.stroke();
  }

  // 假車體剪影（純示意，不是任何車款）
  ctx.save();
  ctx.translate(MOCK_W / 2, MOCK_H / 2 + 40);
  ctx.fillStyle = "#c2cbd6";
  ctx.beginPath();
  ctx.moveTo(-360, 60);
  ctx.lineTo(-300, -40);
  ctx.lineTo(-140, -80);
  ctx.lineTo(120, -90);
  ctx.lineTo(300, -30);
  ctx.lineTo(360, 50);
  ctx.lineTo(340, 140);
  ctx.lineTo(-340, 150);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#8d99a8";
  ctx.beginPath();
  ctx.moveTo(-250, -42);
  ctx.lineTo(-150, -74);
  ctx.lineTo(100, -80);
  ctx.lineTo(230, -34);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#20262e";
  [-215, 215].forEach((x) => {
    ctx.beginPath();
    ctx.arc(x, 150, 78, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  // 文字說明
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "700 92px -apple-system, 'Noto Sans TC', sans-serif";
  ctx.fillText("模擬相機", MOCK_W / 2, 300);
  ctx.font = "600 46px -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("MOCK CAMERA", MOCK_W / 2, 370);

  if (label) {
    ctx.font = "700 60px -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillStyle = "#00e0c2";
    ctx.fillText(label, MOCK_W / 2, MOCK_H - 260);
  }
  ctx.font = "400 34px -apple-system, 'Noto Sans TC', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(note || `放入 ${MOCK_ASSET_PATTERN} 可換成真實照片`, MOCK_W / 2, MOCK_H - 180);
  return canvas;
}

function drawAssetFrame(canvas, img, label) {
  canvas.width = MOCK_W;
  canvas.height = MOCK_H;
  const ctx = canvas.getContext("2d");
  const scale = Math.max(MOCK_W / img.width, MOCK_H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (MOCK_W - w) / 2, (MOCK_H - h) / 2, w, h);
  if (label) {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, MOCK_H - 150, MOCK_W, 150);
    ctx.fillStyle = "#fff";
    ctx.font = "600 46px -apple-system, 'Noto Sans TC', sans-serif";
    ctx.fillText(`模擬素材 · ${label}`, MOCK_W / 2, MOCK_H - 60);
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
 * @param {number} [opts.intervalMs=800] 品質檢查間隔
 */
export function createCamera(opts) {
  const {
    video,
    mockCanvas,
    scratchCanvas,
    onQuality = () => {},
    onMode = () => {},
    intervalMs = 800,
  } = opts;

  let stream = null;
  let timer = null;
  let paused = false;
  let mode = "idle"; // idle | live | mock
  let mockLabel = "";
  let mockLabelCornerId = null;
  let stopped = false;

  function setMode(next, info = {}) {
    mode = next;
    const isMock = next === "mock";
    if (video) video.hidden = isMock;
    if (mockCanvas) mockCanvas.hidden = !isMock;
    onMode(next, info);
  }

  function currentSource() {
    return mode === "mock" ? mockCanvas : video;
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
    timer = setInterval(() => {
      if (paused || stopped) return;
      if (!ready()) return;
      try {
        onQuality(analyzeFrame(currentSource(), scratchCanvas));
      } catch (err) {
        console.warn("[camera] 品質檢查失敗", err);
      }
    }, intervalMs);
  }

  async function startLive() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    video.srcObject = stream;
    await video.play();
    setMode("live");
  }

  async function startMock(reason) {
    const img = await loadCornerAsset(mockLabelCornerId);
    if (img) drawAssetFrame(mockCanvas, img, mockLabel);
    else drawMockFrame(mockCanvas, { label: mockLabel });
    setMode("mock", { reason });
  }

  /**
   * 啟動相機。永不 throw —— 失敗會自動降級成 mock。
   * @returns {Promise<{mode: string, reason?: string, error?: Error}>}
   */
  async function start() {
    stopped = false;
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
    mode = "idle";
  }

  /**
   * 設定目前拍的是哪一角（mock 模式會據此換素材 / 換標籤）。
   * @param {string|null} cornerId lf|rf|lr|rr
   * @param {string} label 顯示文字
   */
  async function setCorner(cornerId, label = "") {
    mockLabelCornerId = cornerId;
    mockLabel = label;
    if (mode === "mock") {
      const img = await loadCornerAsset(cornerId);
      if (img) drawAssetFrame(mockCanvas, img, label);
      else drawMockFrame(mockCanvas, { label });
    }
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
    canvas.width = width || MOCK_W;
    canvas.height = height || MOCK_H;
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    const quality = analyzeFrame(source, scratchCanvas);
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
  };
}
