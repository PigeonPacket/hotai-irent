/**
 * Hash 路由 + 畫面模組生命週期 + 畫面 CSS 注入 + 簡報跳頁列。
 *
 * ── 畫面模組契約（Wave 2 全靠這個，請照抄）─────────────────────────
 *
 *   // src/screens/foo.js
 *   export const id = 'foo';                  // 路由 = #/foo，全域唯一
 *   export const title = '標題';               // 預設 header 標題 + 跳頁列文字
 *   export const subtitle = '副標';            // 可選
 *   export const css = `.foo { ... }`;         // 這個畫面的 CSS，router 只注入一次
 *   export const nav = [                       // 可選：跳頁列項目（可多筆）
 *     { label: '取車拍照', params: { phase: 'pickup' }, order: 20 },
 *   ];
 *   export function mount(root, ctx) {          // 可 async
 *     root.innerHTML = `...`;
 *     const timer = setInterval(tick, 1000);
 *     return () => clearInterval(timer);       // cleanup（可選）
 *   }
 *
 * cleanup 語意：router 切到別的畫面前**一定**會呼叫上一個畫面回傳的函式。
 * 任何 setInterval / setTimeout / requestAnimationFrame / MediaStream /
 * addEventListener(document|window) 都必須在 cleanup 裡收乾淨。
 * 掛在 root 底下的 listener 不用管（root 會被整個換掉）。
 * ──────────────────────────────────────────────────────────────────
 */

import { config } from "./config.js";
import { escapeHtml } from "./util.js";

/** @type {Map<string, object>} */
const screens = new Map();
const registrationOrder = [];

let rootEl = null;
let navEl = null;
let headerEls = null;
let footnoteEl = null;
let baseCtx = {};
let current = null; // { screen, cleanup }
let navToken = 0;
let started = false;
let defaultFootnote = "";

// ------------------------------------------------------------------ 註冊

/**
 * 註冊一個畫面模組。重複 id 會被忽略（先註冊的贏）。
 * @param {{id: string, title?: string, css?: string, mount: Function}} screen
 */
export function register(screen) {
  if (!screen || typeof screen.mount !== "function" || !screen.id) {
    console.error("[router] 畫面模組必須 export { id, mount }", screen);
    return false;
  }
  if (screens.has(screen.id)) {
    console.warn(`[router] 畫面 id 重複，忽略：${screen.id}`);
    return false;
  }
  screens.set(screen.id, screen);
  registrationOrder.push(screen.id);
  if (started) renderNav();
  return true;
}

export function isRegistered(id) {
  return screens.has(id);
}

export function listScreens() {
  return registrationOrder.map((id) => screens.get(id));
}

// ------------------------------------------------------------------ hash

function buildHash(id, params) {
  const qs = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v != null && v !== "")
  ).toString();
  return `#/${id}${qs ? `?${qs}` : ""}`;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return { id: null, params: {} };
  const [path, query = ""] = raw.split("?");
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { id: decodeURIComponent(path), params };
}

/** 導航到某個畫面。`replace` 為 true 時不留歷史紀錄。 */
export function go(id, params, options = {}) {
  const hash = buildHash(id, params);
  if (location.hash === hash) {
    render();
    return;
  }
  if (options.replace) {
    history.replaceState(null, "", hash);
    render();
  } else {
    location.hash = hash;
  }
}

// ------------------------------------------------------------------ header

/**
 * 設定 app shell 的 header。畫面模組透過 ctx.setHeader 呼叫。
 * 傳 undefined 的欄位不動，傳 "" 會清空該行。
 */
export function setHeader({ eyebrow, title, subtitle } = {}) {
  if (!headerEls) return;
  if (eyebrow !== undefined) {
    headerEls.eyebrow.textContent = eyebrow;
    headerEls.eyebrow.hidden = !eyebrow;
  }
  if (title !== undefined) {
    headerEls.title.textContent = title;
    document.title = title ? `${title} · iRent Demo` : "iRent Demo";
  }
  if (subtitle !== undefined) {
    headerEls.subtitle.textContent = subtitle;
    headerEls.subtitle.hidden = !subtitle;
  }
}

/** 設定頁尾小字（傳 null 還原成預設文案）。 */
export function setFootnote(text) {
  if (!footnoteEl) return;
  const value = text == null ? defaultFootnote : text;
  footnoteEl.textContent = value;
  footnoteEl.hidden = !value;
}

// ------------------------------------------------------------------ CSS 注入

/**
 * 注入畫面模組的 CSS，同一個 id 只注入一次。
 * 這樣平行開發的 subagent 不必共寫 styles.css → 不會有 merge 衝突。
 */
function injectCss(screen) {
  if (!screen.css) return;
  const key = `screen-${screen.id}`;
  if (document.querySelector(`style[data-screen="${key}"]`)) return;
  const style = document.createElement("style");
  style.dataset.screen = key;
  style.textContent = screen.css;
  document.head.appendChild(style);
}

// ------------------------------------------------------------------ 跳頁列

function navEntries() {
  const entries = [];
  registrationOrder.forEach((id, index) => {
    const screen = screens.get(id);
    const declared = Array.isArray(screen.nav) ? screen.nav : null;
    if (declared) {
      declared.forEach((entry, i) => {
        entries.push({
          id,
          label: entry.label || screen.title || id,
          params: entry.params || {},
          order: entry.order ?? index * 10 + i,
        });
      });
    } else {
      entries.push({
        id,
        label: screen.title || id,
        params: {},
        order: screen.order ?? index * 10,
      });
    }
  });
  return entries.sort((a, b) => a.order - b.order);
}

/** 流程起點 = order 最小的跳頁項目（不需要在 app.js 寫死 home）。 */
function homeEntry() {
  return navEntries()[0] || null;
}

function renderNav() {
  if (!navEl) return;
  if (!config.nav) {
    navEl.hidden = true;
    document.body.classList.remove("has-demo-nav");
    return;
  }
  navEl.hidden = false;
  document.body.classList.add("has-demo-nav");
  const { id: currentId, params } = parseHash();
  const entries = navEntries();
  navEl.innerHTML = `
    <span class="demo-nav-label">跳頁</span>
    <div class="demo-nav-items">
      ${entries
        .map((entry, i) => {
          const active =
            entry.id === currentId &&
            Object.entries(entry.params).every(([k, v]) => params[k] === v);
          return `<button type="button" class="demo-nav-btn${active ? " active" : ""}"
            data-hash="${escapeHtml(buildHash(entry.id, entry.params))}">
            <span class="demo-nav-num">${i + 1}</span>${escapeHtml(entry.label)}</button>`;
        })
        .join("")}
    </div>
    <button type="button" class="demo-nav-btn reset" data-action="reset">重置</button>
  `;
}

function onNavClick(event) {
  const btn = event.target.closest("[data-hash], [data-action]");
  if (!btn) return;
  if (btn.dataset.action === "reset") {
    baseCtx.state?.reset();
    const home = homeEntry();
    if (home) go(home.id, home.params, { replace: true });
    else render();
    return;
  }
  location.hash = btn.dataset.hash;
}

// ------------------------------------------------------------------ render

async function render() {
  const token = ++navToken;
  const { id, params } = parseHash();

  if (!id) {
    const home = homeEntry();
    if (home) {
      go(home.id, home.params, { replace: true });
      return;
    }
  }

  // 收掉上一個畫面
  if (current?.cleanup) {
    try {
      current.cleanup();
    } catch (err) {
      console.error(`[router] 畫面 ${current.screen.id} cleanup 失敗`, err);
    }
  }
  current = null;
  rootEl.replaceChildren();

  const screen = screens.get(id);
  if (!screen) {
    rootEl.innerHTML = `
      <div class="card">
        <h2 class="section-title">畫面尚未實作</h2>
        <p class="muted">路由 <code>#/${escapeHtml(id || "")}</code> 還沒有對應的模組。
        已註冊：${listScreens().map((s) => escapeHtml(s.id)).join("、") || "（無）"}</p>
      </div>`;
    setHeader({ eyebrow: "Demo", title: "尚未實作", subtitle: "" });
    renderNav();
    return;
  }

  injectCss(screen);
  setHeader({
    eyebrow: screen.eyebrow ?? "PigeonPacket · 和泰 iRent 黑客松",
    title: screen.title || screen.id,
    subtitle: screen.subtitle ?? "",
  });
  setFootnote(null);
  renderNav();

  const ctx = { ...baseCtx, params, screen, go, setHeader, setFootnote, router: api };

  let cleanup;
  try {
    cleanup = await screen.mount(rootEl, ctx);
  } catch (err) {
    console.error(`[router] 畫面 ${screen.id} mount 失敗`, err);
    rootEl.innerHTML = `<div class="notice danger">畫面載入失敗：${escapeHtml(err.message)}</div>`;
    return;
  }

  // mount 期間若已經又導航過去了，立刻收掉這次的資源
  if (token !== navToken) {
    if (typeof cleanup === "function") {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
    }
    return;
  }
  current = { screen, cleanup: typeof cleanup === "function" ? cleanup : null };
}

// ------------------------------------------------------------------ 啟動

/**
 * 啟動 router。
 * @param {{root: HTMLElement, nav?: HTMLElement, header?: object,
 *          footnote?: HTMLElement, ctx?: object}} options
 *   ctx = 要提供給所有畫面的共用能力（state / config / points …）
 */
export function start(options) {
  rootEl = options.root;
  navEl = options.nav || null;
  headerEls = options.header || null;
  footnoteEl = options.footnote || null;
  defaultFootnote = footnoteEl?.textContent?.trim() || "";
  baseCtx = options.ctx || {};
  started = true;

  window.addEventListener("hashchange", render);
  if (navEl) navEl.addEventListener("click", onNavClick);
  renderNav();
  render();
}

const api = { register, go, isRegistered, listScreens, setHeader, setFootnote, start };
export default api;
