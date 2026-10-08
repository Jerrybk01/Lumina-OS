/**
 * Background remove / replace.
 *
 * Primary matte comes from a neural matting model (see matte.js). The heuristic
 * trimap matte is kept as an instant preview and as the offline fallback.
 * Edge pixels are unmixed against a local estimate of the original background
 * so replaced backgrounds do not leave a colored fringe.
 */
const LuminaBg = (() => {
  const GRADIENTS = {
    sunset: ["#1a1028", "#c45c26", "#f0c27b"],
    studio: ["#1c1c1e", "#3a3a3c"],
    sky: ["#6eb6e8", "#cfe9f8", "#f7fafc"],
    forest: ["#0d1f14", "#1f4d2e", "#6b8f71"],
    neon: ["#0b1020", "#7b2cbf", "#00f5d4"],
  };

  const settings = {
    engine: "portrait",
    feather: 1,
    shift: 0,
    decontaminate: true,
  };

  /** Matte straight out of the model or the heuristic. */
  let base = { key: "", alpha: null, source: "" };
  /** Matte after edge shift + feather. */
  let refined = { key: "", alpha: null };
  /** Composited subject layer, cached against the pixels it was built from. */
  let subjectLayer = { srcRef: null, key: "", canvas: null };
  /** Downsampled silhouette + bounds, reused while the matte array is unchanged. */
  let silCache = { alpha: null, w: 0, h: 0, canvas: null, bounds: null };
  let reflCache = { subject: null, key: "", canvas: null };

  let job = null;
  let status = { state: "idle", pct: 0, label: "", source: "" };
  let listeners = [];

  function onStatus(fn) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((f) => f !== fn);
    };
  }

  function setStatus(next) {
    status = { ...status, ...next };
    listeners.forEach((fn) => fn(status));
  }

  function getStatus() {
    return status;
  }

  function getSettings() {
    return { ...settings };
  }

  /** Edge settings only invalidate the refine stage; engine invalidates the matte. */
  function setSettings(patch) {
    const engineChanged = patch.engine && patch.engine !== settings.engine;
    Object.assign(settings, patch);
    refined = { key: "", alpha: null };
    subjectLayer = { srcRef: null, key: "", canvas: null };
    if (engineChanged) base = { key: "", alpha: null, source: "" };
    return engineChanged;
  }

  function invalidate() {
    base = { key: "", alpha: null, source: "" };
    refined = { key: "", alpha: null };
    subjectLayer = { srcRef: null, key: "", canvas: null };
    silCache = { alpha: null, w: 0, h: 0, canvas: null, bounds: null };
    reflCache = { subject: null, key: "", canvas: null };
    job = null;
    setStatus({ state: "idle", pct: 0, label: "", source: "" });
  }

  function sceneKey(scene) {
    const face = scene.faces?.[0];
    return [
      "s1",
      settings.engine,
      scene.working.w,
      scene.working.h,
      scene.fileName || "",
      face ? [face.x, face.y, face.w, face.h].map((n) => n.toFixed(3)).join(",") : "none",
    ].join(":");
  }

  /**
   * Kick off matting for a scene. Resolves once the best available matte is in
   * place. The heuristic matte lands immediately so the canvas is never empty.
   */
  function prepare(scene) {
    const key = sceneKey(scene);
    if (base.alpha && base.key === key && base.source === "model") {
      return Promise.resolve(status);
    }
    if (job && job.key === key) return job.promise;

    if (!base.alpha || base.key !== key) {
      base = { key, alpha: heuristicAlpha(scene), source: "heuristic" };
      refined = { key: "", alpha: null };
      subjectLayer = { srcRef: null, key: "", canvas: null };
    }

    if (typeof LuminaMatte === "undefined" || !LuminaMatte.isSupported()) {
      setStatus({ state: "fallback", pct: 1, label: "Heuristic matte", source: "heuristic" });
      return Promise.resolve(status);
    }

    setStatus({
      state: "working",
      pct: 0,
      label: LuminaMatte.isReady(settings.engine) ? "Matting" : "Loading matting model",
      source: "heuristic",
    });

    // A run can be superseded while it is in flight (model switched, new image
    // opened). Late results from a stale run must not overwrite the live matte.
    const isCurrent = () => sceneKey(scene) === key;

    const promise = LuminaMatte.run(scene.working.imageData, settings.engine, (p) => {
      if (isCurrent()) setStatus({ state: "working", pct: p.pct, label: p.label });
    })
      .then((alpha) => {
        if (!isCurrent()) return status;
        despeckle(alpha, scene.working.w, scene.working.h, 0.0005);
        base = { key, alpha, source: "model" };
        refined = { key: "", alpha: null };
        subjectLayer = { srcRef: null, key: "", canvas: null };
        setStatus({ state: "ready", pct: 1, label: "Neural matte", source: "model" });
        return status;
      })
      .catch((err) => {
        console.warn("[LuminaBg] neural matting unavailable:", err);
        if (!isCurrent()) return status;
        setStatus({
          state: "fallback",
          pct: 1,
          label: "Model unavailable — heuristic matte",
          source: "heuristic",
        });
        return status;
      })
      .finally(() => {
        if (job && job.key === key) job = null;
      });

    job = { key, promise };
    return promise;
  }

  /** Synchronous accessor used by the render path. Null until a matte exists. */
  function getAlpha(scene) {
    const key = sceneKey(scene);
    if (!base.alpha || base.key !== key) return null;
    const refinedKey = `${key}|${settings.shift}|${settings.feather}`;
    if (refined.alpha && refined.key === refinedKey) return refined.alpha;
    refined = {
      key: refinedKey,
      alpha: refineAlpha(base.alpha, scene.working.w, scene.working.h),
    };
    return refined.alpha;
  }

  /* —— edge refinement —— */

  function refineAlpha(src, w, h) {
    let m = src;
    const shift = Math.round(settings.shift);
    if (shift !== 0) m = morph(m, w, h, shift < 0 ? "erode" : "dilate", Math.abs(shift));
    const feather = Math.round(settings.feather);
    if (feather > 0) m = blur(m, w, h, feather);
    if (m === src) m = Float32Array.from(src);
    return m;
  }

  /** Drop isolated specks below a fraction of the frame area. */
  function despeckle(mask, w, h, minAreaFrac) {
    const minArea = Math.max(16, Math.floor(w * h * minAreaFrac));
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const members = new Int32Array(w * h);
    for (let start = 0; start < mask.length; start++) {
      if (seen[start] || mask[start] < 0.25) continue;
      let sp = 0;
      let count = 0;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        const i = stack[--sp];
        members[count++] = i;
        const x = i % w;
        if (x > 0 && !seen[i - 1] && mask[i - 1] >= 0.25) {
          seen[i - 1] = 1;
          stack[sp++] = i - 1;
        }
        if (x + 1 < w && !seen[i + 1] && mask[i + 1] >= 0.25) {
          seen[i + 1] = 1;
          stack[sp++] = i + 1;
        }
        if (i - w >= 0 && !seen[i - w] && mask[i - w] >= 0.25) {
          seen[i - w] = 1;
          stack[sp++] = i - w;
        }
        if (i + w < mask.length && !seen[i + w] && mask[i + w] >= 0.25) {
          seen[i + w] = 1;
          stack[sp++] = i + w;
        }
      }
      if (count < minArea) {
        for (let k = 0; k < count; k++) mask[members[k]] = 0;
      }
    }
  }

  /* —— colour field estimation + unmixing —— */

  /**
   * Coarse colour field built from the pixels `accept` trusts, then grown
   * outward so every location has a plausible colour. Used twice: once for the
   * original backdrop and once for confident subject pixels.
   */
  function colorField(data, alpha, w, h, accept) {
    const step = 8;
    const gw = Math.max(1, Math.ceil(w / step));
    const gh = Math.max(1, Math.ceil(h / step));
    const sum = new Float32Array(gw * gh * 3);
    const count = new Float32Array(gw * gh);

    for (let y = 0; y < h; y++) {
      const gy = (y / step) | 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!accept(alpha[i])) continue;
        const g = gy * gw + ((x / step) | 0);
        const o = i * 4;
        sum[g * 3] += data[o];
        sum[g * 3 + 1] += data[o + 1];
        sum[g * 3 + 2] += data[o + 2];
        count[g] += 1;
      }
    }

    const field = new Float32Array(gw * gh * 3);
    const known = new Uint8Array(gw * gh);
    let anyKnown = false;
    for (let g = 0; g < gw * gh; g++) {
      if (count[g] < 1) continue;
      field[g * 3] = sum[g * 3] / count[g];
      field[g * 3 + 1] = sum[g * 3 + 1] / count[g];
      field[g * 3 + 2] = sum[g * 3 + 2] / count[g];
      known[g] = 1;
      anyKnown = true;
    }
    // Nothing met the confidence bar, so there is no field to grow from.
    if (!anyKnown) return null;

    // Grow into the cells with no trusted samples so every pixel can be
    // resolved, however far it sits from a confident region.
    for (let pass = 0; pass < Math.max(gw, gh); pass++) {
      let filled = 0;
      const next = Uint8Array.from(known);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const g = gy * gw + gx;
          if (known[g]) continue;
          let r = 0;
          let gg = 0;
          let b = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = gx + dx;
              const ny = gy + dy;
              if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
              const ng = ny * gw + nx;
              if (!known[ng]) continue;
              r += field[ng * 3];
              gg += field[ng * 3 + 1];
              b += field[ng * 3 + 2];
              n++;
            }
          }
          if (!n) continue;
          field[g * 3] = r / n;
          field[g * 3 + 1] = gg / n;
          field[g * 3 + 2] = b / n;
          next[g] = 1;
          filled++;
        }
      }
      known.set(next);
      if (!filled) break;
    }

    return { field, gw, gh, step };
  }

  function sampleField(bgf, x, y) {
    const fx = Math.min(bgf.gw - 1, Math.max(0, x / bgf.step - 0.5));
    const fy = Math.min(bgf.gh - 1, Math.max(0, y / bgf.step - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(bgf.gw - 1, x0 + 1);
    const y1 = Math.min(bgf.gh - 1, y0 + 1);
    const wx = fx - x0;
    const wy = fy - y0;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = bgf.field[(y0 * bgf.gw + x0) * 3 + c];
      const b = bgf.field[(y0 * bgf.gw + x1) * 3 + c];
      const d = bgf.field[(y1 * bgf.gw + x0) * 3 + c];
      const e = bgf.field[(y1 * bgf.gw + x1) * 3 + c];
      const top = a + (b - a) * wx;
      const bottom = d + (e - d) * wx;
      out[c] = top + (bottom - top) * wy;
    }
    return out;
  }

  /**
   * Build the RGBA subject layer. Alpha comes from the matte; edge colours are
   * recovered so the replaced background leaves no halo.
   *
   * Unmixing F = (C - (1-a)B) / a is exact but divides by alpha, so it is only
   * trustworthy once alpha is reasonably high. Below that the pixel is mostly
   * old background and its colour carries almost no subject information, so we
   * take the colour from nearby confident subject pixels instead and cross-fade
   * between the two regimes.
   */
  function buildSubject(sourceImageData, alpha, w, h) {
    const src = sourceImageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;
    const bgf = settings.decontaminate ? colorField(src, alpha, w, h, (a) => a < 0.05) : null;
    const fgf = bgf ? colorField(src, alpha, w, h, (a) => a > 0.85) : null;
    // Without a backdrop estimate there is nothing to unmix against.
    const decon = !!bgf;

    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      const a = alpha[i];
      dst[o + 3] = Math.round(a * 255);
      if (a <= 0) continue;

      let r = src[o];
      let g = src[o + 1];
      let b = src[o + 2];

      if (decon && a < 0.98) {
        const x = i % w;
        const y = (i / w) | 0;
        const bgc = sampleField(bgf, x, y);
        const inv = 1 - a;
        const denom = Math.max(a, 0.08);
        const ur = (r - inv * bgc[0]) / denom;
        const ug = (g - inv * bgc[1]) / denom;
        const ub = (b - inv * bgc[2]) / denom;
        if (fgf) {
          const fgc = sampleField(fgf, x, y);
          const t = smoothstep(0.12, 0.55, a);
          r = mix(fgc[0], ur, t);
          g = mix(fgc[1], ug, t);
          b = mix(fgc[2], ub, t);
        } else {
          r = ur;
          g = ug;
          b = ub;
        }
      }

      dst[o] = clamp255(r);
      dst[o + 1] = clamp255(g);
      dst[o + 2] = clamp255(b);
    }
    return out;
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function subjectCanvas(sourceImageData, scene, alpha) {
    const w = scene.working.w;
    const h = scene.working.h;
    const key = `${refined.key}|${settings.decontaminate ? 1 : 0}`;
    if (subjectLayer.canvas && subjectLayer.srcRef === sourceImageData && subjectLayer.key === key) {
      return subjectLayer.canvas;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").putImageData(buildSubject(sourceImageData, alpha, w, h), 0, 0);
    subjectLayer = { srcRef: sourceImageData, key, canvas };
    return canvas;
  }

  /* —— heuristic fallback matte —— */

  function rgb(data, i) {
    const o = i * 4;
    return [data[o], data[o + 1], data[o + 2]];
  }

  function lum(r, g, b) {
    return (r + g + b) / 3;
  }

  function isFoliage(r, g, b) {
    if (g > r + 8 && g >= b - 10) return true;
    if (g > 65 && g >= r * 1.04 && g >= b) return true;
    if (r > 85 && g > 95 && b < 110 && g >= r * 0.88) return true;
    return false;
  }

  function isSkin(r, g, b) {
    if (r < 30 || g < 15 || b < 10) return false;
    if (r < g - 4) return false;
    if (r >= g && r - b > 10 && g - b < 50) return true;
    if (r > g && r > b && r - b > 14) return true;
    return false;
  }

  function isHair(r, g, b) {
    if (isFoliage(r, g, b)) return false;
    const L = lum(r, g, b);
    if (L > 120) return false;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (L < 100 && spread < 50) return true;
    if (r >= g && r >= b && L < 110 && r < 160) return true;
    return false;
  }

  function dist2(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  function nearestDist(r, g, b, clusters) {
    let best = 1e12;
    const p = [r, g, b];
    for (let i = 0; i < clusters.length; i++) {
      const d = dist2(p, clusters[i]);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function sampleClusters(data, w, h, pred, maxN) {
    const pts = [];
    const step = Math.max(2, Math.floor(Math.min(w, h) / 90));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = y * w + x;
        const [r, g, b] = rgb(data, i);
        if (pred(r, g, b, x, y, i)) pts.push([r, g, b]);
      }
    }
    if (!pts.length) return [[128, 128, 128]];
    const stride = Math.max(1, Math.floor(pts.length / maxN));
    const out = [];
    for (let i = 0; i < pts.length && out.length < maxN; i += stride) out.push(pts[i]);
    return out;
  }

  function ell2(nx, ny, cx, cy, rx, ry) {
    const dx = (nx - cx) / Math.max(rx, 1e-4);
    const dy = (ny - cy) / Math.max(ry, 1e-4);
    return dx * dx + dy * dy;
  }

  function heuristicAlpha(scene) {
    const face = scene.faces?.[0];
    const w = scene.working.w;
    const h = scene.working.h;
    const data = scene.working.imageData.data;

    const prior = new Float32Array(w * h);
    const seed = { x: (w / 2) | 0, y: (h * 0.42) | 0 };

    if (face) {
      const fcx = face.x + face.w * 0.5;
      const fcy = face.y + face.h * 0.5;
      seed.x = Math.floor(fcx * w);
      seed.y = Math.floor(fcy * h);
      const head = { cx: fcx, cy: face.y + face.h * 0.22, rx: face.w * 0.72, ry: face.h * 1.0 };
      const hair = { cx: fcx, cy: face.y - face.h * 0.2, rx: face.w * 0.9, ry: face.h * 0.65 };
      const torso = { cx: fcx, cy: face.y + face.h * 1.5, rx: face.w * 1.05, ry: face.h * 1.1 };
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const ny = y / h;
          const d = Math.min(
            ell2(nx, ny, head.cx, head.cy, head.rx, head.ry),
            ell2(nx, ny, hair.cx, hair.cy, hair.rx, hair.ry),
            ell2(nx, ny, torso.cx, torso.cy, torso.rx, torso.ry)
          );
          prior[y * w + x] = d <= 1 ? 1 - d * 0.35 : Math.max(0, 1.25 - d) / 0.25;
          if (prior[y * w + x] > 1) prior[y * w + x] = 1;
          if (prior[y * w + x] < 0) prior[y * w + x] = 0;
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = ell2(x / w, y / h, 0.5, 0.48, 0.26, 0.36);
          prior[y * w + x] = d < 1 ? 1 - d : 0;
        }
      }
    }

    const band = Math.max(4, Math.floor(Math.min(w, h) * 0.06));
    const bgClusters = sampleClusters(data, w, h, (_r, _g, _b, x, y) => {
      return x < band || y < band || x >= w - band || y >= h - band;
    }, 20);

    const fgClusters = sampleClusters(
      data,
      w,
      h,
      (r, g, b, x, y, i) => {
        if (prior[i] < 0.55) return false;
        if (isFoliage(r, g, b)) return false;
        return isSkin(r, g, b) || isHair(r, g, b);
      },
      22
    );

    const bgMark = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let qh = 0;
    let qt = 0;

    const tryPush = (i) => {
      if (bgMark[i]) return;
      bgMark[i] = 1;
      queue[qt++] = i;
    };

    const bgLike = (i) => {
      if (prior[i] > 0.92) return false;
      const [r, g, b] = rgb(data, i);
      if (isFoliage(r, g, b) && prior[i] < 0.8) return true;
      if (prior[i] < 0.2) return true;
      const dBg = nearestDist(r, g, b, bgClusters);
      const dFg = nearestDist(r, g, b, fgClusters);
      if (dBg + 12 < dFg && prior[i] < 0.75) return true;
      if (dBg < 38 && prior[i] < 0.55) return true;
      if (isSkin(r, g, b) && prior[i] > 0.45) return false;
      if (isHair(r, g, b) && prior[i] > 0.4) return false;
      return prior[i] < 0.28 && dBg < dFg + 25;
    };

    for (let x = 0; x < w; x++) {
      tryPush(x);
      tryPush((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      tryPush(y * w);
      tryPush(y * w + (w - 1));
    }

    while (qh < qt) {
      const i = queue[qh++];
      const x = i % w;
      const y = (i / w) | 0;
      const neigh = [];
      if (x > 0) neigh.push(i - 1);
      if (x + 1 < w) neigh.push(i + 1);
      if (y > 0) neigh.push(i - w);
      if (y + 1 < h) neigh.push(i + w);
      for (const n of neigh) {
        if (bgMark[n]) continue;
        if (!bgLike(n)) continue;
        tryPush(n);
      }
    }

    const alpha = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (bgMark[i]) {
        alpha[i] = 0;
        continue;
      }
      const [r, g, b] = rgb(data, i);
      if (isFoliage(r, g, b) && prior[i] < 0.85) {
        alpha[i] = 0;
        continue;
      }
      const dBg = nearestDist(r, g, b, bgClusters);
      const dFg = nearestDist(r, g, b, fgClusters);
      let s = prior[i] * 0.9 + (dBg - dFg) / 90;
      if (isSkin(r, g, b)) s += 0.55;
      if (isHair(r, g, b)) s += 0.4;
      if (s > 0.35) alpha[i] = s > 0.7 ? 1 : (s - 0.35) / 0.35;
      else alpha[i] = 0;
    }

    keepConnected(alpha, w, h, seed.x, seed.y, 0.25);

    let m = alpha;
    if (face) {
      const fcx = face.x + face.w * 0.5;
      const fcy = face.y + face.h * 0.5;
      for (let i = 0; i < w * h; i++) {
        if (m[i] <= 0) continue;
        const [r, g, b] = rgb(data, i);
        if (!isFoliage(r, g, b)) continue;
        const x = i % w;
        const y = (i / w) | 0;
        if (ell2(x / w, y / h, fcx, fcy, face.w * 0.55, face.h * 0.55) > 1) m[i] = 0;
      }
    }
    m = morph(m, w, h, "erode", 1);
    m = morph(m, w, h, "dilate", 1);
    keepConnected(m, w, h, seed.x, seed.y, 0.2);
    m = blur(m, w, h, 1);

    for (let i = 0; i < m.length; i++) {
      if (m[i] < 0.35) m[i] = 0;
      else if (m[i] > 0.7) m[i] = 1;
    }
    return blur(m, w, h, 1);
  }

  function keepConnected(mask, w, h, seedX, seedY, thr) {
    seedX = Math.min(w - 1, Math.max(0, seedX));
    seedY = Math.min(h - 1, Math.max(0, seedY));
    let start = seedY * w + seedX;
    if (mask[start] < thr) {
      let best = -1;
      let bestD = 1e12;
      const R = 60;
      for (let y = Math.max(0, seedY - R); y < Math.min(h, seedY + R); y++) {
        for (let x = Math.max(0, seedX - R); x < Math.min(w, seedX + R); x++) {
          const i = y * w + x;
          if (mask[i] < thr) continue;
          const d = (x - seedX) ** 2 + (y - seedY) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (best < 0) {
        mask.fill(0);
        return;
      }
      start = best;
    }

    const keep = new Uint8Array(w * h);
    const stack = [start];
    keep[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      if (mask[i] < thr) continue;
      const x = i % w;
      const nbs = [i - 1, i + 1, i - w, i + w];
      for (const n of nbs) {
        if (n < 0 || n >= w * h) continue;
        if (Math.abs((n % w) - x) > 1) continue;
        if (keep[n] || mask[n] < thr) continue;
        keep[n] = 1;
        stack.push(n);
      }
    }
    for (let i = 0; i < mask.length; i++) {
      if (!keep[i]) mask[i] = 0;
    }
  }

  function morph(src, w, h, op, radius) {
    const out = new Float32Array(src.length);
    const r = radius;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = op === "erode" ? 1 : 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            const s = src[yy * w + xx];
            v = op === "erode" ? Math.min(v, s) : Math.max(v, s);
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  function blur(src, w, h, radius) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const r = radius;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          sum += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
          n++;
        }
        tmp[y * w + x] = sum / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -r; k <= r; k++) {
          sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
          n++;
        }
        out[y * w + x] = sum / n;
      }
    }
    return out;
  }

  /* —— drawing replacements —— */

  function drawChecker(ctx, w, h, cell = 14) {
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const on = ((x / cell) + (y / cell)) % 2 === 0;
        ctx.fillStyle = on ? "#2a2e36" : "#15181e";
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }

  function drawGradient(ctx, w, h, key) {
    const stops = GRADIENTS[key] || GRADIENTS.sunset;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach((c, i) => g.addColorStop(i / Math.max(1, stops.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function coverImage(ctx, img, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function drawBlurredSource(ctx, sourceImageData, w, h) {
    const full = document.createElement("canvas");
    full.width = w;
    full.height = h;
    full.getContext("2d").putImageData(sourceImageData, 0, 0);
    const soft = document.createElement("canvas");
    soft.width = Math.max(8, (w / 10) | 0);
    soft.height = Math.max(8, (h / 10) | 0);
    soft.getContext("2d").drawImage(full, 0, 0, soft.width, soft.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(soft, 0, 0, w, h);
    ctx.fillStyle = "rgba(8,10,14,0.2)";
    ctx.fillRect(0, 0, w, h);
  }

  /** Seamless cyclorama — wall falling into floor, no hard horizon. */
  function drawStudioCove(ctx, w, h) {
    const wall = ctx.createLinearGradient(0, 0, 0, h * 0.58);
    wall.addColorStop(0, "#ece8e2");
    wall.addColorStop(1, "#c9c3ba");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    const floor = ctx.createLinearGradient(0, h * 0.5, 0, h);
    floor.addColorStop(0, "rgba(186,180,171,0)");
    floor.addColorStop(0.18, "#b7b0a6");
    floor.addColorStop(1, "#8f887e");
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    const falloff = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.12, w * 0.5, h * 0.5, h * 0.85);
    falloff.addColorStop(0, "rgba(255,255,252,0.18)");
    falloff.addColorStop(1, "rgba(40,32,24,0.22)");
    ctx.fillStyle = falloff;
    ctx.fillRect(0, 0, w, h);
  }

  function lightFromScene() {
    const p = typeof LuminaEngine !== "undefined" && LuminaEngine.lastParams
      ? LuminaEngine.lastParams()
      : { sunAngle: 35, azimuth: 0 };
    return {
      sun: Number.isFinite(p.sunAngle) ? p.sunAngle : 35,
      az: Number.isFinite(p.azimuth) ? p.azimuth : 0,
    };
  }

  function alphaBounds(alpha, w, h, thr = 0.1) {
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (alpha[row + x] < thr) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY, cx: (minX + maxX) * 0.5, feetY: maxY };
  }

  function silhouetteLayer(alpha, w, h) {
    if (silCache.alpha === alpha && silCache.w === w && silCache.h === h && silCache.canvas) {
      return silCache;
    }
    const sw = Math.max(48, (w / 3) | 0);
    const sh = Math.max(48, (h / 3) | 0);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(sw, sh);
    const d = img.data;
    for (let y = 0; y < sh; y++) {
      const sy = Math.min(h - 1, ((y / sh) * h) | 0);
      for (let x = 0; x < sw; x++) {
        const a = alpha[sy * w + Math.min(w - 1, ((x / sw) * w) | 0)];
        if (a <= 0) continue;
        const i = (y * sw + x) * 4;
        d[i + 3] = Math.round(Math.min(1, a) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    silCache = { alpha, w, h, canvas, bounds: alphaBounds(alpha, w, h) };
    return silCache;
  }

  function drawContactShadow(ctx, alpha, w, h, amount) {
    if (amount < 0.02) return;
    const sil = silhouetteLayer(alpha, w, h);
    if (!sil.bounds) return;
    const { cx, feetY, minX, maxX, minY } = sil.bounds;
    const { sun, az } = lightFromScene();
    const length = 0.14 + (1 - sun / 90) * 0.42;
    const shear = Math.sin((az * Math.PI) / 180);
    const dx = shear * (0.08 + length) * (maxX - minX + 8);
    const flatten = 0.12 + length * 0.16;
    const subW = Math.max(24, maxX - minX);
    const subH = Math.max(24, feetY - minY);

    ctx.save();
    ctx.filter = `blur(${Math.max(8, subW * 0.06)}px)`;
    ctx.fillStyle = `rgba(18, 10, 6, ${0.5 * amount})`;
    ctx.beginPath();
    ctx.ellipse(cx + dx * 0.22, feetY + 6, subW * 0.38, 10 + amount * 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.filter = `blur(${Math.max(6, subH * 0.045)}px)`;
    ctx.globalAlpha = 0.62 * amount;
    ctx.translate(cx + dx, feetY + 4);
    ctx.transform(1, 0, shear * 0.55, flatten, 0, 0);
    ctx.drawImage(sil.canvas, -cx, -feetY, w, h);
    ctx.restore();
  }

  function drawFloorReflection(ctx, subject, alpha, w, h, amount) {
    if (amount < 0.02) return;
    const sil = silhouetteLayer(alpha, w, h);
    if (!sil.bounds) return;
    const { feetY, minY } = sil.bounds;
    const depth = Math.max(20, (feetY - minY) * 0.42 * amount);
    const key = `${feetY}|${amount.toFixed(3)}|${w}x${h}`;
    if (reflCache.subject !== subject || reflCache.key !== key || !reflCache.canvas) {
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const t = tmp.getContext("2d");
      t.translate(0, feetY);
      t.scale(1, -0.55);
      t.globalAlpha = 0.4 * amount;
      t.filter = "blur(1.2px)";
      t.drawImage(subject, 0, -feetY);
      t.setTransform(1, 0, 0, 1, 0, 0);
      t.filter = "none";
      t.globalAlpha = 1;
      t.globalCompositeOperation = "destination-in";
      const fade = t.createLinearGradient(0, feetY, 0, feetY + depth);
      fade.addColorStop(0, "rgba(0,0,0,0.95)");
      fade.addColorStop(0.4, "rgba(0,0,0,0.35)");
      fade.addColorStop(1, "rgba(0,0,0,0)");
      t.fillStyle = fade;
      t.fillRect(0, feetY, w, depth + 6);
      reflCache = { subject, key, canvas: tmp };
    }
    ctx.drawImage(reflCache.canvas, 0, 0);
  }

  /**
   * Composite replacement background + subject onto ctx.
   * @param {object} bg { mode, color, gradient, image, shadow, reflect, rim }
   */
  function composite(ctx, sourceImageData, scene, bg, { forExport = false } = {}) {
    const w = scene.working.w;
    const h = scene.working.h;

    if (!bg || bg.mode === "original") {
      ctx.putImageData(sourceImageData, 0, 0);
      return;
    }

    const alpha = getAlpha(scene);
    if (!alpha) {
      // Matte still being computed — show the untouched frame rather than a hole.
      ctx.putImageData(sourceImageData, 0, 0);
      return;
    }

    if (bg.mode === "transparent") {
      if (forExport) ctx.clearRect(0, 0, w, h);
      else drawChecker(ctx, w, h);
    } else if (bg.mode === "studio") {
      drawStudioCove(ctx, w, h);
    } else if (bg.mode === "solid") {
      ctx.fillStyle = bg.color || "#00c853";
      ctx.fillRect(0, 0, w, h);
    } else if (bg.mode === "gradient") {
      drawGradient(ctx, w, h, bg.gradient || "sunset");
    } else if (bg.mode === "blur") {
      drawBlurredSource(ctx, sourceImageData, w, h);
    } else if (bg.mode === "image" && bg.image) {
      coverImage(ctx, bg.image, w, h);
    } else {
      ctx.putImageData(sourceImageData, 0, 0);
      return;
    }

    const shadow = Number(bg.shadow) || 0;
    const reflect = Number(bg.reflect) || 0;
    const rim = Number(bg.rim) || 0;
    const subject = subjectCanvas(sourceImageData, scene, alpha);

    drawContactShadow(ctx, alpha, w, h, shadow);
    drawFloorReflection(ctx, subject, alpha, w, h, reflect);

    if (rim > 0.02) {
      const { sun, az } = lightFromScene();
      const ox = Math.sin((az * Math.PI) / 180) * (8 + rim * 16);
      const oy = -Math.cos((sun * Math.PI) / 180) * (5 + rim * 12);
      ctx.save();
      ctx.shadowColor = `rgba(255, 214, 168, ${0.55 * rim})`;
      ctx.shadowBlur = 8 + rim * 20;
      ctx.shadowOffsetX = ox;
      ctx.shadowOffsetY = oy;
      ctx.drawImage(subject, 0, 0);
      ctx.restore();
    }
    ctx.drawImage(subject, 0, 0);
  }

  return {
    invalidate,
    prepare,
    getAlpha,
    getStatus,
    onStatus,
    getSettings,
    setSettings,
    composite,
    GRADIENTS,
  };
})();
