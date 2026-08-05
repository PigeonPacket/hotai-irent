/**
 * 集中解析 URL query params。
 *
 * 規則：其他模組**只**從這裡讀設定，不要自己 parse location.search。
 *
 * 支援參數
 *   ?mock=1                    模擬相機模式（相機不可用 / 被拒時也會自動進入）
 *   ?speed=fast                時間壓縮：1 real second = 1 demo minute
 *   ?scenario=clean|suspect|damage   強制模擬 AI 比對分支
 *   ?nav=1                     顯示簡報跳頁列
 *   ?reset=1                   開機時清空 localStorage session
 */

const params = new URLSearchParams(location.search);

const truthy = (v) => v === "" || v === "1" || v === "true" || v === "yes" || v === "on";
const flag = (name) => (params.has(name) ? truthy(params.get(name)) : false);

export const SCENARIOS = Object.freeze(["clean", "suspect", "damage"]);

const cameraApiAvailable = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const speed = params.get("speed") === "fast" ? "fast" : "normal";
const scenarioRaw = params.get("scenario");

/**
 * 1 個「demo 分鐘」等於多少真實毫秒。
 * normal: 60000（真的一分鐘）｜fast: 1000（1 秒 = 1 分鐘）
 */
const DEMO_MINUTE_MS = speed === "fast" ? 1000 : 60_000;

export const config = Object.freeze({
  /** 是否強制模擬相機（相機 API 不存在時預設 true） */
  mock: params.has("mock") ? truthy(params.get("mock")) : !cameraApiAvailable,
  /** 瀏覽器是否有 getUserMedia（getUserMedia 執行時失敗由 camera.js 自行降級） */
  cameraApiAvailable,
  /** "normal" | "fast" */
  speed,
  /** 1 demo 分鐘 = 幾毫秒 */
  demoMinuteMs: DEMO_MINUTE_MS,
  /** "clean" | "suspect" | "damage" | null（null = 由畫面自行決定） */
  scenario: SCENARIOS.includes(scenarioRaw) ? scenarioRaw : null,
  /** 顯示簡報跳頁列 */
  nav: flag("nav"),
  /** 開機清空 session */
  reset: flag("reset"),
});

/**
 * demo 分鐘 → 真實毫秒。所有倒數 / 逾時判斷都用這個，
 * ?speed=fast 才只需要在一處實作。
 * @example const deadline = Date.now() + demoMinutesToMs(15);
 */
export function demoMinutesToMs(minutes) {
  return minutes * config.demoMinuteMs;
}

/**
 * 真實毫秒 → demo 分鐘（顯示「剩 14 分鐘」時用，這樣 fast 模式標籤也正確）。
 */
export function msToDemoMinutes(ms) {
  return ms / config.demoMinuteMs;
}

/**
 * 真實毫秒 → 以 demo 時鐘表示的 M:SS 字串。
 * fast 模式下 1 真實秒 = 1 demo 分鐘，所以會看到分鐘數快速跳動。
 */
export function formatDemoCountdown(ms) {
  const totalDemoSeconds = Math.max(0, Math.round(msToDemoMinutes(ms) * 60));
  const m = Math.floor(totalDemoSeconds / 60);
  const s = totalDemoSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
