/**
 * PIG-5 PoC: iRent 車況拍照引導
 * 四角拍攝 + 虛線輪廓 overlay + 輕量品質提示
 */

const CORNERS = [
  {
    id: "lf",
    label: "左前 45°",
    hint: "請站在車輛左前方，對準虛線輪廓",
    guide: "leftFront",
  },
  {
    id: "rf",
    label: "右前 45°",
    hint: "請站在車輛右前方，對準虛線輪廓",
    guide: "rightFront",
  },
  {
    id: "lr",
    label: "左後 45°",
    hint: "請站在車輛左後方，對準虛線輪廓",
    guide: "leftRear",
  },
  {
    id: "rr",
    label: "右後 45°",
    hint: "請站在車輛右後方，對準虛線輪廓",
    guide: "rightRear",
  },
];

const GUIDES = {
  leftFront: `
    <path class="guide-stroke" d="M -70 -20 L -95 40 L -60 95 L 20 110 L 75 70 L 85 10 L 40 -35 Z" />
    <path class="guide-fill" d="M -55 -5 L -75 35 L -45 80 L 10 90 L 55 55 L 60 15 L 25 -20 Z" />
    <text class="guide-sublabel" x="0" y="130" text-anchor="middle">左前輪廓引導</text>
  `,
  rightFront: `
    <path class="guide-stroke" d="M 70 -20 L 95 40 L 60 95 L -20 110 L -75 70 L -85 10 L -40 -35 Z" />
    <path class="guide-fill" d="M 55 -5 L 75 35 L 45 80 L -10 90 L -55 55 L -60 15 L -25 -20 Z" />
    <text class="guide-sublabel" x="0" y="130" text-anchor="middle">右前輪廓引導</text>
  `,
  leftRear: `
    <path class="guide-stroke" d="M -75 10 L -90 70 L -50 115 L 30 105 L 80 50 L 70 -10 L 20 -40 Z" />
    <path class="guide-fill" d="M -58 20 L -70 65 L -38 98 L 15 90 L 55 48 L 48 0 L 12 -25 Z" />
    <text class="guide-sublabel" x="0" y="130" text-anchor="middle">左後輪廓引導</text>
  `,
  rightRear: `
    <path class="guide-stroke" d="M 75 10 L 90 70 L 50 115 L -30 105 L -80 50 L -70 -10 L -20 -40 Z" />
    <path class="guide-fill" d="M 58 20 L 70 65 L 38 98 L -15 90 L -55 48 L -48 0 L -12 -25 Z" />
    <text class="guide-sublabel" x="0" y="130" text-anchor="middle">右後輪廓引導</text>
  `,
};

const state = {
  step: 0,
  captures: [],
  pendingBlob: null,
  stream: null,
};

const els = {
  video: document.getElementById("video"),
  canvas: document.getElementById("capture-canvas"),
  guideGroup: document.getElementById("guide-group"),
  guideLabel: document.getElementById("guide-label"),
  qualityHint: document.getElementById("quality-hint"),
  progressBar: document.getElementById("progress-bar"),
  steps: document.getElementById("steps"),
  preview: document.getElementById("preview"),
  previewImg: document.getElementById("preview-img"),
  previewCaption: document.getElementById("preview-caption"),
  gallery: document.getElementById("gallery"),
  thumbs: document.getElementById("thumbs"),
  btnCapture: document.getElementById("btn-capture"),
  btnSkip: document.getElementById("btn-skip"),
  btnRetake: document.getElementById("btn-retake"),
  btnNext: document.getElementById("btn-next"),
  btnFinish: document.getElementById("btn-finish"),
  cameraWrap: document.querySelector(".camera-wrap"),
  actions: document.querySelector(".actions"),
};

function initSteps() {
  els.steps.innerHTML = CORNERS.map(
    (c, i) => `<li data-step="${i}">${c.label}</li>`
  ).join("");
}

function updateUI() {
  const corner = CORNERS[state.step];
  const pct = (state.step / CORNERS.length) * 100;
  els.progressBar.style.setProperty("--pct", `${pct}%`);
  els.guideLabel.textContent = `${state.step + 1}/${CORNERS.length} · ${corner.label}`;
  els.guideGroup.innerHTML = GUIDES[corner.guide];
  els.previewCaption.textContent = corner.hint;

  [...els.steps.children].forEach((li, i) => {
    li.classList.toggle("active", i === state.step);
    li.classList.toggle("done", i < state.step);
  });

  if (state.step >= CORNERS.length) {
    showGallery();
  }
}

function analyzeFrame(video, canvas) {
  const w = 160;
  const h = Math.round((video.videoHeight / video.videoWidth) * w) || 120;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let sum = 0;
  let dark = 0;
  let bright = 0;
  const pixels = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += lum;
    if (lum < 40) dark++;
    if (lum > 220) bright++;
  }

  const avg = sum / pixels;
  const darkRatio = dark / pixels;
  const brightRatio = bright / pixels;

  const issues = [];
  if (avg < 55 || darkRatio > 0.45) issues.push("光線偏暗，建議移到較亮處或開啟手電筒");
  if (brightRatio > 0.25) issues.push("畫面過曝，請避開直射光源");
  if (avg > 30 && avg < 200) {
    let variance = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      variance += (lum - avg) ** 2;
    }
    variance /= pixels;
    if (variance < 120) issues.push("畫面可能模糊，請對焦後再拍");
  }

  return { ok: issues.length === 0, issues, avg };
}

function showQualityHint(result) {
  els.qualityHint.classList.remove("hidden", "ok");
  if (result.ok) {
    els.qualityHint.classList.add("ok");
    els.qualityHint.textContent = "✓ 光線與清晰度良好，可以拍攝";
  } else {
    els.qualityHint.textContent = "⚠ " + result.issues.join("；");
  }
}

async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    els.video.srcObject = state.stream;
    await els.video.play();
    loopQualityCheck();
  } catch (err) {
    els.qualityHint.classList.remove("hidden");
    els.qualityHint.textContent =
      "無法啟用相機：" + err.message + "。請用 HTTPS 或 localhost 開啟。";
  }
}

let qualityTimer;
function loopQualityCheck() {
  clearInterval(qualityTimer);
  qualityTimer = setInterval(() => {
    if (!els.preview.classList.contains("hidden")) return;
    if (els.video.readyState < 2) return;
    const result = analyzeFrame(els.video, els.canvas);
    showQualityHint(result);
  }, 800);
}

function capturePhoto() {
  const video = els.video;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve({ blob, dataUrl: canvas.toDataURL("image/jpeg", 0.85) }), "image/jpeg", 0.85);
  });
}

async function onCapture() {
  const { blob, dataUrl } = await capturePhoto();
  state.pendingBlob = { blob, dataUrl, quality: analyzeFrame(els.video, els.canvas) };
  els.previewImg.src = dataUrl;
  els.preview.classList.remove("hidden");
  els.cameraWrap.classList.add("hidden");
  els.btnCapture.classList.add("hidden");
  els.btnSkip.classList.add("hidden");
  els.btnRetake.classList.remove("hidden");
  els.btnNext.classList.remove("hidden");
  els.qualityHint.classList.add("hidden");
}

function onRetake() {
  state.pendingBlob = null;
  els.preview.classList.add("hidden");
  els.cameraWrap.classList.remove("hidden");
  els.btnCapture.classList.remove("hidden");
  els.btnSkip.classList.remove("hidden");
  els.btnRetake.classList.add("hidden");
  els.btnNext.classList.add("hidden");
}

function commitCapture(skipped = false) {
  const corner = CORNERS[state.step];
  const entry = {
    corner: corner.label,
    skipped,
    qualityOk: state.pendingBlob?.quality?.ok ?? false,
    dataUrl: state.pendingBlob?.dataUrl ?? null,
  };
  state.captures.push(entry);
  state.pendingBlob = null;
  state.step += 1;
  onRetake();
  updateUI();
}

function showGallery() {
  els.cameraWrap.classList.add("hidden");
  els.preview.classList.add("hidden");
  els.actions.classList.add("hidden");
  els.motivation = document.getElementById("motivation");
  if (els.motivation) els.motivation.classList.add("hidden");
  els.gallery.classList.remove("hidden");
  els.progressBar.style.setProperty("--pct", "100%");

  const score = state.captures.reduce((s, c) => {
    if (c.skipped) return s + 5;
    if (c.qualityOk) return s + 20;
    return s + 10;
  }, 0);

  document.getElementById("phase-subtitle").textContent =
    `已完成 ${state.captures.length} 張 · 預估積分 +${score}`;

  els.thumbs.innerHTML = state.captures
    .map(
      (c) => `
    <div class="thumb">
      ${c.dataUrl ? `<img src="${c.dataUrl}" alt="${c.corner}" />` : `<div style="aspect-ratio:1;background:#222"></div>`}
      <span>${c.corner}${c.skipped ? "（跳過）" : c.qualityOk ? " ✓" : ""}</span>
    </div>`
    )
    .join("");
}

els.btnCapture.addEventListener("click", onCapture);
els.btnRetake.addEventListener("click", onRetake);
els.btnNext.addEventListener("click", () => commitCapture(false));
els.btnSkip.addEventListener("click", () => {
  state.pendingBlob = null;
  commitCapture(true);
});
els.btnFinish.addEventListener("click", () => {
  const payload = {
    phase: "pickup",
    captures: state.captures,
    timestamp: new Date().toISOString(),
  };
  console.log("PIG-5 capture session:", payload);
  alert("拍照流程完成（PoC）。資料已輸出至 console，後續接 PIG-6 API。");
});

initSteps();
updateUI();
startCamera();
