# Third-Party Notice — Monk (MonkVision) sight overlays & wireframes

本目錄下的 24 個 SVG **不是本專案的原創資產**，是從開源專案 MonkVision `monkjs` 取回的第三方素材。
散布本 repo 時必須連同 [`LICENSE`](./LICENSE) 一併保留。

---

## 1. 來源

| 項目 | 值 |
|---|---|
| 上游專案 | [monkvision/monkjs](https://github.com/monkvision/monkjs) |
| 套件 | `@monkvision/sights` |
| 版本 | **5.4.0**（`package.json` 的 `license` 欄位即宣告 `BSD-3-Clause-Clear`） |
| 取得日期 | **2026-08-04** |
| 上游路徑 | `packages/sights/research/data/<vehicle>/overlays/`<br>`packages/sights/research/data/<vehicle>/partSelectionWireframes/` |
| 授權全文取得處 | `https://raw.githubusercontent.com/monkvision/monkjs/main/packages/sights/LICENSE`<br>（與 `https://unpkg.com/@monkvision/sights@5.4.0/LICENSE` 逐位元組相同，已交叉比對） |

**完整性驗證**：本目錄的 SVG 已與上游 raw 檔案比對 SHA-256，內容未經修改（抽樣 5 檔全數 MATCH，涵蓋三個車身類別的 overlay 與 wireframe）。目錄結構為本專案重排，**檔案內容一個 byte 都沒動**。

> 註：`demo/assets/car-reference/` 是另一批素材（3D 模型與 Commons 照片）的來源清單，與本目錄無關。
> 該目錄**已於 2026-08-05 部分進版控**（僅 3DW 模型與 `shape/` 維持排除），其授權標示見
> `demo/assets/car-reference/ATTRIBUTION.md`。本 NOTICE 為自足文件，不依賴該目錄的任何檔案。

---

## 2. 授權與義務

授權：**BSD-3-Clause-Clear**（The Clear BSD License）
版權人：`Copyright (c) [2022] [Monk](http://monk.ai)` — 原文照抄自上游 LICENSE，含其原始的方括號寫法。

散布時我方的義務（見 `LICENSE` 全文）：

1. **保留版權聲明、條件列表與免責聲明** —— 即保留本目錄的 `LICENSE` 檔。本 repo 為 public，散布行為持續發生，此義務長期有效。
2. **不得**以版權人或貢獻者名義為衍生產品背書或促銷（未經事前書面同意）。
3. 軟體按「現狀」提供，無任何擔保。

BSD-3-Clause-Clear 屬寬鬆授權，**不具 copyleft 感染性** —— 使用這些 SVG 不會強制本專案其餘程式碼採用相同授權（這點與 `car-reference/` 那批 CC BY-SA 素材不同）。

---

## 3. 我們拿它來做什麼

作為 **iRent 拍照引導原型的車體輪廓疊圖基準**：在拍照畫面上疊一層半透明車體輪廓，引導使用者站到正確距離與角度再按快門，以取得可比對的驗車照片。

Monk 的這批資產是目前找得到、**授權乾淨且已經過真實產品驗證**的引導疊圖，適合當原型的幾何基準與視覺參考，省去自行從 3D 模型描邊的工作。

---

## 4. 目錄結構與車身類別對應

三個車身類別各取自 Monk 的一台基準車（`vehicles.json` 中的 make / model / 尺寸）：

| 本目錄 | Monk vehicle id | Make / Model | 上游 type | 車寬×車長×車高 (m) |
|---|---|---|---|---|
| `cuv/` | `fesc20` | Ford Escape SE 2020 | `cuv` | 2.15 × 4.60 × 1.67 |
| `sedan/` | `haccord` | Honda Accord Sedan Sport US spec 2018 | `sedan` | 2.14 × 4.88 × 1.44 |
| `hatchback/` | `ffocus18` | Ford Focus | `hatchback` | 1.98 × 4.42 × 1.46 |

每個類別下：

```
<class>/
├── overlays/     ← 4 個，來自上游 overlays/（拍照引導用的半透明車體疊圖）
└── wireframes/   ← 4 個，來自上游 partSelectionWireframes/（分區線框，可點選車件）
```

### overlays — sight id 與拍攝角度對應

上游檔名是不透明的 sight id，對應關係查自各車的 `<vehicle>.json`：

| 角度 (Monk label) | `cuv` (fesc20) | `sedan` (haccord) | `hatchback` (ffocus18) |
|---|---|---|---|
| `front-lateral-full-right` 右前 45° | `fesc20-0mJeXBDf` | `haccord-KvP-pm8L` | `ffocus18-seOy3jwd` |
| `rear-lateral-full-right` 右後 45° | `fesc20-EJ0tXYBW` | `haccord-zNA0vVT0` | `ffocus18-8WjvbtMD` |
| `rear-lateral-full-left` 左後 45° | `fesc20-T4dIGLgy` | `haccord-k6MiX2MR` | `ffocus18-IoqRrmlA` |
| `beauty-shot-left` 左側全景 | `fesc20-bD8CBhYZ` | `haccord-huAZfQJA` | `ffocus18-GgOSpLl6` |

> ⚠️ **這四張不是完整的四角。** 缺 `front-lateral-full-left`（左前 45°），第四張是 `beauty-shot-left`（左側全景，非 45° 角）。
> 若原型需要對稱的四角引導，可**水平鏡射右前那張**得到左前（車體左右對稱），或回上游取其餘 sight —— 每台車在上游都有 38–39 個 sight，本次只取了 4 個。

### wireframes

檔名已是可讀角度，四角齊全：`<vehicle>-front-left.svg`、`-front-right.svg`、`-rear-left.svg`、`-rear-right.svg`。

---

## 5. ⚠️ 專利：Clear 的意思是「明文不授予專利權」

**這一節是 PIG-11 技術選型的輸入，不要略過。**

BSD-3-Clause-Clear 與一般 BSD-3-Clause 的差別，就在名稱裡的 **"Clear"** —— 它在授權文字中**明文排除專利授權**：

> NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS LICENSE.

也就是說：**拿到的是著作權授權，不是專利授權。** 上游可能持有的任何專利，完全沒有隨這批 SVG 一起授權給我們，連默示授權（implied license）都被明文排除。這與 Apache-2.0 那種帶明示專利授權的條款是相反的取向。

風險落點：**「引導式車輛影像擷取」（guided vehicle image capture）** 這個領域本身有專利佈局 —— Solera 的 Qapter 產品線在此領域有 patent pending。而我們要做的正是這件事：疊輪廓、引導使用者站位、達標才允許拍攝。

實務結論：

- **黑客松／內部原型：無妨。** 著作權面已由 BSD-3-Clause-Clear 覆蓋，保留 `LICENSE` 即合規。
- **若要商用（對外上線、進 iRent 正式 App）：必須另行評估專利風險**，不能因為「授權是開源的」就推論專利無虞 —— 授權文字本身已明白告訴你它不管專利。此評估應在 PIG-11 技術選型階段就啟動，而非開發完才補。

> 註：上述 Solera Qapter 專利佈局為選型階段的既有背景資訊，本文件未獨立做專利檢索。商用前的正式 FTO（freedom-to-operate）評估仍須由法務／專利事務所執行。
