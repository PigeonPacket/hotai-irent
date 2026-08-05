# demo/ 介面契約（Wave 1 產出 → Wave 2 依此開工）

> 這份文件是 **Wave 2 四個平行 subagent 的規格**。看完應該可以直接動工，不需要問人。
> 目標：`demo/` 是「不接後端、用模擬資料跑完整劇本」的可點擊原型，簡報時一鏡到底。

**硬性約束（不可違反）**

- vanilla JS、**零依賴、零 build step**。可以用 `<script type="module">` / ES modules，但不要引入框架、打包器、npm、CDN。
- 啟動方式永遠是 `cd demo && python3 -m http.server 8080`。
- 手機優先（`.app` 版面 max-width 430px）。
- 不要 fetch 外部網址。所有資料都是模擬資料。

---

## 1. 檔案分工表（**不要碰別人的檔案**）

| 檔案 | Owner | 其他人 |
|------|-------|--------|
| `index.html`, `app.js`, `styles.css` | Wave 1（凍結） | **唯讀。連 `app.js` 都不用改**（見 §2） |
| `src/config.js`, `src/state.js`, `src/router.js`, `src/util.js`, `src/camera.js` | Wave 1（凍結） | 唯讀 |
| `src/quality.js`, `src/guides.js` | Wave 3 / Track G | 唯讀 |
| `src/points.js` | 共用 | **只允許在 `POINT_RULES` 陣列尾端 append**，不要改既有規則 |
| `src/screens/capture.js` | Wave 1 | 唯讀 |
| `src/screens/vehicle.js`, `src/screens/ops.js` | **Track A** | 別人不要動 |
| `src/screens/supplement.js`, `src/screens/inuse.js` | **Track B** | 別人不要動 |
| `src/screens/compare.js` | **Track C** | 別人不要動 |
| `src/screens/dispute.js`, `src/screens/settlement.js` | **Track D** | 別人不要動 |
| `assets/*` | 誰都可以新增檔案 | 不要刪別人的 |

需要一個共用 helper 而 `util.js` 沒有？**寫在你自己的畫面模組裡**（重複一點程式碼比 merge 衝突便宜）。
真的需要改凍結檔案時，先在回報裡說明，不要默默改。

各 track 的畫面對應 `docs/PIG-13-UX-Flow.md`：

| 檔案 | 路由 | UX Flow | 重點 |
|------|------|---------|------|
| `vehicle.js` | `#/vehicle` | Screen 0 | 取車前 AI 車況預告：整潔度 / 油量 / 已知舊損 / 風險標籤 |
| `capture.js` | `#/capture?phase=pickup\|return` | Screen 1 / 4 | ✅ Wave 1 已完成 |
| `supplement.js` | `#/supplement` | Screen 2 | 開鎖後 15 分鐘補拍窗口 + 可見倒數 |
| `inuse.js` | `#/inuse` | Screen 3 | 使用中回報車況異常 |
| `compare.js` | `#/compare` | Screen 5 | 模擬 AI 前後比對（clean / suspect / damage）+ 誠實申報 |
| `dispute.js` | `#/dispute` | Screen 6 | 爭議 → 彙整事證包（渲染 timeline） |
| `settlement.js` | `#/settlement` | §5 | 積分結算 + 折抵金額 |
| `ops.js` | `#/ops` | §4 | 營運視角車輛狀態機 |

---

## 2. 畫面模組契約

一個畫面 = `src/screens/<id>.js` 一個檔案，用 **named exports**：

```js
// src/screens/supplement.js
export const id = 'supplement';              // 路由 = #/supplement，全域唯一
export const title = '補拍窗口';               // header 標題 + 跳頁列文字
export const subtitle = '15 分鐘內可補充存證';  // 可選
export const css = `.supplement-timer { ... }`; // 這個畫面的 CSS（見 §3）
export const nav = [                          // 可選；跳頁列項目，可多筆
  { label: '補拍窗口', params: {}, order: 30 },
];

export function mount(root, ctx) {            // 可以是 async
  root.innerHTML = `...`;
  const timer = setInterval(tick, 500);
  return () => clearInterval(timer);          // ← cleanup（可選但強烈建議）
}
```

### 自動註冊：你**不需要**改 `app.js`

`app.js` 的 `SCREEN_MODULES` 已經把上面 8 個檔名全部宣告好了。載入前會用
`fetch(HEAD)` 探測檔案是否存在，不存在就安靜略過（console 不會有 404 紅字）。
**建立檔案 = 自動上線**。這是為了讓四個 agent 平行開發時沒有任何共寫檔案。

檔名一定要照 §1 表格，不要自己另取。

### cleanup 語意

router 切換到別的畫面**之前一定**會呼叫上一個畫面回傳的 cleanup。必須在裡面收乾淨：

- `setInterval` / `setTimeout` / `requestAnimationFrame`
- `camera.stop()`（MediaStream + 品質檢查 interval）
- 掛在 `document` / `window` 上的 listener

掛在 `root` 底下元素上的 listener **不用管** —— router 會把 `root` 整個清空。

### `ctx` 提供什麼

| 欄位 | 說明 |
|------|------|
| `ctx.state` | `src/state.js` 的 state 物件（§4） |
| `ctx.config` | `src/config.js` 的唯讀 config（§6） |
| `ctx.points` | `src/points.js` 整個 module namespace（§7） |
| `ctx.guides` | `src/guides.js` namespace（`CORNERS` / `getGuide`） |
| `ctx.params` | 目前 hash 的 query params，例：`#/capture?phase=return` → `{ phase: 'return' }` |
| `ctx.go(id, params?)` | 導航，例：`ctx.go('capture', { phase: 'return' })` |
| `ctx.setHeader({eyebrow?, title?, subtitle?})` | 改 app shell header；只傳想改的欄位 |
| `ctx.setFootnote(text)` | 改頁尾小字；傳 `null` 還原預設 |
| `ctx.router.isRegistered(id)` | 判斷下一個畫面是否已實作（用來 graceful fallback） |
| `ctx.screen` | 目前畫面模組自己 |

**還沒實作的下一站要 graceful**：`if (ctx.router.isRegistered('dispute')) ctx.go('dispute'); else alert(...)`。
這樣任一 track 落後也不會擋住其他人的 demo。

---

## 3. CSS 隨模組走（重要）

- **不要改 `styles.css`。** 它只放設計 token 與共用元件 kit。
- 畫面專屬 CSS 放在該畫面的 `export const css`，router 用
  `<style data-screen="screen-<id>">` **只注入一次**（重複 mount 不會重複注入）。
- **理由**：四個 subagent 平行開發，如果大家都往 `styles.css` 追加樣式，
  必然互相覆蓋 / merge 衝突。CSS 跟著模組走 = 完全沒有共寫檔案。
- 因為所有 CSS 最終都在同一個 document，**請幫 class 加前綴**（`.compare-*`、`.ops-*`、
  `.dispute-*`…），避免撞名。共用 kit 的 class 直接用，不要重新定義。

`styles.css` 已提供（直接用，不要重定義）：

```
tokens: --bg --surface --surface-2 --line --text --muted --accent --accent-dim --warn --danger --radius
版面:  .app .screen .header .eyebrow .subtitle .app-footer .footnote .hidden
文字:  .section-title .muted
元件:  .card  .notice(.ok/.warn/.danger)  .badge(.ok/.warn/.danger)
       .btn(.primary/.secondary/.ghost/.danger/.full/.small)  .actions
       .progress/.progress-bar(--pct)/.steps(li.active/li.done)
       .thumbs/.thumb/.thumb-empty  .kv(dl/dt/dd)  .row(.between)  .stack  .empty
```

用到 `guides.getGuide()` 畫虛線輪廓的畫面，要把輪廓樣式併進自己的 css：

```js
import { GUIDE_CSS } from '../guides.js';
export const css = `${GUIDE_CSS}\n.supplement-x { ... }`;
```

---

## 4. `state`（`src/state.js`）

`ctx.state.session` 是唯一的 session 物件。**所有寫入都走 state 的方法**（方法內部會自動 `save()`），
不要自己 `localStorage.setItem`。

```js
session = {
  version, id, startedAt,
  vehicle: { id, plate, model, modelId, color, station, fuel, status },
  phase: 'pickup' | 'return',
  pickupCaptures: [ /* 照片 */ ],
  supplementCaptures: [ ],
  returnCaptures: [ ],
  reports: [ { id, at, type, note, photoIds[] } ],
  points: { awarded: [ { id, ruleId, points, label, stage, at, meta } ], total },
  timeline: [ { id, type, at, phase, label, detail } ],
  scenario: 'clean' | 'suspect' | 'damage' | null,   // ?scenario= 帶進來的，可能是 null
  flags: { },        // ← 你的自訂旗標放這裡（見下）
  storage: 'ok' | 'degraded',
}
```

### 照片資料結構（三個群組共用同一形狀）

```js
{
  id: 'ph_pickup_...',
  group: 'pickup' | 'supplement' | 'return',
  category: 'corner' | 'interior' | 'damage' | 'dashboard' | 'other',  // CAPTURE_CATEGORIES
  angle: 'lf' | 'rf' | 'lr' | 'rr' | null,   // 只有 category==='corner' 才有意義
  label: '左前 45°',
  at: '2026-08-04T...',      // ISO 時間戳
  skipped: false,            // 「先繼續」跳過的那一角
  quality: { ok, issues: string[], avg, codes, metrics } | null,  // 見 §8
  dataUrl: '<縮圖，長邊 ≤640px JPEG 0.6>',   // ← 會被持久化
  fullDataUrl: '<全解析度>',                  // ← 只在記憶體，重新整理後消失
  note: '', meta: { },
}
```

**顯示照片一律寫 `photo.fullDataUrl || photo.dataUrl`。**
為什麼分兩個：取車 4 + 補拍 n + 還車 4 > 10 張，全解析度 dataURL 必定撞爆 localStorage ~5MB 配額。
`state.save()` 存檔前會自動剝掉 `fullDataUrl`；配額還是不夠時會降級成「只存 metadata」並把
`session.storage` 設成 `'degraded'`，**不會 throw、不會讓 app 掛掉**。

### 方法

```js
state.load() / state.save() / state.reset()

state.setPhase('return')
state.patch({ ...fields })              // 淺層 merge + save
state.setFlag('unlockedAt', Date.now()) // 自訂旗標（見下）
state.getFlag('unlockedAt', fallback)

// 照片
await state.addCapture(group, { angle, category, label, skipped, quality, fullDataUrl, note, meta })
state.getCaptures(group)                // → 陣列（同一個參考，可直接讀）
state.findCapture(group, angle)
state.removeCapture(group, photoId)
state.clearCaptures(group)
state.allCaptures()                     // 三組攤平（事證包用）

// timeline
state.addEvent(EVENTS.SUPPLEMENT_CAPTURE, { label: '補拍：後座', photoId })

// 回報
state.addReport({ type: 'dirty', note: '後座有垃圾', photoIds: [id] })   // 內部會自動加 timeline

// 積分
state.awardPoints('supplement_complete', { anyMeta })
state.totalPoints()
state.pointsBreakdown()                 // [{ rule, entries, earned }]
```

`addCapture` 是 **async**（內部要做縮圖降階），記得 `await`。

### `flags` 的用途

不要為了加一個欄位去改 `emptySession()`（那是共寫檔案）。把自己的狀態放 `session.flags`：

| 建議 key | Owner | 用途 |
|---------|-------|------|
| `flags.unlockedAt` | Track B | 開鎖時間（ms epoch），補拍倒數的起點 |
| `flags.supplementClosed` | Track B | 補拍窗口已關閉 |
| `flags.compareResult` | Track C | 模擬 AI 比對結果物件 |
| `flags.confessed` | Track C | 使用者誠實申報 |
| `flags.disputeOpened` | Track D | 已進入爭議流程 |
| `flags.evidenceExportedAt` | Track D | 事證包產出時間 |
| `flags.vehicleStatus` | Track A | 營運狀態機的當前狀態 |

### timeline 事件格式

```js
{ id, type, at: ISO, phase: 'pickup'|'return', label: '顯示用文字', detail: { ...自訂 } }
```

`type` **請用 `state.js` 的 `EVENTS` 常數**（`dispute.js` / `settlement.js` 會依 type 分組）：

```
SESSION_START VEHICLE_PREVIEW
PICKUP_CAPTURE PICKUP_COMPLETE UNLOCK
SUPPLEMENT_OPEN SUPPLEMENT_CAPTURE SUPPLEMENT_COMPLETE SUPPLEMENT_EXPIRED
REPORT_CREATED
RETURN_CAPTURE RETURN_COMPLETE
AI_COMPARE DAMAGE_CONFIRMED DAMAGE_DISPUTED HONEST_REPORT
POINTS_AWARDED EVIDENCE_EXPORTED VEHICLE_STATUS
```

需要新 type 就在 `EVENTS` 加一個常數（append-only，這是允許的小改動）。

> ⚠️ 改動 `session` 結構的形狀（新增/刪除頂層欄位）請同時把 `SCHEMA_VERSION` +1，
> 舊的 localStorage 資料會被自動丟棄重建，不會噴錯。

---

## 5. 路由

- hash 驅動：`#/<id>?k=v`。`ctx.go('capture', { phase: 'return' })` → `#/capture?phase=return`。
- 沒有 hash 時，router 會自動跳到「跳頁列 order 最小」的畫面（= 劇本第一站），
  所以 Track A 的 `vehicle.js`（order 10）一上線就會變成首頁，不需要改 `app.js`。
- 跳頁列（`?nav=1`）的 order 槽位表，**請照這個填，避免撞號**：

| order | 畫面 |
|:-----:|------|
| 10 | `vehicle`（取車前預告） |
| 20 | `capture?phase=pickup` ✅ |
| 30 | `supplement` |
| 40 | `inuse` |
| 50 | `capture?phase=return` ✅ |
| 60 | `compare` |
| 70 | `dispute` |
| 80 | `settlement` |
| 90 | `ops`（營運視角） |

跳頁列還有一顆「重置」按鈕（清 localStorage + 回第一站），簡報前後可以用。

---

## 6. `config`（`src/config.js`）

**只從這裡讀 URL 參數，不要自己 parse `location.search`。**

| 參數 | 讀法 | 說明 |
|------|------|------|
| `?mock=1` | `config.mock` | 模擬相機。相機 API 不存在時預設 true |
| `?speed=fast` | `config.speed` | 時間壓縮：1 real second = 1 demo minute |
| `?scenario=clean\|suspect\|damage` | `config.scenario` | 強制 AI 分支；**沒帶就是 `null`**，Track C 要自己決定預設（`config.scenario ?? 'suspect'`） |
| `?nav=1` | `config.nav` | 簡報跳頁列 |
| `?reset=1` | `config.reset` | 開機清空 session |

### 時間壓縮 helper（補拍倒數一定要用）

```js
import { demoMinutesToMs, msToDemoMinutes, formatDemoCountdown } from '../config.js';

// 開鎖時：15 個「demo 分鐘」後截止
const deadline = Date.now() + demoMinutesToMs(15);

// 每 500ms 更新畫面
const remainMs = deadline - Date.now();
label.textContent = `剩 ${formatDemoCountdown(remainMs)}`;   // ← 顯示的是 demo 時鐘
if (remainMs <= 0) { /* 逾時 */ }
```

`?speed=fast` 時 `demoMinutesToMs(15)` = 15 秒，而 `formatDemoCountdown` 仍然顯示 `15:00 → 0:00`，
簡報時「15 分鐘窗口」15 秒就演完，畫面文案卻完全正確。**不要自己乘 60000。**

---

## 7. 積分（`src/points.js`）

規則集中成資料，畫面裡不要出現裸的 `+20`。

```js
export const POINT_RULES = [
  { id: 'pickup_complete',      points: 20, label: '…', stage: 'pickup',     exclusive: 'pickup' },
  { id: 'pickup_partial',       points:  5, label: '…', stage: 'pickup',     exclusive: 'pickup' },
  { id: 'supplement_complete',  points: 10, label: '…', stage: 'supplement', exclusive: 'supplement' },
  { id: 'return_complete',      points: 20, ... }, { id: 'return_partial', points: 5, ... },
  { id: 'honest_report',        points:  5, label: '…', stage: 'report', once: false },
];
```

- `exclusive`：同組只保留最後授予的一筆（`pickup_complete` 會自動取代 `pickup_partial`）。
- `once`（預設 true）：`false` 代表可重複授予（誠實申報每次都給）。
- **加新規則** = 在陣列尾端 append 一筆，然後 `state.awardPoints('your_id')`。不要改既有 id。
- 換算金額：`points.pointsToTwd(n)`。假設 **1 積分 = NT$0.5**（`POINT_TO_TWD`，PIG-13 §5 說比例待商業設計，
  要改只改一處）。畫面上請標「假設值」。
- 其他：`isCaptureSetQualified(captures, 4)`、`evaluateCaptureSet(stage, captures, 4)`、
  `estimateCaptureSetPoints(...)`、`maxAttainable()`。

> 與 Wave 1 之前 PoC 的差異：舊版是「每張照片各算分」（四角最高 80），本版依 §5 表格
> 以「整段」計分（取車最高 20，整輪最高 50 + 誠實申報）。settlement 畫面請以 `state.pointsBreakdown()` 為準。

---

## 8. 相機與品質檢查

### `src/camera.js`

```js
const camera = createCamera({
  video, mockCanvas, scratchCanvas,     // 三個 DOM 元素，你自己 render 出來
  onQuality: (result) => {...},         // 每 800ms 一次
  onMode: (mode) => {...},              // 'live' | 'mock'
});
const { mode } = await camera.start();  // 永不 throw，失敗自動降級 mock
await camera.setCorner('lf', '左前 45°');
const shot = await camera.capture();    // { dataUrl, blob, width, height, quality, mode }
camera.pauseQuality(); camera.resumeQuality();
camera.stop();                          // ← 一定要在 cleanup 呼叫
```

**模擬相機**：`?mock=1`、瀏覽器無相機 API、或 `getUserMedia` 失敗/被拒時自動啟用，
畫面來源換成 canvas 畫的佔位圖（標明「模擬相機」），整條劇本在筆電上仍可點完。

**換成真實車輛照片**：把檔案放到

```
demo/assets/car-lf.jpg   demo/assets/car-rf.jpg
demo/assets/car-lr.jpg   demo/assets/car-rr.jpg
demo/assets/car-default.jpg   ← 沒有對應角度時的通用底圖
```

檔名規則 = `assets/car-<cornerId>.jpg`（cornerId 見 `guides.js` 的 `CORNERS`）。
存在就會自動被載入當畫面來源，**不需要改程式碼**（偵測用 `fetch HEAD`，檔案不存在也不會噴 404）。

> `demo/assets/car-reference/` 是 **Track G 的研究素材**（真實四角照片 + .glb 模型，共上百 MB），
> 那是參考資料、**不是 demo 執行時要載入的檔案**，不要直接改名成 `car-lf.jpg`。
> 要啟用真實照片請「縮圖後另存」，例如：
> `sips -Z 1440 assets/car-reference/phone-lf-commons-white-C.jpg --out assets/car-lf.jpg`
> （四角各一張，每張建議 < 400KB）。沒有這些檔案時就是 canvas 佔位圖，流程完全不受影響。
其他模擬素材（比對用的損傷照等）也放 `demo/assets/`，自行命名，但請加前綴避免撞名。

### `src/quality.js`

`analyzeFrame(source, scratchCanvas)` → `{ ok, issues: string[], avg, codes, metrics }`。
`ok/issues/avg` 是對外契約（只能加欄位）。閾值在 `THRESHOLDS`、文案在 `ISSUE_MESSAGES`。

> Wave 1 沒有動演算法（只有亮度/過曝/variance 啟發式）。
> 清晰度改良與「輪廓占比 / 角度偏離」檢查是 **Wave 3 / Track G**。

### `src/guides.js`

```js
import { CORNERS, getGuide, GUIDE_CSS } from '../guides.js';
const { svg } = getGuide(state.session.vehicle.modelId, 'lf');  // svg = 可塞進 <g> 的 markup
```

`CORNERS`（四角 id / label / hint）是**正式契約**。
`getGuide()` 目前回傳的 path 只是粗略七點多邊形、**不是任何真實車款的 45° 輪廓**，
會被 Track G 用參數化透視建構的結果整批取代 —— 呼叫端不需要改。

---

## 9. 自我驗收清單（每個 track 都做）

```bash
cd demo && python3 -m http.server 8080
```

1. `http://localhost:8080/?mock=1&nav=1` 開得起來，**console 沒有錯誤**。
2. 你的畫面在跳頁列點得到，來回切換不會殘留 timer（cleanup 有效）。
3. `?speed=fast` 時倒數/延遲都變快，文案仍正確。
4. 連跑兩次完整流程沒有 `QuotaExceededError`（照片一定要走 `state.addCapture`）。
5. 窄視窗（375×667）版面不破，橫向不出現水平滾動。
6. 下一站畫面不存在時有 fallback，不會卡死。
