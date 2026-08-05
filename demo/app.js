/**
 * 入口 —— 註冊畫面 + 開機。
 *
 * ⚠️ Wave 2 請勿修改本檔案。
 * 下面 SCREEN_MODULES 已經把整條劇本的畫面檔名都宣告好了；
 * 「檔案還不存在」會被安靜略過（用 fetch HEAD 探測，不會在 console 留 404）。
 * 也就是說：**你只要建立自己的 src/screens/<name>.js，什麼都不用改就會自動上線。**
 * 這是刻意的設計 —— 四個 subagent 平行開發時沒有任何共寫檔案。
 */

import { config } from "./src/config.js";
import { state } from "./src/state.js";
import * as points from "./src/points.js";
import * as guides from "./src/guides.js";
import router from "./src/router.js";
import { resourceExists } from "./src/util.js";
import { EVENTS } from "./src/state.js";

/**
 * 劇本順序（= 載入順序）。跳頁列順序由各畫面 nav[].order 決定，見 src/CONTRACT.md。
 * 「（未實作）」的檔案建立後會自動被載入。
 */
const SCREEN_MODULES = [
  "./src/screens/vehicle.js", // Wave 2 · Track A — Screen 0 取車前 AI 車況預告
  "./src/screens/capture.js", // Wave 1 ✅ — Screen 1 / 4 四角引導拍照（pickup / return）
  "./src/screens/supplement.js", // Wave 2 · Track B — Screen 2 開鎖後補拍窗口
  "./src/screens/inuse.js", // Wave 2 · Track B — Screen 3 使用中回報
  "./src/screens/compare.js", // Wave 2 · Track C — Screen 5 模擬 AI 前後比對
  "./src/screens/dispute.js", // Wave 2 · Track D — Screen 6 爭議 / 事證包
  "./src/screens/settlement.js", // Wave 2 · Track D — 積分結算
  "./src/screens/ops.js", // Wave 2 · Track A — 營運視角車輛狀態
];

async function loadScreens() {
  const missing = [];
  for (const path of SCREEN_MODULES) {
    const url = new URL(path, import.meta.url);
    if (!(await resourceExists(url))) {
      missing.push(path);
      continue;
    }
    try {
      const mod = await import(path);
      router.register(mod.default ?? mod);
    } catch (err) {
      console.error(`[app] 載入畫面模組失敗：${path}`, err);
    }
  }
  if (missing.length) {
    console.info(`[app] 尚未實作的畫面（${missing.length}）：`, missing.join(", "));
  }
}

async function boot() {
  if (config.reset) state.reset();
  else state.load();

  if (state.session.timeline.length === 0) {
    state.addEvent(EVENTS.SESSION_START, {
      label: `開始 demo · ${state.session.vehicle.plate} ${state.session.vehicle.model}`,
    });
  }

  await loadScreens();

  router.start({
    root: document.getElementById("screen"),
    nav: document.getElementById("demo-nav"),
    footnote: document.getElementById("app-footnote"),
    header: {
      eyebrow: document.getElementById("app-eyebrow"),
      title: document.getElementById("app-title"),
      subtitle: document.getElementById("app-subtitle"),
    },
    /** 所有畫面共用的 ctx（畫面模組不必自己 import 這些） */
    ctx: { state, config, points, guides },
  });

  // 方便簡報時在 console 檢查／操作
  window.__demo = { state, config, points, guides, router };
  console.info(
    `[app] PigeonPacket iRent demo · mock=${config.mock} speed=${config.speed} nav=${config.nav} scenario=${config.scenario ?? "auto"}`
  );
}

boot();
