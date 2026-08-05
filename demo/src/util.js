/**
 * 共用小工具（無依賴、無副作用）。
 *
 * Wave 2 規則：這個檔案對 Wave 2 是「唯讀」。
 * 需要新 helper 時請定義在你自己的畫面模組裡，不要改這裡 —— 避免平行開發衝突。
 */

/** 產生短 id（demo 用，不需要密碼學強度）。 */
let seq = 0;
export function uid(prefix = "id") {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** HTML 轉義。畫面模組用 innerHTML 組字串時，任何來自 state 的文字都要過這個。 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

/**
 * 把 dataURL 降階成縮圖。
 * state.js 存 localStorage 前一定會呼叫這個（長邊 640px / JPEG 0.6），
 * 否則 10 張以上全解析度 dataURL 會撞爆 ~5MB 配額。
 * @returns {Promise<string|null>} 失敗時回傳 null（呼叫端要能容忍沒有縮圖）
 */
export function downscaleDataUrl(dataUrl, options = {}) {
  const { maxEdge = 640, quality = 0.6, type = "image/jpeg" } = options;
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL(type, quality));
      } catch (err) {
        console.warn("[util] downscaleDataUrl 失敗", err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * 檢查一個相對資源是否存在，不會在 console 留下 404 紅字
 * （用 fetch 而非 <img>/<script>：404 只是一個 response，不是 network error）。
 * 用途：app.js 探測「尚未實作的畫面模組」、camera.js 探測 assets/car-*.jpg。
 * @returns {Promise<boolean>}
 */
const existsCache = new Map();
export function resourceExists(url) {
  const key = String(url);
  if (!existsCache.has(key)) {
    existsCache.set(
      key,
      fetch(key, { method: "HEAD", cache: "no-store" })
        .then((res) => res.ok)
        .catch(() => false)
    );
  }
  return existsCache.get(key);
}

/** ISO 時間 → HH:MM（timeline / 事證包用）。 */
export function formatTime(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 毫秒 → M:SS（倒數用；負數 clamp 成 0:00）。 */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 建立元素的極簡 helper（可選用，畫面模組也可以直接用 innerHTML）。 */
export function el(tag, attrs = {}, html = "") {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  if (html) node.innerHTML = html;
  return node;
}
