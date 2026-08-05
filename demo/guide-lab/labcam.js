/**
 * guide-lab / labcam.js —— 精簡版相機控制器
 *
 * 刻意不 import demo/src/camera.js：那支綁著 config.js / quality.js / util.js，
 * 而且 mock 畫布寫死 1080×1440 直向，跟本頁的橫向 4:3 需求相反。
 * 這裡只保留同一份契約中真正需要的部分：
 *
 *   ?mock=1              → 直接進 mock，不碰 getUserMedia
 *   瀏覽器沒有相機 API   → 自動降級 mock
 *   getUserMedia 失敗/拒絕 → 自動降級 mock（永不 throw）
 *
 * 這條降級路徑是硬需求：使用者在室內（或 http:// 非 localhost）開不起相機時，
 * 整頁還是要能點完，不然就卡死在空畫面。
 */

const MOCK_W = 1024;
const MOCK_H = 768; // 橫向 4:3

export const cameraApiAvailable =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export const secureOk =
  typeof window !== "undefined" &&
  (window.isSecureContext || ["localhost", "127.0.0.1", "::1"].includes(location.hostname));

/** 畫一張明顯是佔位用的橫向 4:3 底圖，順便把降級原因寫在上面 */
export function drawMock(canvas, { reason = "", corner = "" } = {}) {
  canvas.width = MOCK_W;
  canvas.height = MOCK_H;
  const g = canvas.getContext("2d");
  const bg = g.createLinearGradient(0, 0, MOCK_W, MOCK_H);
  bg.addColorStop(0, "#2b3440");
  bg.addColorStop(1, "#39434f");
  g.fillStyle = bg;
  g.fillRect(0, 0, MOCK_W, MOCK_H);

  g.strokeStyle = "rgba(255,255,255,0.06)";
  g.lineWidth = 2;
  for (let x = 0; x <= MOCK_W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, MOCK_H); g.stroke(); }
  for (let y = 0; y <= MOCK_H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(MOCK_W, y); g.stroke(); }

  // 一半亮一半暗 —— 白線 halo 在亮地面上會不會消失，看這裡就知道
  g.fillStyle = "rgba(236,240,245,0.82)";
  g.fillRect(MOCK_W / 2, 0, MOCK_W / 2, MOCK_H);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.font = "600 22px -apple-system, 'Noto Sans TC', sans-serif";
  g.textAlign = "center";
  g.fillText("暗底", MOCK_W * 0.25, MOCK_H - 28);
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.fillText("亮底（測白線可讀性）", MOCK_W * 0.75, MOCK_H - 28);

  g.textAlign = "center";
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "700 44px -apple-system, 'Noto Sans TC', sans-serif";
  g.fillText("模擬相機", MOCK_W * 0.25, MOCK_H / 2 - 10);
  g.font = "400 20px -apple-system, 'Noto Sans TC', sans-serif";
  g.fillStyle = "rgba(255,255,255,0.6)";
  g.fillText(reason || "MOCK", MOCK_W * 0.25, MOCK_H / 2 + 26);
  if (corner) g.fillText(corner, MOCK_W * 0.25, MOCK_H / 2 + 54);
  return canvas;
}

const REASONS = {
  "url-flag": "?mock=1",
  "no-api": "此瀏覽器沒有相機 API",
  insecure: "非 HTTPS / localhost，瀏覽器不給相機",
  denied: "相機權限被拒絕",
  failed: "相機啟動失敗",
};

/**
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} mockCanvas
 * @param {(mode:'live'|'mock', info:object)=>void} onMode
 */
export function createLabCamera(video, mockCanvas, onMode = () => {}) {
  let stream = null;
  let mode = "idle";
  let stopped = false;

  function apply(next, info) {
    mode = next;
    video.hidden = next !== "live";
    mockCanvas.hidden = next === "live";
    onMode(next, info);
  }

  function toMock(reason, err) {
    drawMock(mockCanvas, { reason: REASONS[reason] || reason });
    apply("mock", { reason, reasonText: REASONS[reason] || reason, error: err });
    return { mode: "mock", reason };
  }

  /** 永不 throw —— 任何失敗都降級成 mock */
  async function start({ mock = false } = {}) {
    stopped = false;
    if (mock) return toMock("url-flag");
    if (!cameraApiAvailable) return toMock("no-api");
    if (!secureOk) return toMock("insecure");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // 明確要 4:3：疊圖的 hFOV 是照 4:3 算的，拿 16:9 來 cover 會裁掉左右視野
          aspectRatio: { ideal: 4 / 3 },
          width: { ideal: 1440 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return { mode: "idle" }; }
      video.srcObject = stream;
      await video.play();
      const s = stream.getVideoTracks()[0]?.getSettings?.() || {};
      apply("live", { settings: s });
      return { mode: "live", settings: s };
    } catch (err) {
      const reason = err && /NotAllowed|Permission/i.test(err.name + err.message) ? "denied" : "failed";
      console.info("[guide-lab] 相機無法啟用，降級為模擬：", err?.message);
      return toMock(reason, err);
    }
  }

  function stop() {
    stopped = true;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    try { video.pause(); } catch { /* ignore */ }
    video.srcObject = null;
    mode = "idle";
  }

  return { start, stop, get mode() { return mode; } };
}
