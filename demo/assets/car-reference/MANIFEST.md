# 車體輪廓參考素材 —— Toyota Corolla Cross

> ⚠️ **此註記已於 2026-08-05 更新：本目錄不再整個 gitignore。**
> 現在只排除三顆 3D Warehouse 模型與 `shape/` 目錄；其餘素材已進版控並完成授權標示。
> **散布義務與最新的進版控範圍以 [`ATTRIBUTION.md`](./ATTRIBUTION.md) 為準**，本文件保留為研究過程紀錄。
>
> 內含第三方版權素材。表格中授權欄標為 `CC BY-SA 4.0` 的照片可在**標示作者與授權、且衍生物同樣以 CC BY-SA 授權**的前提下散布；
> 標為 `未確認` 的 3D 模型**不可**進公開 repo。

---

## 1. 挑選的車款

| 項目 | 值 |
|---|---|
| 車款全名 | **Toyota Corolla Cross**（第一代，Toyota 車體代號 **XG10 / 台灣底盤代號 ZSG10**，前期款 pre-facelift） |
| 年式 | **2020–2023 年式**（台灣 2020/10 上市；2023/11 推出小改款，小改款外觀件改變但**車身尺寸不變**） |
| iRent 車種分級 | 中型車（與 ALTIS 同級，含 `COROLLA CROSS` 汽油與 `COROLLA CROSS 油電` 兩種） |
| 車身類別 | CUV / crossover |

### 真實尺寸（輪廓建構用）

| 尺寸 | 值 |
|---|---|
| 車長 | **4,460 mm** |
| 車寬 | **1,825 mm**（不含後視鏡） |
| 車寬（含後視鏡展開） | 約 2,080 mm |
| 車高 | **1,620 mm**（含車頂架約 1,645 mm） |
| 軸距 | **2,640 mm** |
| 前輪距／後輪距 | 約 1,560 / 1,570 mm |
| 最小離地高 | 約 161 mm |

> ⚠️ 上述數字為 Corolla Cross 亞洲規（台灣／泰國／印尼共用車體）通行規格。**未能從 Toyota 台灣官網規格頁直接抓到逐項確認**（官網規格為 JS 動態載入，本次抓取只取到價格區間）。
> 交付前建議由人工開 Toyota 台灣「COROLLA CROSS 規格表」PDF 對一次。**下方 3D 模型的實測比例支持這組數字**（見 §2 驗證）。

---

## 2. 3D 模型（最高優先產出 —— **已取得**）

| 檔名 | 內容 | 來源 URL | 授權 | 大小 | 幾何 | 材質 |
|---|---|---|---|---|---|---|
| `model-corolla-cross-3dw-ghost.glb` | 2020 Toyota Corolla Cross（**主推**，已渲染驗證） | https://3dwarehouse.sketchup.com/model/ad1d6e84-a35d-484c-a9ab-f608e68fb34a | 未確認（3D Warehouse ToS，非 CC；API 未回傳 license/copyright 欄位）→ **不可進版控** | 38,395,252 B | 419,714 tri / 152 mesh / 306 node | 28 material、3 texture |
| `model-corolla-cross-hybrid-3dw.glb` | 2022 Toyota Corolla Cross Hybrid（同源模型的另一種 mesh 切法，備援） | https://3dwarehouse.sketchup.com/model/0b7097f4-776b-433b-bf8d-dfe1a83ff442 | 同上 | 30,439,316 B | 470,413 tri / 257 mesh / 513 node | 30 material、12 texture |
| `model-corolla-altis-3dw-carsoftaiwan.glb` | [Cars of Taiwan] 2020 Toyota Corolla Altis HYBRID 尊爵（**sedan 類別**備用，iRent 中型車同級） | https://3dwarehouse.sketchup.com/model/e75a6860-662b-44ed-905c-09a48ed9c623 | 同上 | 29,881,860 B | 590,149 tri / 1,265 mesh | 867 material、794 texture |

**格式驗證**：三個檔案 `file` 均回報 `glTF binary model, version 2`；自寫 GLB parser 可完整走訪 scene graph、讀出所有 POSITION accessor 與 node transform，無解析錯誤。皆為 `SimLab GLTF` 匯出（3D Warehouse 自動從 `.skp` 轉出的公開 AR 資產）。

**尺寸驗證（`model-corolla-cross-3dw-ghost.glb`）**：模型單位已是**公尺**，Y 軸向上，**車頭朝 +Z**。

| | 模型實測 | 真實規格 | 誤差 |
|---|---|---|---|
| 車長 (Z) | 4.551 m | 4.460 m | +2.0% |
| 車高 (Y) | 1.664 m | 1.620 m（+車頂架 1.645） | +1.2% |
| 車寬 (X) | 2.182 m | 2.080 m（**含後視鏡**） | +4.9% |

→ 比例正確，可直接用 `scale = 4.460 / 4.551 = 0.980` 均勻縮放對齊真實尺寸；縮放後車高 1.631 m（與 1.620 差 0.7%）。

**渲染驗證**：已用下述虛擬相機參數渲出四角，確認模型外觀確實是亞洲規 Corolla Cross（梯形大面積水箱罩、車頂架、輪拱黑色包件、車側下飾板皆吻合），且**車窗、輪拱、輪胎接地點、後視鏡、燈組線全部齊備**，可直接抽內部細節線。

| 檔名 | 角度 | 參數 |
|---|---|---|
| ~~`render-lf-glb-3dw.png`~~ | lf 左前 45° | yaw 45° |
| ~~`render-rf-glb-3dw.png`~~ | rf 右前 45° | yaw 315° |
| ~~`render-lr-glb-3dw.png`~~ | lr 左後 45° | yaw 135° |
| ~~`render-rr-glb-3dw.png`~~ | rr 右後 45° | yaw 225° |

> **2026-08-05（第二次更新）：這四張已從版控移除。** 全部渲圖與輪廓已改用
> `model-corolla-cross-sketchfab-ccby.glb`（CC BY 4.0）重新生成，檔名為
> `render-{lf,rf,lr,rr}-glb-ccby.png`。經逐項比對，CC BY 模型與本節這顆 3DW 模型
> **是同一份網格**（外接框、逐材質三角形數、輪心座標完全相同，四角剪影 IoU ≥0.9996），
> 所以下方的尺寸驗證數字對新模型同樣成立。詳見 [`ATTRIBUTION.md`](./ATTRIBUTION.md) §3。

共用相機：**距離 3.85 m、相機高 1.5 m、hFOV 69.4°（≒26 mm 等效、4:3）、俯角 17.3°、輸出 1600×1200 橫向**。
幾何自我檢查：車頂最高點（1.631 m）投影落在地平線之上、輪胎接地點落在地平線之下 → 相機確實位於車頂線以下，符合 1.5 m 設定。

> 授權（`render-*.png`）：本專案自行渲染，但屬 3D Warehouse 模型的衍生物 → 沿用來源模型的限制。
> **2026-08-05 更新**：這 4 張曾短暫進入版控（來源模型本身未散布）但授權鏈不乾淨；
> **同日已用 `git rm` 移除**，並改用 CC BY 模型重新生成（git 歷史仍保有舊檔）。
> 完整經過見 [`ATTRIBUTION.md`](./ATTRIBUTION.md) §3.3。

> ⚠️ 本節記載的相機參數「俯角 17.3°、輸出 1600×1200」與 `generated/build-report.json`
> 的 15.58° 不一致 —— 實測舊渲圖的取景與 SVG 相機差約 3% 畫面，兩批並非同一組相機。
> 新的 `render-*-glb-ccby.png` 已改為與 SVG 逐項同參數（填充率誤差 ≤0.3%）。

---

## 3. 照片素材

四個角度全部湊齊。用途一律標為「透視校正」—— 依調研結論，白底棚拍圖已不作為輪廓來源，本次未刻意蒐集。

| 檔名 | 角度 | 用途 | 來源 URL | 授權 | 背景 | 推估拍攝條件 | 同一台車 | 輪拱／接地點是否清楚 | 是否接近正確站位 |
|---|---|---|---|---|---|---|---|---|---|
| `phone-lf-commons-graphite-A.jpg` | lf | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:CorollaCrossZSG10Graphite4X7FL.jpg) | CC BY-SA 4.0 (Celica21gtfour) | 室外紅磚地、店面 | **Galaxy A35 5G，25 mm 等效，4:3 橫向**；估距 3.2–3.6 m、機高 1.5–1.6 m、偏擺約 33°（比 45° 淺） | ✅ **車 A**（車牌 `B…05·26` 與 lr 完全相同） | ✅ 極清楚，近側四個接地點與地面線都在 | ✅ **最接近目標**（距離、機高、橫向 4:3、焦距全中；僅偏擺淺約 12°） |
| `phone-lr-commons-graphite-A.jpg` | lr | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:CorollaCrossZSG10Graphite4X7RL.jpg) | CC BY-SA 4.0 (Celica21gtfour) | 同上（同地點，相隔 16 秒） | 同上；估距 3.2–3.5 m、機高 1.5–1.6 m、偏擺約 28° | ✅ **車 A** | ✅ 極清楚 | ✅ **最接近目標** |
| `phone-lf-commons-white-C.jpg` | lf | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_-_Front.jpg) | CC BY-SA 4.0 (Areaseven) | 室內經銷商展場、綠色地坪 | OnePlus HD1903，**27 mm 等效**，1920×1080 **16:9（非 4:3）**；估距 3.8–4.2 m、機高 ~1.6 m、偏擺約 40° | ✅ 車 C（與 lr／side 同車、相隔 2 分鐘） | ✅ 清楚，地坪標線可當地面參考 | 🟡 距離／機高／焦距接近，但**畫面比例是 16:9 不是 4:3** |
| `phone-lr-commons-white-C.jpg` | lr | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_-_Rear.jpg) | CC BY-SA 4.0 (Areaseven) | 同上 | 同上；偏擺約 40° | ✅ 車 C | ✅ 清楚 | 🟡 同上（16:9） |
| `phone-side-commons-white-C.jpg` | 正側（非四角） | 比例／軸距參考 | [Commons](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_-_Side.jpg) | CC BY-SA 4.0 (Areaseven) | 同上 | OnePlus，**13 mm 等效超廣角** → 桶形變形明顯 | ✅ 車 C | ✅ 清楚 | ❌ 超廣角，不可用於透視校正；僅供量軸距／比例 |
| `phone-rf-commons-grey-D.jpg` | **lf**（檔名的 `rf` 是錯的，見下方 §3.1） | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2020.jpg) | CC BY-SA 4.0 (Captainmorlypogi1959) | 室外碎石地、民宅牆 | Galaxy J4+ (SM-J415GN)，**27 mm 等效，4:3 橫向**；估距 ~3.5 m、機高 ~1.5 m、偏擺約 30° | ❌ 車 D（單張） | ✅ 清楚 | 🟡 可用，但**是 lf 不是 rf** |
| `phone-rr-commons-silver-E.jpg` | rr | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2023_(13).jpg) | CC BY-SA 4.0 (Captainmorlypogi1959) | 室內展場、反光磁磚地 | 無 EXIF（已被移除）；估距 3–4 m、機高 ~1.6 m、偏擺約 40°、1920×1437 ≈4:3 橫向 | ❌ 車 E（單張） | ✅ 清楚，反光地板同時給出鏡射線 | 🟡 條件接近但**焦距未知**（EXIF 被剝除） |
| `phone-rr-commons-silver-F.jpg` | rr | 透視校正 | [Commons](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2023_(12).jpg) | CC BY-SA 4.0 (Captainmorlypogi1959) | 同上（另一台） | 無 EXIF；估距 ~3.5 m、機高偏高 ~1.7 m、偏擺約 50°、≈4:3 橫向 | ❌ 車 F（單張） | ✅ 清楚 | 🟡 偏擺最接近 45°，但機高偏高、焦距未知 |
| `phone-rf-commons-red-B.jpg` | rf | 透視校正（僅車頭細節） | [Commons](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_1.8_ZSG10R_(20201113)_01.jpg) | CC BY-SA 4.0 (オーバードライブ83) | 室內展間 | SONY DSC-W810 隨身機，**26 mm 等效**，4:3 橫向；估距 2.5–3 m、機高 ~1.5 m、偏擺約 25° | ✅ 車 B（與 rr 同車、相隔 22 秒） | 🟡 前輪拱清楚，**後輪被裁掉** | ❌ **全車未入鏡**（左右都被裁切）→ 不能做整體輪廓，只能取車頭細節 |
| `phone-rr-commons-red-B.jpg` | rr | 透視校正（僅車尾細節） | [Commons](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_1.8_ZSG10R_(20201113)_02.jpg) | CC BY-SA 4.0 (オーバードライブ83) | 同上 | SONY DSC-W810，**29 mm 等效**，4360×3149；估距 ~3–3.5 m、機高 ~1.5 m | ✅ 車 B | 🟡 後輪拱與接地點清楚，車頭被裁 | ❌ 全車未入鏡 |
| `phone-side-commons-silver-H.jpg` | 正側偏後（非四角） | 比例參考 | [Commons](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2023_(14).jpg) | CC BY-SA 4.0 (Captainmorlypogi1959) | 室內展場 | 無 EXIF；近正側、估距 ~4 m | ❌ 車 H | ✅ 清楚 | ❌ 非 45°，僅供比例 |
| `phone-lf-commons-black-G.jpg` | lf | 視覺參考 | [Commons](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_ZSG10_1.8_G_Attitude_Black_Mica.jpg) | CC BY-SA 4.0 (Ethan Llamas) | 室外街道 | 無 EXIF；1920×1234（16:9 裁切）；車在畫面中偏小 → 估距 6–8 m | ❌ 車 G | 🟡 尚可但車體小 | ❌ 站太遠、黑色車輪拱陰影重 → 僅作視覺參考 |

### 3.1 ⚠️ 修正：`phone-rf-commons-grey-D.jpg` 其實是 lf（2026-08-05）

**這張的角度歸類原本是錯的**，`sources.js` 也跟著錯（已一併修正）。在 guide-lab 裡這會讓 rf 分頁拿到一張左右鏡射錯誤的參考底圖。

判定依據（三項，全部只用本 repo 內既有素材，不依賴車款知識）：

| 檔案 | 車頭（水箱罩／車牌）在畫面 | 車身往哪延伸 |
|---|---|---|
| `render-lf-glb-ccby.png`（本專案自渲的 lf 基準，方位角 45°） | **左** | 右 |
| `render-rf-glb-ccby.png`（同上，rf 基準，方位角 315°） | **右** | 左 |
| `phone-lf-commons-graphite-A.jpg`（已驗證的 lf） | **左** | 右 |
| `phone-rf-commons-grey-D.jpg` | **左** ← 與 lf 基準同布局 | 右 |

即：本專案的 lf ⇒ 車頭在畫面左、rf ⇒ 車頭在畫面右（此規則由 `geom.js` 的 `azimuthFor()` 與相機基底推導可得，並與兩張自渲基準圖一致）。grey-D 的車頭在畫面左，**故為 lf**。

**檔名保持不動**（改名會打斷 git 歷史與既有引用）；角度歸類以本表與 `sources.js` 為準。

### 角度覆蓋（依上述修正後）

| 角度 | 可用素材 | 同一台車 |
|---|---|---|
| lf 左前 45° | ✅ graphite-A（最佳）、white-C、**grey-D**（原誤標 rf） | ✅ 車 A（lf+lr）、車 C（lf+lr） |
| lr 左後 45° | ✅ graphite-A（最佳）、white-C | ✅ 同上 |
| rf 右前 45° | ❌ **沒有全車入鏡的素材**（原本唯一的 grey-D 實為 lf；red-B 左右被裁切） | — |
| rr 右後 45° | ✅ silver-E / silver-F、red-B（裁切） | ✅ 車 B |

- **同一台車、全車入鏡、四角齊全的組合並不存在。** 修正後 **rf 完全沒有可用素材**。
- 由於車體左右對稱，**車 A 的 lf/lr 水平鏡射即可得到品質相同的 rf/rr**，實務上四角都可由車 A 一台車推得；rf 的缺口就用 lf 鏡射補。

### 3.2 相機參數重估（錨定法，2026-08-05）

上表「推估拍攝條件」欄的距離／偏擺是目視估的，偏粗。這裡改用**錨定法**重估：在照片上讀出近側四個地標
（前後輪的**輪轂中心**＋前後輪的**胎地接觸點**，四點共平面於近側輪平面），以 EXIF 焦距為已知，
解 5 自由度相機（距離、方位角、機高、平移、俯仰）。

| 檔案 | MANIFEST 原估 | 錨定法重估 | 錨點重投影殘差 |
|---|---|---|---|
| `phone-lf-commons-graphite-A.jpg` | 3.2–3.6 m / 偏擺 33° / 機高 1.5–1.6 m | **距離 3.8 m / 偏擺 42.6° / 機高 1.02 m / 俯角 3.2°**（25 mm 等效、hFOV 71.5°） | rms **8.1 px**（逐點 2.8 / 10.8 / 2.9 / 11.3） |

> ⚠️ **這組重估數字不可信，僅記錄不採信。** 偏擺確實明顯大於原記錄的 33°（重估 42.6°，與前一輪獨立估的 44° 同向），
> 但**距離與機高無法定出**，理由是 graphite-A 的輪部幾何**本身就不自洽**，無法用單一無畸變針孔相機解釋：
>
> | 觀測量 | 推得的前輪距離 |
> |---|---|
> | 前輪亮鋁圈橢圓的垂直半徑（115 px，18 吋圈） | ≈ 2.2 m |
> | 前後輪轂在畫面上的張角（602 px / f=1111 px）＋ 實際軸距 2.640 m | ≈ 4.4 m |
> | 前後輪表觀大小比（1.05–1.28） | 2.9–5.5 m（比值本身很不穩） |
>
> 三者相差近 2 倍。可能原因：EXIF 焦距對應的鏡頭與實際使用的鏡頭不同（Galaxy A35 主鏡 26 mm／超廣角 ~13 mm）、
> 未校正的桶形變形（前輪在畫面中央、後輪靠右緣）、或近側輪拱陰影讓接觸點讀數偏移。
> **原記錄的 3.2–3.6 m 與前一輪的 5.9 m 都沒有被證實，也都沒有被否證。**
>
> 其餘照片（white-C / grey-D / silver-E / silver-F）未逐張重估：本次的量測結論不依賴它們（見下），
> 且 silver-E/F 的 EXIF 已被剝除、焦距未知，錨定法在焦距未知時距離與焦距耦合、無解。

**方法學結論（重要）：這批 Commons 照片不足以當「輪廓準不準」的裁判。**
四點錨定疊圖在 graphite-A 上做了控制組檢定：**best-fit 橢圓（15.5% 車寬）比兩條真實輪廓
（Monk 37.3%、專屬版 31.5%）都好**。控制組贏了 ⇒ **該指標在這批照片上無鑑別力，數字全部作廢。**
原因不是指標設計，而是**沒有一張照片站在目標機位**（本文件 §5 早已列為缺口）：
四點共平面單應性只能對齊近側輪平面，無法修正機位差造成的 3D 視差。
可用的替代裁判見 [`../guides/monk/NOTICE.md`](../guides/monk/NOTICE.md) §6
（改用 `render-*-glb-ccby.png` 當基準真值，錨點兩側皆為解析值、零人工標註）。

### 解析度標註

所有照片長邊皆 ≥ 1600 px，**無低於 800 px 的檔案**。長邊最小者為 `phone-lf-commons-graphite-A.jpg` / `phone-lr-commons-graphite-A.jpg`（1600×1200），仍足以取輪廓與內部細節線。

---

## 4. 授權風險摘要

| 類別 | 授權 | 可否進公開 repo |
|---|---|---|
| 12 張 Commons 照片 | 全部 **CC BY-SA 4.0** | 🟡 技術上可以，但須逐張標示作者與授權連結，且**衍生輪廓資料會被 ShareAlike 感染**。建議：只用來對照校正，**不要**讓輸出的 SVG 輪廓直接衍生自照片描邊。 |
| 3 個 `.glb`（3D Warehouse） | **未確認** —— API 未回傳 license／copyright；受 Trimble 3D Warehouse Terms of Use 管轄，非 CC | ❌ 不可 |
| 4 張 `render-*-glb-ccby.png` | **CC BY 4.0**（Sketchfab 模型的衍生物） | ✅ 進版控，授權鏈完整 → `ATTRIBUTION.md` §3 |
| ~~4 張 `render-*-glb-3dw.png`~~ | 3D Warehouse 模型的衍生物 | ❌ 曾進版控，**2026-08-05 已移除** → `ATTRIBUTION.md` §3.3 |
| `shape/` 24 張 PNG | Toyota／iRent 官方行銷去背圖，**all rights reserved** | ❌ 不可 → `ATTRIBUTION.md` §4.2 |
| 車輛外觀本身 | Toyota 對車體造型保有設計權；上述模型皆為第三方仿製，非原廠授權資產 | — 產出的**抽象虛線輪廓**風險低，但不應散布模型或渲圖本身 |

~~**結論：整個 `demo/assets/car-reference/` 維持 gitignore。**~~

**2026-08-05 修訂結論：** 改為只排除三顆 3DW 模型與 `shape/` 目錄。
Commons 照片（CC BY-SA 4.0）與 Sketchfab 模型（CC BY 4.0）已逐項完成作者與授權標示後進版控；
`render-*-glb-ccby.png` 與 `generated/` 產物進版控，授權鏈已清理完成（2026-08-05）。
完整的進版控範圍、標示義務與補救計畫見 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。

---

## 5. 未取得 / 缺口

- **Toyota 台灣官方規格表逐項確認**：官網規格頁為 JS 動態載入，未抓到；尺寸數字需人工複核一次。
- **台灣本地實拍**：所有照片來自印尼／菲律賓（同一代同車體，但為右駕市場車，內裝鏡射；外部輪廓不影響）。**沒有一張是台灣 iRent 實車。**
- **真正落在 3.7–3.9 m / 1.5 m / 45° 偏擺 / 4:3 橫向的照片**：最接近的 `graphite-A` 偏擺只有 28–33°。要拿到嚴格 45° 的黃金參考，最可靠途徑是**人到 iRent 停車格實地拍 4 張**（用捲尺定 3.8 m、手機貼胸高、橫向 4:3、主鏡頭）。這件事無法從網路素材補齊。
- **8891／Goo／abc 好車網**：本次未取。理由：其照片多為近距離（2–3 m）或直向拍攝，依調研結論價值有限；且網站 ToS 未明確允許下載再利用，風險高於收益。

## 6. 本次搜尋過程中確認可用但未下載的其他 iRent 車款 3D 模型

3D Warehouse 對 iRent 全車系幾乎都有公開 `.glb`（皆為 `/content/public/` 端點，免登入），需要時可直接照 §2 的方式取得：

- Toyota Yaris Cross — `e6b6f7fe-7a27-4b99-afad-019d365cab21`、`959a191b-97f4-4cce-a437-1f55326c4276`
- Toyota Sienta（2016 / 2018 / 2021 多個年式與等級） — 例 `96ac65c6-b9b0-418f-8e3b-020efffa95c4`（2021 Sienta Q）
- Toyota Vios — `6055737a-a2bc-4e22-b35f-c359ea922b07`
- Toyota Corolla Altis — `edb5437b-a583-4619-8a28-f3ac28ca28e8`

取得方式：`GET https://3dwarehouse.sketchup.com/warehouse/v1.0/entities?q=<關鍵字>&contentType=3dw&showBinaryAttributes=true&showBinaryMetadata=true`
→ 取 `binaries.glb.contentUrl` → 直接 `curl` 下載（免驗證）。

> Sketchfab 上另有多個 **CC BY** 授權（可商用、僅需標示作者）的 Corolla Cross 模型，授權比 3D Warehouse 乾淨得多，但 `/v3/models/{uid}/download` 需 OAuth token（回 401），本次無帳號無法取得。若後續要一個**授權乾淨、可進版控**的模型，申請一個 Sketchfab 帳號下載這個是最短路徑：
> `https://sketchfab.com/3d-models/toyota-corolla-cross-cc503d26ea694dce85e7d0f1491b0e30`（CC BY，419,710 面，作者 Nieve5677）
