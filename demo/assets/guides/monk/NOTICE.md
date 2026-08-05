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
| `beauty-shot-left` = **左前 45°** | `fesc20-bD8CBhYZ` | `haccord-huAZfQJA` | `ffocus18-GgOSpLl6` |

> ✅ **更正（2026-08-05）：這四張就是完整的四角，沒有缺口。**
>
> 舊版本這裡寫「缺 `front-lateral-full-left`，第四張是左側全景、非 45° 角」——**這是錯的**。已回上游逐項核對：
>
> 1. `fesc20` 的 **38 個 sight 全部列出來查過**，確實沒有任何 sight 叫 `front-lateral-full-left`。
> 2. 但 `beauty-shot-left` 的相機是 `front-lateral-full-right` 的**精確鏡像**：
>    `location_xyz [+1.85,-2.7,1.5]` vs `[-1.85,-2.7,1.5]`、`rotation_xyz_deg [69,0,+45]` vs `[69,0,-45]`、
>    焦距同為 26。在 Monk 的座標系中 `y<0` 是車頭、`x>0` 是車輛左側，所以這個機位就是
>    **左前、離車 3.27 m、機高 1.5 m、俯角 21°** —— 就是左前 45°。
> 3. **SVG 幾何逐點驗證**：把 `fesc20-0mJeXBDf` 對 `x=250` 水平鏡射後與 `fesc20-bD8CBhYZ` 相比，
>    9,556 個取樣點的**最大偏差 0.0000** viewBox 單位（子路徑數與取樣點數也完全相同）。
>    rear 那一對（`EJ0tXYBW` / `T4dIGLgy`）同樣是精確鏡像（10,748 點、最大偏差 0.0000）。
>
> → 這 4 個檔案實際上是 **2 組獨立渲圖，各自加一份鏡像**。四角齊全，
> **不需要我方自行鏡射**，`lf` 直接用原生的 `fesc20-bD8CBhYZ`。
> （`camera` 名稱裡的 `IGNORE_MIRROR` 是上游產生器的旗標，不代表幾何不是鏡像。）
>
> 其餘 34 個 sight 本次仍未取（每台車上游都有 38–39 個）。

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

---

## 6. 幾何適用性量測：Monk 的 `cuv` 輪廓貼到 Toyota Corolla Cross 上準不準？（2026-08-05）

**結論：不夠準，不建議當交付物。而且瓶頸不是「車款不同」，是「機位不同」。**

### 6.1 上游相機參數（`fesc20.json` 的 `camera` 欄位）

| 角度 | sight id | `location_xyz` | `rotation_xyz_deg` | 離車水平距 | 方位角（偏離車頭軸） | 鏡頭朝向（平面） | 俯角 |
|---|---|---|---|---|---|---|---|
| lf | `fesc20-bD8CBhYZ` | `[ 1.85, -2.70, 1.50]` | `[69, 0,  45]` | 3.27 m | 34.4° | 45° | 21° |
| rf | `fesc20-0mJeXBDf` | `[-1.85, -2.70, 1.50]` | `[69, 0, -45]` | 3.27 m | 34.4° | 45° | 21° |
| lr | `fesc20-T4dIGLgy` | `[ 1.85,  2.65, 1.50]` | `[70, 0, 135]` | 3.23 m | 34.9° | 45° | 20° |
| rr | `fesc20-EJ0tXYBW` | `[-1.85,  2.65, 1.50]` | `[70, 0,-135]` | 3.23 m | 34.9° | 45° | 20° |

座標系（由上游 38 個 sight 的機位表反推）：**X = 車輛左側、Y = 車尾、Z = 上**，右手系；
Blender 相機朝 local −Z，`rotation_xyz` 為 XYZ Euler，`rot_x = 90°` 代表水平視線
（已用 `lateral-low-*` 這幾個 `rot_x = 90`、機高 0.8 m 的 sight 交叉驗證）。

**有效視角**：上游宣告 `focal_length: 26`（36 mm 片幅 → hFOV 69.4°），但實測 500×375 overlay 的
有效 hFOV 是 **66.7°（≒27.4 mm 等效）**。回推方式：機位與旋轉取上游值為已知，只留
兩個半視角切線 `th`/`tv` 為未知，要求兩個近側胎地接觸點（由 overlay 自身的下包絡線客觀讀出）
反投影到地面後落在真實 Ford Escape 的半輪距 0.805 m 與軸距 2.710 m 上。

**自我驗證**（3 個條件、2 個未知 → 過定）：

| 檢核 | 結果 |
|---|---|
| 半輪距／軸距殘差（front sight） | **3–4 mm** |
| 半輪距／軸距殘差（rear sight） | 23–28 mm（軸距的 1%） |
| `th/tv` 比值 | **1.315**（500×375 的 4:3 應為 1.3333） |
| 四個角獨立解出的 `th`/`tv` | **全部收斂到 0.658 / 0.498–0.500** |

四個角、兩組獨立渲圖各自解出同一組視角，且順帶還原出基準車的真實輪距與軸距 —— 座標系、
旋轉慣例、感光元件比例三項假設都得到獨立確認。

### 6.2 量測方法

**四點錨定疊圖**，全程**沒有對車身輪廓做任何擬合**：

1. 每個候選輪廓各自提供**自己的**四個近側輪平面錨點（前後胎地接觸點＋前後輪轂中心）。
   iRent 專屬版取自其 render 相機（解析值，與 SVG 自帶的 `#ground` 十字吻合到 0.16–0.77 px）；
   Monk 取自 §6.1 校正後的相機。
2. 以這四點解**精確四點單應性**（自動吸收 viewBox 框架差異：Monk 填滿 93%、專屬版 80%）。
3. 基準真值 = `car-reference/render-<角度>-glb-ccby.png` 的**外輪廓**。該渲圖與
   `guide-cuv-*.svg` 同相機（渲圖遮罩 bbox 與 SVG outline bbox ×3.2 吻合到 ~3 px），
   背景為單一灰階 → 遮罩可精確取出，**零人工標註**。
4. 兩側都套同一個「外輪廓」算子（描邊光柵化 → 由畫框外泛洪 → 取實心／背景交界），
   所以內部線條多寡不影響比較。
5. 指標 = 對稱 rms 最近點距離，以**車寬**（1.825 m 換算到車體中心景深的像素數 = 539 px）為分母。

### 6.3 結果

| 角度 | Monk BSD (fesc20) | iRent 專屬版〔下限〕 | 橢圓（錨定） | 矩形（錨定） | 橢圓（最佳 bbox） | 矩形（最佳 bbox） |
|---|---|---|---|---|---|---|
| lf | **15.79%** | 0.44% | 15.69% | 22.38% | 15.84% | 22.61% |
| rf | **16.05%** | 0.33% | 15.79% | 22.55% | 15.99% | 22.85% |
| lr | **9.12%** | 0.32% | 13.96% | 21.36% | 14.02% | 21.63% |
| rr | **9.20%** | 0.30% | 13.71% | 21.11% | 13.86% | 21.38% |

（單位：對稱 rms 佔車寬百分比。絕對值：Monk 49–87 px、專屬版 1.6–2.4 px、橢圓 74–85 px、矩形 114–122 px。）

**控制組是否被有效區分開：是。** 正確輪廓 0.30–0.44% vs 控制組 13.7–22.9%，相差 **35–70 倍**，
指標有明確鑑別力。但**Monk 落在控制組的區間內**：前兩角（15.8–16.1%）與橢圓（15.7–15.8%）
在統計上分不開，後兩角（9.1–9.2%）只比橢圓好約 1.5 倍。

> ⚠️ 專屬版那一欄是**指標下限，不是獨立結果** —— 它的輪廓與基準真值出自同一顆模型，必然吻合。
> 有資訊量的是 Monk 那一欄與控制組的相對位置。

### 6.4 誤差來源分解（關鍵）

用參數化車體外框（各自的長寬高、軸距、前後懸）把誤差拆開：

| 成分 | rms | 佔車寬 |
|---|---|---|
| **(A) 機位差**：Escape 外框，從 Monk 相機 → 錨定 → 本專案相機 | 101.2 px | **18.76%** |
| **(B) 車款差**：Escape 外框 vs Corolla Cross 外框，同一個相機 | 16.6 px | **3.07%** |
| (A+B) 合計（與 §6.3 實測相符） | 95.8 px | 17.77% |

**約 85% 的誤差來自機位差，只有約 15% 來自車款不同。**
四點錨定會把 Escape 的軸距壓成 Corolla Cross 的（比例 0.9742）、把輪半徑壓齊（0.9381），
壓完之後 Escape 的車頂 1.670 m 落在相當於 1.567 m 的位置，與真實的 1.620 m 差 **−53 mm** —— 車款差確實很小。

### 6.5 對交付的意涵

- **Ford Escape 當 CUV 幾何代理是合格的**（錨定後與 Corolla Cross 差約 3% 車寬）。
- **但 Monk 釋出的是 2D SVG，帶著它自己的透視**（3.27 m／方位角 34.4°／鏡頭朝 45°／hFOV 66.7°），
  與本專案的目標站位（3.85 m／方位角 45°／對準車體中心／hFOV 69.4°）差距顯著，
  而 2D 單應性無法修正機位差造成的 3D 視差。
- ⇒ **在現行目標站位下不可當交付物。** 若日後把 App 的目標站位改成 Monk 的站位，
  或取得可重新投影的 3D 來源，這批資產就會變得可用。
- 授權面（BSD-3-Clause-Clear，§2）與專利面（§5）的結論不受本節影響。

> 量測為離線計算（Python／numpy／PIL），未跑 headless 瀏覽器。
> `guide-lab`（`demo/guide-lab.html`）可用來目視複核同一組疊圖。
