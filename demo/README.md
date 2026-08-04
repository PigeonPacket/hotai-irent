# PIG-5 PoC｜車況拍照引導

和泰 iRent 黑客松 — 前端概念驗證，對應 [PIG-13 UX Flow](../docs/PIG-13-UX-Flow.md) Screen 1。

## 功能

- 四角拍攝流程（左前 / 右前 / 左後 / 右後 45°）
- 相機畫面疊加**虛線車身輪廓**引導（參考 WeMo / GoShare）
- **非阻擋式**品質提示（光線、過曝、可能模糊）
- 積分動機 UI（防禦 + 獎勵文案）
- 可「先繼續」跳過（積分較少）

## 啟動

需 HTTPS 或 localhost 才能使用相機 API。

```bash
cd demo
python3 -m http.server 8080
```

手機與電腦同一網段時，用手機瀏覽器開 `http://<你的IP>:8080`。

## 後續（PIG-6）

- `btn-finish` 後將 `captures` POST 至後端 Vision API
- 依車型載入不同 SVG 輪廓模板
- 還車流程複用同一元件，切換 `phase: "return"`
