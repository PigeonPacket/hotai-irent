# iRent 車況拍照引導｜可點擊原型

和泰 iRent 黑客松 · PigeonPacket（PIG-5），對應 [PIG-13 UX Flow](../docs/PIG-13-UX-Flow.md)。

**不接後端、全部模擬資料**，目標是簡報時一鏡到底走完：
取車引導拍照 → 補拍窗口 → 使用中回報 → 還車拍照 → 模擬 AI 前後比對 → 爭議事證包 → 積分結算（另有營運視角）。

## 啟動

```bash
cd demo
python3 -m http.server 8080
```

開 <http://localhost:8080/>。vanilla JS + ES modules，**零依賴、零 build step**
（用 `file://` 開不行，ES modules 需要 `http://`；相機需要 localhost 或 HTTPS）。

手機與電腦同一網段時，用手機瀏覽器開 `http://<你的IP>:8080`（相機需 HTTPS，用 `?mock=1` 可繞過）。

## URL 參數

| 參數 | 用途 |
|------|------|
| `?mock=1` | 模擬相機（沒有相機或拒絕授權時也會自動啟用），筆電上可完整點完 |
| `?nav=1` | 顯示簡報跳頁列，可跳過任一段 + 一鍵重置 |
| `?speed=fast` | 時間壓縮：1 真實秒 = 1 demo 分鐘（補拍倒數用） |
| `?scenario=clean\|suspect\|damage` | 強制模擬 AI 比對分支 |
| `?reset=1` | 開機清空存檔 |

簡報常用：<http://localhost:8080/?mock=1&nav=1&speed=fast>

## 目前狀態（Wave 1 骨架）

| 畫面 | 路由 | 狀態 |
|------|------|------|
| 四角引導拍照（取車 / 還車共用） | `#/capture?phase=pickup\|return` | ✅ |
| 取車前車況預告 / 補拍窗口 / 使用中回報 / AI 比對 / 爭議事證包 / 積分結算 / 營運視角 | `#/vehicle` `#/supplement` `#/inuse` `#/compare` `#/dispute` `#/settlement` `#/ops` | Wave 2 |

## 結構

```
index.html   app shell（header / #screen / footer）
app.js       入口：載入畫面模組 + 開機
styles.css   設計 token + 共用元件 kit（畫面專屬 CSS 跟著模組走）
src/
  config.js  URL 參數 + 時間壓縮 helper
  state.js   session 狀態 + localStorage（照片自動降階成縮圖）
  router.js  hash 路由 + 畫面生命週期 + 跳頁列
  camera.js  相機 / 模擬相機
  quality.js 亮度・過曝・模糊啟發式
  guides.js  四角定義 + 虛線輪廓（暫時版本，待 Track G 取代）
  points.js  積分規則（對齊 PIG-13 §5）
  screens/   一個檔案一個畫面
  CONTRACT.md ← 要加畫面的人先讀這個
assets/      模擬素材（car-<角度>.jpg 會自動被模擬相機採用）
```

**要加新畫面 / 修改共用模組前，請先讀 [`src/CONTRACT.md`](src/CONTRACT.md)。**
