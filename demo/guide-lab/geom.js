/**
 * guide-lab / geom.js —— 相機模型 + 近似重投影
 *
 * 這支檔案是整頁的幾何核心，跟 demo/src/ 完全獨立（刻意不共用，避免與其他 agent 衝突）。
 *
 * ── 相機模型（已對 build-report.json 驗證過）─────────────────────────
 *   世界座標：Y 向上、車頭朝 +Z、原點在車體中心的地面投影點。
 *   eye    = [d·sin(az), h, d·cos(az)]        d = 水平距離、h = 相機高
 *   target = build-report.json 的 target_xyz  （各角度固定，等於「把車放在畫面中央」）
 *   hFOV   = 2·atan(18 / f_mm)   vFOV = 2·atan(13.5 / f_mm)   （36×27 全片幅等效、4:3）
 *
 *   驗證：把 guide-cuv-*.svg 的 #ground 兩個接地十字用上式反投影到 y=0 平面，
 *         四個角度都得到 |x| = 0.783 m、z = +1.266 / −1.363 m，
 *         兩點距離 2.628 m ↔ Corolla Cross 軸距 2.640 m（誤差 0.4%）。
 *         → 相機模型與 SVG 完全吻合，不是猜的。
 *
 * ── 為什麼是「近似」重投影 ────────────────────────────────────────
 *   SVG 只有 2D 點，沒有逐點深度，所以無法做真正的 3D 重投影
 *   （真做要在瀏覽器載入 38 MB GLB + three.js，違反零依賴）。
 *   這裡用 **代理幾何 + 單應性（homography）**：
 *     1. 用車輛外接框（實測接地點校準過的真實尺寸）取樣可見表面 + 地面足跡；
 *     2. 這些 3D 點在「基準相機」與「目前相機」各投影一次；
 *     3. 用加權最小平方解出 3×3 homography，套到 SVG 的每一個點。
 *   性質：基準值時恆等（誤差為 0）、地面線幾乎精確（足跡點權重最高）、
 *         車身面因為深度變化只有一階近似。判讀「站位對不對」夠用，
 *         但不要拿它當最終幾何來源。
 */

export const VB = { w: 500, h: 375 };

/** Toyota Corolla Cross XG10 —— 尺寸取自 MANIFEST，軸距位置由 SVG 接地點反算 */
export const CAR = {
  halfW: 0.9125,      // 車寬 1825 mm / 2
  height: 1.62,       // 車高
  zFront: 2.206,      // 前保桿（前軸 +1.266 + 前懸 0.94）
  zRear: -2.243,      // 後保桿（後軸 −1.363 − 後懸 0.88）
  halfTrack: 0.783,   // 由 SVG 接地點反投影實測
  zAxleFront: 1.266,
  zAxleRear: -1.363,
  wheelCy: 0.341,     // 225/50R18 輪胎半徑
  archR: 0.42,        // 輪拱判定半徑
  beltY: 1.1,         // 腰線（車窗下緣）高度 —— 車窗帶分群用
};

/** 各角度的基準方位角：滑桿值 v（30–60）→ 世界方位角 */
export function azimuthFor(corner, yawDeg) {
  if (corner === "lf") return yawDeg;
  if (corner === "rf") return 360 - yawDeg;
  if (corner === "lr") return 180 - yawDeg;
  return 180 + yawDeg; // rr
}

export function fovFromFocal(focalMm) {
  return {
    hfov: 2 * (Math.atan(18 / focalMm) * 180) / Math.PI,
    vfov: 2 * (Math.atan(13.5 / focalMm) * 180) / Math.PI,
  };
}

const rad = (d) => (d * Math.PI) / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(a) {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
}

/**
 * 建立一組相機。
 * @param {object} p
 * @param {string} p.corner   lf|rf|lr|rr
 * @param {number} p.distance 水平距離 m
 * @param {number} p.height   相機高 m
 * @param {number} p.yaw      偏擺角 deg（30–60，45 為基準）
 * @param {number} p.focal    等效焦距 mm
 * @param {number[]} p.target 注視點（世界座標，取自 build-report）
 */
export function makeCam({ corner, distance, height, yaw, focal, target }) {
  const az = azimuthFor(corner, yaw);
  const eye = [distance * Math.sin(rad(az)), height, distance * Math.cos(rad(az))];
  const { hfov, vfov } = fovFromFocal(focal);
  const fwd = unit(sub(target, eye));
  const right = unit(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const th = Math.tan(rad(hfov / 2));
  const tv = Math.tan(rad(vfov / 2));

  function project(P) {
    const d = sub(P, eye);
    const z = dot(d, fwd);
    if (z <= 1e-4) return null;
    return [
      ((dot(d, right) / z / th) + 1) / 2 * VB.w,
      (1 - dot(d, up) / z / tv) / 2 * VB.h,
    ];
  }

  // 地平線：視線方向分量 y=0 的那條水平線 —— 它永遠等於「相機高度」在畫面上的位置。
  // 判斷手機拿太高／太低最快的線索。
  const horizonY = (VB.h / 2) * (1 + fwd[1] / (up[1] * tv));

  return {
    corner, distance, height, yaw, focal, az, eye, target,
    hfov, vfov, fwd, right, up, th, tv, project, horizonY,
    depression: (Math.atan2(eye[1] - target[1], Math.hypot(eye[0] - target[0], eye[2] - target[2])) * 180) / Math.PI,
  };
}

/** 代理取樣點：可見的兩個立面 + 地面足跡 + 兩個實測接地點（權重最高） */
export function proxyPoints(baseAz) {
  const sx = Math.sin(rad(baseAz)) >= 0 ? 1 : -1;
  const sz = Math.cos(rad(baseAz)) >= 0 ? 1 : -1;
  const faceZ = sz > 0 ? CAR.zFront : CAR.zRear;
  const pts = [];
  const push = (P, w) => pts.push({ P, w });

  // 側面（x = ±halfW）
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 3; j++) {
      const z = CAR.zRear + ((CAR.zFront - CAR.zRear) * i) / 4;
      const y = (CAR.height * j) / 3;
      push([sx * CAR.halfW, y, z], 1);
    }
  }
  // 車頭／車尾面（z = faceZ）
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j <= 3; j++) {
      push([-CAR.halfW + (2 * CAR.halfW * i) / 3, (CAR.height * j) / 3, faceZ], 1);
    }
  }
  // 地面足跡（判讀站位最重要的區域 → 權重加倍）
  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= 2; j++) {
      push([-CAR.halfW + (2 * CAR.halfW * i) / 2, 0, CAR.zRear + ((CAR.zFront - CAR.zRear) * j) / 2], 2);
    }
  }
  // 近側兩個實測接地點
  push([sx * CAR.halfTrack, 0, CAR.zAxleFront], 3);
  push([sx * CAR.halfTrack, 0, CAR.zAxleRear], 3);
  return pts;
}

/** 近側四個輪心（前兩個是可見側，後兩個是對側，半徑打折） */
export function wheelCenters(baseAz) {
  const sx = Math.sin(rad(baseAz)) >= 0 ? 1 : -1;
  return [
    { P: [sx * CAR.halfTrack, CAR.wheelCy, CAR.zAxleFront], k: 1 },
    { P: [sx * CAR.halfTrack, CAR.wheelCy, CAR.zAxleRear], k: 1 },
    { P: [-sx * CAR.halfTrack, CAR.wheelCy, CAR.zAxleFront], k: 0.6 },
    { P: [-sx * CAR.halfTrack, CAR.wheelCy, CAR.zAxleRear], k: 0.6 },
  ];
}

/** 腰線在畫面上的取樣點（用來判斷「這條線在車窗帶嗎」） */
export function beltRing(baseAz) {
  const sz = Math.cos(rad(baseAz)) >= 0 ? 1 : -1;
  const faceZ = sz > 0 ? CAR.zFront : CAR.zRear;
  const out = [];
  const N = 20;
  for (let i = 0; i <= N; i++) out.push([-CAR.halfW + (2 * CAR.halfW * i) / N, CAR.beltY, faceZ]);
  for (let i = 0; i <= N; i++) {
    const z = CAR.zRear + ((CAR.zFront - CAR.zRear) * i) / N;
    out.push([CAR.halfW, CAR.beltY, z]);
    out.push([-CAR.halfW, CAR.beltY, z]);
  }
  return out;
}

/* ────────────────────────────── homography ────────────────────────────── */

/** 高斯消去（含部分主元），解 A·x = b。A 為 n×n 的 row-major 陣列。 */
function solve(A, b, n) {
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

const NX = VB.w / 2;   // 正規化：把畫面座標壓到 ~[-1,1]，改善條件數
const NY = VB.h / 2;
const nrm = (p) => [(p[0] - NX) / NX, (p[1] - NY) / NY];

/**
 * 從對應點解單應性矩陣。
 * @param {Array<{s:number[],d:number[],w:number}>} pairs s=基準投影、d=目標投影
 * @returns {number[]|null} 8 個係數（h33 固定 1，座標為正規化空間）
 */
export function fitHomography(pairs) {
  const A = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const b = new Array(8).fill(0);
  for (const { s, d, w } of pairs) {
    const [x, y] = nrm(s);
    const [X, Y] = nrm(d);
    const rows = [
      [x, y, 1, 0, 0, 0, -x * X, -y * X, X],
      [0, 0, 0, x, y, 1, -x * Y, -y * Y, Y],
    ];
    for (const r of rows) {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) A[i][j] += w * r[i] * r[j];
        b[i] += w * r[i] * r[8];
      }
    }
  }
  for (let i = 0; i < 8; i++) A[i][i] += 1e-9; // ridge，避免退化
  return solve(A, b, 8);
}

/** 把畫面座標 [x,y] 套上 homography（進出都是 SVG viewBox 座標） */
export function applyH(h, p) {
  if (!h) return p;
  const x = (p[0] - NX) / NX;
  const y = (p[1] - NY) / NY;
  const w = h[6] * x + h[7] * y + 1;
  if (Math.abs(w) < 1e-9) return p;
  return [
    ((h[0] * x + h[1] * y + h[2]) / w) * NX + NX,
    ((h[3] * x + h[4] * y + h[5]) / w) * NY + NY,
  ];
}

/**
 * 建立「基準相機 → 目前相機」的近似變換。
 * @returns {{h:number[]|null, dev:{mean:number,max:number}}}
 *          dev = 車輛外接框八個角點的位移量，佔基準車寬的百分比。
 */
export function buildWarp(baseCam, cam) {
  const pairs = [];
  for (const { P, w } of proxyPoints(baseCam.az)) {
    const s = baseCam.project(P);
    const d = cam.project(P);
    if (s && d) pairs.push({ s, d, w });
  }
  const h = pairs.length >= 6 ? fitHomography(pairs) : null;

  // 敏感度讀數：外接框角點位移 / 基準車寬
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [0, 1]) {
      for (const sz of [CAR.zRear, CAR.zFront]) corners.push([sx * CAR.halfW, sy * CAR.height, sz]);
    }
  }
  let sum = 0, max = 0, n = 0, minX = Infinity, maxX = -Infinity;
  for (const P of corners) {
    const s = baseCam.project(P);
    const d = cam.project(P);
    if (!s || !d) continue;
    minX = Math.min(minX, s[0]);
    maxX = Math.max(maxX, s[0]);
    const e = Math.hypot(d[0] - s[0], d[1] - s[1]);
    sum += e; max = Math.max(max, e); n++;
  }
  const wpx = maxX - minX || VB.w;

  return {
    h,
    dev: { mean: n ? (sum / n / wpx) * 100 : 0, max: (max / wpx) * 100 },
    approxErrPx: approxError(baseCam, cam),
  };
}

/**
 * 這組 warp 大概錯多少（viewBox px，畫面寬 500）。
 *
 * 係數是實測校準出來的：用一個「車形」代理實體（圓角平面輪廓、腰線以上內縮、
 * 前後端收窄）產生表面點，跟本檔的 homography 結果比對平均誤差，得到
 *     偏擺 ±15° → 16.4 px    距離 ±0.65 m → 6.0 px    相機高 ±0.4 m → 5.7 px
 *     等效焦距 → 0 px（純 FOV 變化，homography 可精確表示）
 * 線性化後即為下列係數。
 *
 * ⚠ 偏擺是最弱的一軸：2D 變換本質上無法把 3D 物體轉過去。
 *    偏擺離 45° 越遠，疊圖形狀越不可信，UI 上要講出來。
 */
export function approxError(baseCam, cam) {
  return (
    0.9 * Math.abs(cam.yaw - baseCam.yaw) +
    8 * Math.abs(cam.distance - baseCam.distance) +
    12 * Math.abs(cam.height - baseCam.height)
  );
}
