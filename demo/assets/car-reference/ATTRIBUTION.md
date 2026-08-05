# 第三方素材授權標示 —— `demo/assets/car-reference/`

本目錄含**第三方版權素材**，且本 repo 為 public（`github.com/PigeonPacket/hotai-irent`），
散布行為持續發生。本文件是這批素材的**強制標示**，散布時必須連同保留。

> 本文件為自足文件。`MANIFEST.md` 是研究過程的完整紀錄（含相機參數、尺寸驗證、取捨理由），
> 兩者互補；授權義務以**本文件**為準。

---

## 0. 一覽：什麼有進版控、什麼沒有

| 素材 | 授權 | 進版控 |
|---|---|---|
| 12 張 `phone-*-commons-*.jpg` | **CC BY-SA 4.0** | ✅ 已標示（§1） |
| `model-corolla-cross-sketchfab-ccby.glb` | **CC BY 4.0** | ✅ 已標示（§2） |
| 4 張 `render-*-glb-ccby.png` | **CC BY 4.0 衍生物**（衍生自 §2 的模型） | ✅ 授權鏈完整（§3） |
| `generated/` 的 SVG／PNG／`build-report.json` | 同上（衍生自同一批渲圖） | ✅ 同上（§3） |
| ~~4 張 `render-*-glb-3dw.png`~~ | 衍生自授權未確認的 3DW 模型 | ❌ **已於 2026-08-05 從版控移除**；git 歷史仍保有（§3.3） |
| 3 顆 `model-*-3dw-*.glb` | **未確認**，Trimble 3D Warehouse ToS | ❌ 已 gitignore，**未散布**（§4） |
| `shape/` 目錄 | **All rights reserved**（Toyota／和泰 iRent 官方行銷圖） | ❌ 已 gitignore，**未散布**（§4） |

---

## 1. Wikimedia Commons 照片 —— CC BY-SA 4.0（12 張）

全部取自 Wikimedia Commons，授權一律 **CC BY-SA 4.0**
（<https://creativecommons.org/licenses/by-sa/4.0/>）。

作者與授權欄位已於 **2026-08-05** 以 Commons API（`prop=imageinfo&iiprop=extmetadata`）
逐張回查原始檔案頁確認，非轉抄。

| # | 本目錄檔名 | 原始檔案頁 | 攝影者（Artist） | 授權 | 原始解析度 |
|---|---|---|---|---|---|
| 1 | `phone-lf-commons-graphite-A.jpg` | [CorollaCrossZSG10Graphite4X7FL.jpg](https://commons.wikimedia.org/wiki/File:CorollaCrossZSG10Graphite4X7FL.jpg) | Celica21gtfour | CC BY-SA 4.0 | 1600×1200 |
| 2 | `phone-lr-commons-graphite-A.jpg` | [CorollaCrossZSG10Graphite4X7RL.jpg](https://commons.wikimedia.org/wiki/File:CorollaCrossZSG10Graphite4X7RL.jpg) | Celica21gtfour | CC BY-SA 4.0 | 1600×1200 |
| 3 | `phone-lf-commons-white-C.jpg` | [2020 Toyota Corolla Cross - Front.jpg](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_-_Front.jpg) | Areaseven | CC BY-SA 4.0 | 1920×1080 |
| 4 | `phone-lr-commons-white-C.jpg` | [2020 Toyota Corolla Cross - Rear.jpg](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_-_Rear.jpg) | Areaseven | CC BY-SA 4.0 | 1920×1080 |
| 5 | `phone-side-commons-white-C.jpg` | [2020 Toyota Corolla Cross - Side.jpg](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_-_Side.jpg) | Areaseven | CC BY-SA 4.0 | 1920×1079 |
| 6 | `phone-rf-commons-grey-D.jpg` | [Toyota Corolla Cross 1.8 G 2020.jpg](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2020.jpg) | Captainmorlypogi1959 | CC BY-SA 4.0 | 4128×3096 |
| 7 | `phone-rr-commons-silver-E.jpg` | [Toyota Corolla Cross 1.8 G 2023 (13).jpg](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2023_(13).jpg) | Captainmorlypogi1959 | CC BY-SA 4.0 | 5760×4312 |
| 8 | `phone-rr-commons-silver-F.jpg` | [Toyota Corolla Cross 1.8 G 2023 (12).jpg](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2023_(12).jpg) | Captainmorlypogi1959 | CC BY-SA 4.0 | 5760×4312 |
| 9 | `phone-rf-commons-red-B.jpg` | [2020 Toyota Corolla Cross 1.8 ZSG10R (20201113) 01.jpg](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_1.8_ZSG10R_(20201113)_01.jpg) | オーバードライブ83 | CC BY-SA 4.0 | 3857×2902 |
| 10 | `phone-rr-commons-red-B.jpg` | [2020 Toyota Corolla Cross 1.8 ZSG10R (20201113) 02.jpg](https://commons.wikimedia.org/wiki/File:2020_Toyota_Corolla_Cross_1.8_ZSG10R_(20201113)_02.jpg) | オーバードライブ83 | CC BY-SA 4.0 | 4360×3149 |
| 11 | `phone-side-commons-silver-H.jpg` | [Toyota Corolla Cross 1.8 G 2023 (14).jpg](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_1.8_G_2023_(14).jpg) | Captainmorlypogi1959 | CC BY-SA 4.0 | 5760×4312 |
| 12 | `phone-lf-commons-black-G.jpg` | [Toyota Corolla Cross ZSG10 1.8 G Attitude Black Mica.jpg](https://commons.wikimedia.org/wiki/File:Toyota_Corolla_Cross_ZSG10_1.8_G_Attitude_Black_Mica.jpg) | Ethan Llamas | CC BY-SA 4.0 | 3420×2198 |

### CC BY-SA 4.0 課予我方的義務

**BY（姓名標示）** —— 散布或公開展示時必須標示攝影者、授權名稱與連結，並提供原始檔案頁連結。
上表即為此標示；把這些檔案搬到別處時，這份標示必須跟著走。

**SA（相同方式分享）—— 這條有感染性，是實務上的重點：**

> 若你**改作**（remix／transform／build upon）這些照片，產生的衍生作品
> **必須以 CC BY-SA 4.0（或相容授權）釋出**，不能改用更嚴格的條款，也不能宣告為私有。

落在本專案的意思：

- 只是**開著照片對照校正**、憑目視調整幾何參數 → 產出的數值屬幾何事實，不構成改作，**不被感染**。
- 但若把照片**描邊**、裁切、疊圖、或讓輪廓 SVG 直接衍生自照片像素 → 該 SVG 就是衍生作品，
  **必須連帶以 CC BY-SA 4.0 釋出**，並標示原攝影者。

> ⚠️ 目前 `generated/` 的 SVG **不是**衍生自這些照片（見 §3，它們衍生自 §2 的 CC BY 模型渲圖），
> 所以尚未觸發 ShareAlike。日後若改成描照片，這條就會生效，屆時必須重新評估整個 repo 的授權相容性。
>
> 這些照片在本次重建中只用於**比對驗證**（把渲出的輪廓疊上去目視檢查世代與比例是否吻合），
> 未對照片像素做任何描邊或裁切合成 → 不構成改作，不被 ShareAlike 感染。

---

## 2. Sketchfab 3D 模型 —— CC BY 4.0

**`model-corolla-cross-sketchfab-ccby.glb`**（10,996,456 bytes）

| 項目 | 值 |
|---|---|
| 模型標題 | **Toyota Corolla Cross** |
| 作者 | **Nieve5677**（Sketchfab 帳號 `niev`） |
| 作者 profile | <https://sketchfab.com/niev> |
| 模型頁 | <https://sketchfab.com/3d-models/toyota-corolla-cross-cc503d26ea694dce85e7d0f1491b0e30> |
| 授權 | **CC Attribution（CC BY 4.0）** — <http://creativecommons.org/licenses/by/4.0/> |
| 授權要求（Sketchfab 原文） | *Author must be credited. Commercial use is allowed.* |
| 模型 UID | `cc503d26ea694dce85e7d0f1491b0e30` |
| 發布日期 | 2025-10-28 |

### 必要標示（散布本 repo 即等同散布本模型）

> "Toyota Corolla Cross" by [Nieve5677](https://sketchfab.com/niev), licensed under
> [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
> Source: <https://sketchfab.com/3d-models/toyota-corolla-cross-cc503d26ea694dce85e7d0f1491b0e30>

CC BY **不具 copyleft 感染性** —— 由本模型產生的渲圖與輪廓可自由授權，只要保留上述標示。
這正是它比 §4 那三顆 3DW 模型乾淨的地方，`render-*-glb-ccby.png` 與 `generated/`
全部產物即衍生自本模型（§3）。

> ⚠️ 下面的「身分驗證」證明的是**這個 CC BY 宣告確實存在且對應這個檔案**，
> 不等於證明上傳者對網格擁有可授權的權利。上游的殘餘不確定性請一併讀 **§3.4**。

### 身分驗證（2026-08-05）

GLB 的 `asset.copyright` 欄位是空的，因此以 Sketchfab **公開 API**
（`GET https://api.sketchfab.com/v3/models/cc503d26ea694dce85e7d0f1491b0e30`，免登入）
回查後，與本地檔案實測逐項比對：

| 比對項 | API（上游） | 本地檔案實測 | 結果 |
|---|---|---|---|
| 面數 | 419,710 | 419,710（由 indices accessor 累加） | ✅ 完全相符 |
| 材質數 | 26 | 26 | ✅ |
| 貼圖數 | 0 | 0 image / 0 texture | ✅ |
| 標題 | Toyota Corolla Cross | `asset.extras.title` 同 | ✅ |
| Mesh 數 | —（API 未提供） | 44 | — |
| 檔案大小 | — | 10,996,456 bytes | — |
| generator | — | `Sketchfab-16.75.0` | — |

此外，GLB 的 `asset.extras` 本身即帶有 Sketchfab 匯出時寫入的出處欄位，與 API 回傳完全一致：

```json
{
  "author":  "Nieve5677 (https://sketchfab.com/niev)",
  "license": "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)",
  "source":  "https://sketchfab.com/3d-models/toyota-corolla-cross-cc503d26ea694dce85e7d0f1491b0e30",
  "title":   "Toyota Corolla Cross"
}
```

→ 三方獨立來源（公開 API、檔案內嵌 extras、`MANIFEST.md` §6 的既有紀錄）互相印證，**作者標示可信**。

---

## 3. ✅ 授權鏈已清理：`render-*-glb-ccby.png` 與 `generated/` 的 SVG

**2026-08-05 更新。** 本節原本記載「授權鏈不乾淨」；補救已執行完成，內容改寫如下。
歷史事實保留在 §3.3，**沒有刪除**。

### 3.1 現況：全部衍生自 §2 的 CC BY 模型

以下檔案由本專案自行產生，來源模型是 §2 的
**`model-corolla-cross-sketchfab-ccby.glb`（CC BY 4.0）**：

- `render-lf-glb-ccby.png`、`render-rf-glb-ccby.png`、`render-lr-glb-ccby.png`、`render-rr-glb-ccby.png`
- `generated/guide-cuv-{lf,rf,lr,rr}.svg`
- `generated/preview-{lines,shaded}-{lf,rf,lr,rr}.png`
- `generated/build-report.json`

CC BY 4.0 **允許商用、允許改作、無 copyleft 感染性**，唯一義務是標示作者。
因此這批衍生物的授權鏈是完整的：來源模型本身已進版控並完成標示（§2），
衍生物繼承同一條標示義務，不需要其他人的許可。

**散布這批檔案時必須連同保留的標示**（與 §2 相同）：

> "Toyota Corolla Cross" by [Nieve5677](https://sketchfab.com/niev), licensed under
> [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
> Source: <https://sketchfab.com/3d-models/toyota-corolla-cross-cc503d26ea694dce85e7d0f1491b0e30>

標示已寫進檔案本身，不依賴本文件：

- 每個 SVG 的 `<desc>` 帶完整 credit 字串；
- 每個 SVG 的 `<metadata id="guide-params">` 與 `build-report.json` 的 `meta` 帶
  `source` / `model_license` / `model_author` / `model_url` 四個欄位；
- 舊版那句 `"source": "3D Warehouse GLB render (INTERNAL VALIDATION ONLY)"` 已不存在。

### 3.2 重建方式與可比對性

相機內外參**逐項沿用**舊 `build-report.json`（`position_xyz`、`target_xyz`、
`hfov_deg` 69.39°、`vfov_deg` 54.88°、距離 3.85 m、機高 1.5 m、四角 45/135/225/315°），
所以新舊產物可直接疊圖比較。模型→世界的變換（均勻縮放 4.460/4.551 = 0.980、
X／Z 置中、輪胎底面貼 y=0）經驗證可重現舊 meta 的 `fill_w`／`fill_h` 至 1e-4，
確認兩批用的是同一個座標系。

`generated/` 的圖層結構與命名（`#outline`／`#detail`／`#ground`、viewBox 500×375）
維持不變，`demo/guide-lab/sources.js` 的解析與密度分級不受影響。

> 附帶修正：舊的 `render-*-glb-3dw.png` 其實**不是**用 SVG 的那組相機渲的
> （取景與 `build-report.json` 差約 3% 畫面，`MANIFEST.md` §2 記載的俯角 17.3° 也與
> build-report 的 15.58° 不符）。新的 `render-*-glb-ccby.png` 與 SVG 相機完全同參數，
> 實測填充率誤差 ≤0.3%，`sources.js` 上「透視完全一致」的說法到這一版才真正成立。

### 3.3 歷史事實（保留，不刪除）

**曾經有一批授權未確認的衍生物進入版控，這件事不能被這次清理抹掉：**

1. commit `a72c806`（*chore(assets): track car-reference research materials with attribution*）
   把 4 張 `render-*-glb-3dw.png` 與當時的 `generated/` 產物加入版控。
   它們衍生自 `model-corolla-cross-3dw-ghost.glb` —— 取自
   [3D Warehouse](https://3dwarehouse.sketchup.com/model/ad1d6e84-a35d-484c-a9ab-f608e68fb34a)、
   API 未回傳任何 `license`／`copyright` 欄位、受 **Trimble 3D Warehouse Terms of Use**
   管轄而非 CC 授權的模型。
2. 那批 SVG 的 metadata 自帶 `INTERNAL VALIDATION ONLY` 標記，與其進入 public repo
   的事實互相矛盾；本文件當時已誠實記載此矛盾。
3. **2026-08-05**：4 張 `render-*-glb-3dw.png` 已用 `git rm` 從版控移除，
   `generated/` 全部產物以 CC BY 模型重新生成覆蓋。
4. ⚠️ **`git rm` 只移除 HEAD，不會移除 git 歷史。** 從 `a72c806` 到移除前的那段歷史
   仍然包含這些檔案，任何人 `git clone` 都會取得它們。
   本專案**未執行**歷史改寫（`git filter-repo` + force push）——
   那會改變所有既有 commit 的 SHA。若日後判定必須徹底清除，須另行評估。
5. 三顆 3DW 模型本身**從未進入版控**（`.gitignore` 自 `2c84c2e` 起持續排除，見 §4.1），
   此次清理**不動**那三條排除規則。

### 3.4 誠實的殘餘不確定性：CC BY 模型與 3DW 模型是同一份網格

重建過程中做了新舊模型的逐項比對，結果必須記錄下來：

| 比對項 | `…sketchfab-ccby.glb` | `…3dw-ghost.glb` |
|---|---|---|
| 外接框（公尺） | 2.1823 × 1.6641 × 4.5510 | 2.1823 × 1.6641 × 4.5510 |
| 三角形數 | 419,710 | 419,714（多 2 個廠徽貼圖四邊形） |
| 逐材質三角形數 | 8137 / 9511 / 15738 / 310 / 12465 / … | **完全相同** |
| 四個輪心座標 | ±0.7806, 0.3475, +1.2715 / −1.3570 | **完全相同** |
| 材質命名 | `2020_Toyota_Corolla_Cross_*`（26 個） | `2020 Toyota Corolla Cross_*`（同 26 個，分隔字元不同） |
| 基準四角剪影像素 IoU | — | **0.99955 – 0.999999** |

→ 兩者是**同一份第三方原始模型**經不同匯出路徑（Sketchfab 直匯 vs SketchUp／SimLab 轉出）
產生的兩個副本。這帶來兩個必須講清楚的推論：

- **好的一面**：這次更換在幾何上是**零風險**的。輪廓形狀、比例、與實車的吻合度
  在數值上不可能因為換模型而變差（剪影 IoU 0.9996 以上）。
- **必須誠實的一面**：CC BY 的授權宣告來自 **Sketchfab 上傳者 Nieve5677**，
  而該網格與一份無授權宣告的 3D Warehouse 副本相同 →
  **無法確認上傳者本人即為原始建模者**。§2 的驗證證明的是
  「這個 CC BY 宣告確實存在、且確實對應這個檔案」，**不是**
  「上傳者對這份網格擁有可授權的權利」。

本專案的立場：CC BY 是目前**唯一有明文授權宣告、且有具名作者**的可得來源，
換過去在授權立場上是嚴格的改善（從「完全沒有授權欄位、受 Trimble ToS 管轄」
變成「明文 CC BY 4.0 + 具名作者 + 標示義務已履行」）。
但本專案**未取得法律意見**，也不主張上游鏈條已窮盡查證。
另外請注意 §5：Toyota 對車體造型本身另有設計權，與模型授權是兩件事。

---

## 4. 未隨本 repo 散布的素材（已 gitignore）

以下檔案存在於工作目錄，但**不在版控中**，不隨本 repo 散布：

### 4.1 三顆 3D Warehouse 模型

| 檔名 | 來源 | 授權 |
|---|---|---|
| `model-corolla-cross-3dw-ghost.glb` | [3D Warehouse `ad1d6e84…`](https://3dwarehouse.sketchup.com/model/ad1d6e84-a35d-484c-a9ab-f608e68fb34a) | 未確認，Trimble ToS |
| `model-corolla-cross-hybrid-3dw.glb` | [3D Warehouse `0b7097f4…`](https://3dwarehouse.sketchup.com/model/0b7097f4-776b-433b-bf8d-dfe1a83ff442) | 未確認，Trimble ToS |
| `model-corolla-altis-3dw-carsoftaiwan.glb` | [3D Warehouse `e75a6860…`](https://3dwarehouse.sketchup.com/model/e75a6860-662b-44ed-905c-09a48ed9c623) | 未確認，Trimble ToS |

三者 API 皆未回傳 license／copyright 欄位，非 CC 授權，**不可在公開 repo 再散布**。

### 4.2 `shape/` 目錄 —— 官方行銷圖，All rights reserved

`shape/` 下 24 個 PNG 為**車廠與租賃業者的官方行銷影像**，屬 all-rights-reserved：

| 群組 | 內容 | 取得來源 | 版權人 |
|---|---|---|---|
| `altis-360-*.png`、`cc-360-*.png`（16 張） | Toyota 台灣官網 360° 環景檢視器的去背影格（1180×400 RGBA，alpha 去背） | `https://hotaicdn.azureedge.net/toyotaweb/360EXT…_{frame}.png` | Toyota／和泰汽車 |
| `irent-*.png`（6 張） | iRent 全車系棚拍去背圖（741×457，車牌位置印有 iRent 標誌） | `https://www.irentcar.com.tw/marketing/irent/2512/images/{a,b,c}-car-NN.png` | 和泰／iRent |
| `priusc-still-lf.png`、`yaris-still-lf.png` | 同一 CDN 的官方去背棚拍圖 | `https://hotaicdn.azureedge.net/toyotaweb/COLOR_*.png` | Toyota／和泰汽車 |

三組全部直接取自**車廠與租賃業者的官方 CDN／行銷網站**，
**沒有任何授權允許再散布**，也沒有任何取得授權的紀錄。

> **取得當下的原始指示即已載明不可再散布：**
> 「版權注意：`hotai-irent` 是 public repo。**這些原廠圖不可再散布。**」
> 此立場與 commit `2c84c2e`（`chore: exclude car reference research assets from version control`）一致。

它們是本專案的客戶（和泰／iRent）與車廠的自有資產，把它們推上公開 GitHub repo
是明確的著作權風險，因此**維持 gitignore、不進版控**。

> 需要這批圖時請從內部管道取得，或由和泰正式授權後再納入。
> 上表的 URL 僅為**出處紀錄**（說明這批檔案從何而來、為何不散布），不構成再散布授權。

---

## 5. 車體造型本身的設計權

Toyota 對 Corolla Cross／Altis 的車體造型保有**設計權**。
上述所有 3D 模型皆為第三方仿製，**非原廠授權資產**。

本專案的最終產出是**抽象的虛線輪廓**（拍照引導疊圖），不重現車體外觀細節，風險低；
但這不等於可以散布模型或高擬真渲圖本身 —— 該界線正是 §3 與 §4 的分野所在。

---

## 6. 相關文件

- [`MANIFEST.md`](./MANIFEST.md) —— 本目錄素材的完整研究紀錄（相機參數、尺寸驗證、素材取捨）
- [`../guides/monk/NOTICE.md`](../guides/monk/NOTICE.md) —— Monk 引導疊圖的第三方聲明（BSD-3-Clause-Clear）
