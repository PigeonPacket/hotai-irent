/**
 * Screen 1 / Screen 4 —— 四角引導拍照（PIG-13 §3 Screen 1 與 Screen 4 共用同一套 UI）。
 *
 * Wave 1：**原樣搬遷** PoC 的拍照流程，只多了 phase 切換與 state/points 接線。
 * 路由：#/capture?phase=pickup（取車）｜#/capture?phase=return（還車）
 */

import { CORNERS, GUIDE_CSS, getGuide } from "../guides.js";
import { createCamera } from "../camera.js";
import { CAPTURE_CATEGORIES, EVENTS } from "../state.js";
import { escapeHtml } from "../util.js";

export const id = "capture";
export const title = "車況拍照";

/** 跳頁列：同一個畫面兩個入口（order 見 CONTRACT.md 的流程槽位表） */
export const nav = [
  { label: "取車拍照", params: { phase: "pickup" }, order: 20 },
  { label: "還車拍照", params: { phase: "return" }, order: 50 },
];

const COPY = {
  pickup: {
    title: "取車 · 車況拍照",
    subtitle: "請依引導拍攝車身四角，建立租前存證",
    motivation: [
      { icon: "🛡️", text: "認真拍照可保護你免於還車爭議" },
      { icon: "⭐", text: "完整四角拍照 <strong>+20 積分</strong>" },
    ],
    finish: "完成取車拍照",
    next: "supplement",
  },
  return: {
    title: "還車 · 車況拍照",
    subtitle: "還車前拍照，證明你交還時車況正常",
    motivation: [
      { icon: "🛡️", text: "還車前拍照，證明你交還時車況正常" },
      { icon: "⭐", text: "完整拍照 <strong>+20 積分</strong>" },
    ],
    finish: "完成還車拍照，開始 AI 比對",
    next: "compare",
  },
};

export const css = `
${GUIDE_CSS}
.motivation {
  background: linear-gradient(135deg, #1e3a4f, #1a2332);
  border: 1px solid #2a3f55;
  border-radius: var(--radius);
  padding: 10px 12px;
  margin: 12px 0;
  font-size: 13px;
}
.motivation p {
  margin: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.motivation strong { color: var(--accent); }

.camera-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--radius);
  overflow: hidden;
  background: #000;
  border: 1px solid #2a3545;
}
.camera-view,
.camera-mock {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.camera-view[hidden],
.camera-mock[hidden] { display: none; }

.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.overlay-dim { fill: rgba(0, 0, 0, 0.35); }

.quality-hint {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.35;
  background: rgba(245, 166, 35, 0.92);
  color: #1a1200;
}
.quality-hint.ok {
  background: rgba(0, 194, 168, 0.9);
  color: #002820;
}

.mock-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(245, 166, 35, 0.92);
  color: #1a1200;
}

.preview {
  margin-top: 10px;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid #2a3545;
}
.preview img {
  width: 100%;
  display: block;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
.preview-caption {
  margin: 0;
  padding: 8px 10px;
  font-size: 12px;
  background: var(--surface);
  color: var(--muted);
}

.capture-gallery { margin-top: 16px; }
.capture-gallery h2 { font-size: 16px; margin: 0 0 8px; }
`;

export function mount(root, ctx) {
  const { state, points, config } = ctx;
  const phase = ctx.params.phase === "return" ? "return" : "pickup";
  const group = phase; // pickup → pickupCaptures / return → returnCaptures
  const copy = COPY[phase];
  const modelId = state.session.vehicle?.modelId;

  state.setPhase(phase);
  ctx.setHeader({ title: copy.title, subtitle: copy.subtitle });

  root.innerHTML = `
    <div class="motivation" data-el="motivation">
      ${copy.motivation.map((m) => `<p><span class="icon">${m.icon}</span> ${m.text}</p>`).join("")}
    </div>

    <div class="progress">
      <div class="progress-bar" data-el="progressBar"></div>
      <ol class="steps" data-el="steps"></ol>
    </div>

    <div class="camera-wrap" data-el="cameraWrap">
      <video class="camera-view" data-el="video" playsinline autoplay muted></video>
      <canvas class="camera-mock" data-el="mockCanvas" hidden></canvas>
      <canvas data-el="scratchCanvas" hidden></canvas>
      <svg class="overlay" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice">
        <rect class="overlay-dim" width="360" height="640" />
        <g data-el="guideGroup" transform="translate(180, 340)"></g>
        <text class="guide-label" data-el="guideLabel" x="180" y="80" text-anchor="middle"></text>
      </svg>
      <div class="quality-hint hidden" data-el="qualityHint"></div>
      <div class="mock-badge hidden" data-el="mockBadge">模擬相機（可繼續操作）</div>
    </div>

    <div class="preview hidden" data-el="preview">
      <img data-el="previewImg" alt="預覽" />
      <p class="preview-caption" data-el="previewCaption"></p>
    </div>

    <div class="actions" data-el="actions">
      <button type="button" class="btn secondary" data-el="btnSkip">先繼續（積分較少）</button>
      <button type="button" class="btn primary" data-el="btnCapture">拍攝</button>
      <button type="button" class="btn primary hidden" data-el="btnRetake">重拍這張</button>
      <button type="button" class="btn primary hidden" data-el="btnNext">確認，下一角</button>
    </div>

    <div class="capture-gallery hidden" data-el="gallery">
      <h2>已完成照片</h2>
      <div class="thumbs" data-el="thumbs"></div>
      <div class="actions">
        <button type="button" class="btn primary full" data-el="btnFinish">${escapeHtml(copy.finish)}</button>
        <button type="button" class="btn secondary" data-el="btnRedo">重新拍攝這一段</button>
      </div>
    </div>
  `;

  const els = {};
  root.querySelectorAll("[data-el]").forEach((node) => {
    els[node.dataset.el] = node;
  });

  const local = { step: state.getCaptures(group).length, pending: null, busy: false };

  // ------------------------------------------------------------- UI

  els.steps.innerHTML = CORNERS.map(
    (c, i) => `<li data-step="${i}">${escapeHtml(c.label)}</li>`
  ).join("");

  function showQualityHint(result) {
    els.qualityHint.classList.remove("hidden", "ok");
    if (result.ok) {
      els.qualityHint.classList.add("ok");
      els.qualityHint.textContent = "✓ 光線與清晰度良好，可以拍攝";
    } else {
      els.qualityHint.textContent = "⚠ " + result.issues.join("；");
    }
  }

  function updateUI() {
    const done = local.step >= CORNERS.length;
    const pct = (Math.min(local.step, CORNERS.length) / CORNERS.length) * 100;
    els.progressBar.style.setProperty("--pct", `${pct}%`);

    [...els.steps.children].forEach((li, i) => {
      li.classList.toggle("active", i === local.step);
      li.classList.toggle("done", i < local.step);
    });

    if (done) {
      showGallery();
      return;
    }

    const corner = CORNERS[local.step];
    els.guideLabel.textContent = `${local.step + 1}/${CORNERS.length} · ${corner.label}`;
    els.guideGroup.innerHTML = getGuide(modelId, corner.id).svg;
    els.previewCaption.textContent = corner.hint;
    camera.setCorner(corner.id, corner.label);
  }

  function showGallery() {
    const captures = state.getCaptures(group);
    els.cameraWrap.classList.add("hidden");
    els.preview.classList.add("hidden");
    els.actions.classList.add("hidden");
    els.motivation.classList.add("hidden");
    els.gallery.classList.remove("hidden");
    els.progressBar.style.setProperty("--pct", "100%");
    camera.stop();

    const estimate = points.estimateCaptureSetPoints(phase, captures, CORNERS.length);
    ctx.setHeader({
      subtitle: `已完成 ${captures.length} 張 · 預估積分 +${estimate.points}（${estimate.label}）`,
    });

    els.thumbs.innerHTML = captures
      .map((c) => {
        const src = c.fullDataUrl || c.dataUrl;
        const badge = c.skipped ? "（跳過）" : c.quality?.ok ? " ✓" : "";
        return `
          <div class="thumb">
            ${
              src
                ? `<img src="${src}" alt="${escapeHtml(c.label)}" />`
                : `<div class="thumb-empty"></div>`
            }
            <span>${escapeHtml(c.label)}${badge}</span>
          </div>`;
      })
      .join("");
  }

  function enterPreview(dataUrl) {
    els.previewImg.src = dataUrl;
    els.preview.classList.remove("hidden");
    els.cameraWrap.classList.add("hidden");
    els.btnCapture.classList.add("hidden");
    els.btnSkip.classList.add("hidden");
    els.btnRetake.classList.remove("hidden");
    els.btnNext.classList.remove("hidden");
    els.qualityHint.classList.add("hidden");
    camera.pauseQuality();
  }

  function exitPreview() {
    local.pending = null;
    els.preview.classList.add("hidden");
    els.cameraWrap.classList.remove("hidden");
    els.btnCapture.classList.remove("hidden");
    els.btnSkip.classList.remove("hidden");
    els.btnRetake.classList.add("hidden");
    els.btnNext.classList.add("hidden");
    camera.resumeQuality();
  }

  // ------------------------------------------------------------- 流程

  async function onCapture() {
    if (local.step >= CORNERS.length || local.busy) return;
    local.busy = true;
    els.btnCapture.disabled = true;
    try {
      const shot = await camera.capture();
      if (local.step >= CORNERS.length) return; // 期間已完成 → 丟棄
      local.pending = shot;
      enterPreview(shot.dataUrl);
    } finally {
      local.busy = false;
      els.btnCapture.disabled = false;
    }
  }

  async function commitCapture(skipped) {
    // 防連點 / 防在 gallery 狀態下誤觸（隱藏的按鈕仍然收得到 click）
    if (local.step >= CORNERS.length || local.busy) return;
    if (!skipped && !local.pending) return;
    const corner = CORNERS[local.step];
    local.busy = true;
    els.btnNext.disabled = true;
    els.btnSkip.disabled = true;
    try {
      const record = await state.addCapture(group, {
        angle: corner.id,
        category: CAPTURE_CATEGORIES.CORNER,
        label: corner.label,
        skipped,
        quality: skipped ? null : local.pending?.quality ?? null,
        fullDataUrl: skipped ? null : local.pending?.dataUrl ?? null,
        meta: { source: local.pending?.mode || camera.mode },
      });
      state.addEvent(
        phase === "pickup" ? EVENTS.PICKUP_CAPTURE : EVENTS.RETURN_CAPTURE,
        {
          label: `${corner.label}${skipped ? "（跳過）" : record.quality?.ok ? "（品質達標）" : "（有品質警告）"}`,
          angle: corner.id,
          photoId: record.id,
          skipped,
        }
      );
      local.step += 1;
      if (local.step >= CORNERS.length) awardSetPoints();
      exitPreview();
      updateUI();
    } finally {
      local.busy = false;
      els.btnNext.disabled = false;
      els.btnSkip.disabled = false;
    }
  }

  function awardSetPoints() {
    const captures = state.getCaptures(group);
    const { rule, qualified } = points.evaluateCaptureSet(phase, captures, CORNERS.length);
    if (rule) state.awardPoints(rule.id, { group });
    state.addEvent(phase === "pickup" ? EVENTS.PICKUP_COMPLETE : EVENTS.RETURN_COMPLETE, {
      label: qualified ? "四角拍照完整且品質達標" : "四角拍照完成（有品質警告或跳過）",
      qualified,
      count: captures.length,
    });
  }

  function onFinish() {
    if (ctx.router.isRegistered(copy.next)) {
      ctx.go(copy.next);
      return;
    }
    // Wave 2 的下一個畫面還沒實作 → 維持 PoC 的行為
    console.log("PIG-5 capture session:", {
      phase,
      captures: state.getCaptures(group),
      points: state.session.points,
      timeline: state.session.timeline,
    });
    alert(
      `${copy.title}完成（Wave 1 骨架）。\n` +
        `目前累積積分：${state.totalPoints()}\n` +
        `下一個畫面「#/${copy.next}」尚未實作，資料已輸出至 console。`
    );
  }

  function onRedo() {
    state.clearCaptures(group);
    local.step = 0;
    local.pending = null;
    els.gallery.classList.add("hidden");
    els.motivation.classList.remove("hidden");
    els.actions.classList.remove("hidden");
    els.cameraWrap.classList.remove("hidden");
    ctx.setHeader({ title: copy.title, subtitle: copy.subtitle });
    startCamera();
  }

  /** 啟動相機期間先鎖住「拍攝」，避免在還沒有畫面來源時就按下去。 */
  function startCamera() {
    els.btnCapture.disabled = true;
    updateUI();
    return camera.start().then(() => {
      els.btnCapture.disabled = false;
      updateUI();
    });
  }

  // ------------------------------------------------------------- 相機

  const camera = createCamera({
    video: els.video,
    mockCanvas: els.mockCanvas,
    scratchCanvas: els.scratchCanvas,
    onQuality: showQualityHint,
    onMode: (mode) => {
      els.mockBadge.classList.toggle("hidden", mode !== "mock");
    },
  });

  els.btnCapture.addEventListener("click", onCapture);
  els.btnRetake.addEventListener("click", exitPreview);
  els.btnNext.addEventListener("click", () => commitCapture(false));
  els.btnSkip.addEventListener("click", () => commitCapture(true));
  els.btnFinish.addEventListener("click", onFinish);
  els.btnRedo.addEventListener("click", onRedo);

  ctx.setFootnote(
    config.mock
      ? "模擬相機模式（?mock=1）。品質檢查為輕量啟發式，虛線輪廓為暫時版本。"
      : "需 HTTPS 或 localhost 才能啟用相機。品質檢查為輕量啟發式，虛線輪廓為暫時版本。"
  );

  if (local.step >= CORNERS.length) {
    showGallery();
  } else {
    startCamera();
  }

  // cleanup：關掉 MediaStream 與品質檢查 interval
  return () => camera.stop();
}
