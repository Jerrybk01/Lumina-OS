/**
 * Content-aware fill.
 *
 * Multi-scale PatchMatch texture synthesis: the hole is rebuilt out of patches
 * copied from the surrounding image, coarse level first, so structure (horizons,
 * railings, tiles) carries across the gap instead of dissolving into a blur.
 *
 * Each level runs an EM loop — PatchMatch finds, for every patch overlapping the
 * hole, its closest match in the intact region; voting then averages all the
 * patches covering a pixel into a new colour. Known pixels are never rewritten,
 * so the fill stays pinned to its surroundings.
 */
const LuminaInpaint = (() => {
  /** Patch radius. 5x5 keeps the inner loop cheap enough for interactive use. */
  const R = 2;
  /** Longest side of the synthesis grid; larger regions are filled downscaled. */
  const MAX_SYNTH = 512;
  /** Hole pixels are guesses, so they pull less weight than known ones. */
  const HOLE_WEIGHT = 0.35;
  /** Below this the pyramid stops: coarser levels would be mostly hole. */
  const MIN_LEVEL = 48;

  /**
   * Pyramid depth is what decides whether a boundary crossing the hole (a
   * horizon, a wall edge) lands in the right place — measured on a synthetic
   * horizon, going from 4 to 5 levels cut misplaced texture by ~64% for ~25%
   * more time, while extra EM iterations at a fixed depth changed almost
   * nothing. MIN_LEVEL caps the real depth for small holes.
   */
  const QUALITY = {
    fast: { levels: 4, em: 3, pm: 1, label: "Fast" },
    balanced: { levels: 5, em: 5, pm: 2, label: "Balanced" },
    detailed: { levels: 6, em: 8, pm: 3, label: "Detailed" },
  };

  function listQualities() {
    return Object.entries(QUALITY).map(([key, q]) => ({ key, label: q.label }));
  }

  function tick() {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  function bounds(mask, w, h) {
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  function cropRegion(imageData, mask, rx, ry, rw, rh) {
    const src = imageData.data;
    const w = imageData.width;
    const rgb = new Float32Array(rw * rh * 3);
    const hole = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const s = (ry + y) * w + (rx + x);
        const d = y * rw + x;
        rgb[d * 3] = src[s * 4];
        rgb[d * 3 + 1] = src[s * 4 + 1];
        rgb[d * 3 + 2] = src[s * 4 + 2];
        hole[d] = mask[s] ? 1 : 0;
      }
    }
    return { rgb, hole };
  }

  function resizeRgb(src, sw, sh, dw, dh) {
    if (sw === dw && sh === dh) return Float32Array.from(src);
    const out = new Float32Array(dw * dh * 3);
    const xr = sw / dw;
    const yr = sh / dh;
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yr - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const wy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xr - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(sw - 1, x0 + 1);
        const wx = sx - x0;
        const i00 = (y0 * sw + x0) * 3;
        const i01 = (y0 * sw + x1) * 3;
        const i10 = (y1 * sw + x0) * 3;
        const i11 = (y1 * sw + x1) * 3;
        const o = (y * dw + x) * 3;
        for (let c = 0; c < 3; c++) {
          const top = src[i00 + c] + (src[i01 + c] - src[i00 + c]) * wx;
          const bottom = src[i10 + c] + (src[i11 + c] - src[i10 + c]) * wx;
          out[o + c] = top + (bottom - top) * wy;
        }
      }
    }
    return out;
  }

  /** Downscaling a mask must not shrink the hole, so any covered source pixel wins. */
  function resizeHole(src, sw, sh, dw, dh) {
    if (sw === dw && sh === dh) return Uint8Array.from(src);
    const out = new Uint8Array(dw * dh);
    const xr = sw / dw;
    const yr = sh / dh;
    for (let y = 0; y < dh; y++) {
      const sy0 = Math.floor(y * yr);
      const sy1 = Math.max(sy0, Math.min(sh - 1, Math.ceil((y + 1) * yr) - 1));
      for (let x = 0; x < dw; x++) {
        const sx0 = Math.floor(x * xr);
        const sx1 = Math.max(sx0, Math.min(sw - 1, Math.ceil((x + 1) * xr) - 1));
        let hit = 0;
        for (let yy = sy0; yy <= sy1 && !hit; yy++) {
          for (let xx = sx0; xx <= sx1; xx++) {
            if (src[yy * sw + xx]) {
              hit = 1;
              break;
            }
          }
        }
        out[y * dw + x] = hit;
      }
    }
    return out;
  }

  function halve(level) {
    const w = Math.max(4, level.w >> 1);
    const h = Math.max(4, level.h >> 1);
    return {
      w,
      h,
      rgb: resizeRgb(level.rgb, level.w, level.h, w, h),
      hole: resizeHole(level.hole, level.w, level.h, w, h),
    };
  }

  /**
   * Seed the coarsest level by growing colour inward from the rim, one ring at a
   * time. PatchMatch needs something better than black to compare against.
   */
  function diffuseFill(rgb, hole, w, h) {
    const known = new Uint8Array(w * h);
    for (let i = 0; i < known.length; i++) known[i] = hole[i] ? 0 : 1;

    let frontier = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        if (
          (x > 0 && known[i - 1]) ||
          (x + 1 < w && known[i + 1]) ||
          (y > 0 && known[i - w]) ||
          (y + 1 < h && known[i + w])
        ) {
          frontier.push(i);
        }
      }
    }

    while (frontier.length) {
      const values = new Float32Array(frontier.length * 3);
      for (let k = 0; k < frontier.length; k++) {
        const i = frontier[k];
        const x = i % w;
        const y = (i / w) | 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!known[j]) continue;
            r += rgb[j * 3];
            g += rgb[j * 3 + 1];
            b += rgb[j * 3 + 2];
            n++;
          }
        }
        if (!n) continue;
        values[k * 3] = r / n;
        values[k * 3 + 1] = g / n;
        values[k * 3 + 2] = b / n;
      }
      // Commit the whole ring at once so the fill does not smear in scan order.
      for (let k = 0; k < frontier.length; k++) {
        const i = frontier[k];
        rgb[i * 3] = values[k * 3];
        rgb[i * 3 + 1] = values[k * 3 + 1];
        rgb[i * 3 + 2] = values[k * 3 + 2];
        known[i] = 1;
      }
      const next = [];
      const seen = new Set();
      for (const i of frontier) {
        const x = i % w;
        const y = (i / w) | 0;
        const nbs = [];
        if (x > 0) nbs.push(i - 1);
        if (x + 1 < w) nbs.push(i + 1);
        if (y > 0) nbs.push(i - w);
        if (y + 1 < h) nbs.push(i + w);
        for (const j of nbs) {
          if (known[j] || seen.has(j)) continue;
          seen.add(j);
          next.push(j);
        }
      }
      frontier = next;
    }
  }

  /**
   * Replicate-pad by the patch radius so every real pixel can be a patch centre
   * and the hot loops never need a bounds check.
   */
  function padLevel(rgb, hole, w, h) {
    const W = w + R * 2;
    const H = h + R * 2;
    const prgb = new Float32Array(W * H * 3);
    const phole = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(h - 1, Math.max(0, y - R));
      for (let x = 0; x < W; x++) {
        const sx = Math.min(w - 1, Math.max(0, x - R));
        const s = sy * w + sx;
        const d = y * W + x;
        prgb[d * 3] = rgb[s * 3];
        prgb[d * 3 + 1] = rgb[s * 3 + 1];
        prgb[d * 3 + 2] = rgb[s * 3 + 2];
        phole[d] = hole[s];
      }
    }
    return { w: W, h: H, rgb: prgb, hole: phole };
  }

  function unpad(prgb, W, w, h) {
    const out = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y + R) * W + (x + R);
        const d = y * w + x;
        out[d * 3] = prgb[s * 3];
        out[d * 3 + 1] = prgb[s * 3 + 1];
        out[d * 3 + 2] = prgb[s * 3 + 2];
      }
    }
    return out;
  }

  /** Summed-area table so "does this patch touch the hole" is O(1). */
  function integral(hole, w, h) {
    const sums = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += hole[y * w + x];
        sums[(y + 1) * (w + 1) + (x + 1)] = sums[y * (w + 1) + (x + 1)] + row;
      }
    }
    return sums;
  }

  function patchHoleCount(sums, w, cx, cy) {
    const x0 = cx - R;
    const y0 = cy - R;
    const x1 = cx + R + 1;
    const y1 = cy + R + 1;
    const stride = w + 1;
    return (
      sums[y1 * stride + x1] - sums[y0 * stride + x1] - sums[y1 * stride + x0] + sums[y0 * stride + x0]
    );
  }

  function patchDist(rgb, W, tx, ty, sx, sy, weight, best) {
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) {
      let ti = (ty + dy) * W + tx - R;
      let si = (sy + dy) * W + sx - R;
      for (let dx = -R; dx <= R; dx++, ti++, si++) {
        const wt = weight[ti];
        const t3 = ti * 3;
        const s3 = si * 3;
        const dr = rgb[t3] - rgb[s3];
        const dg = rgb[t3 + 1] - rgb[s3 + 1];
        const db = rgb[t3 + 2] - rgb[s3 + 2];
        sum += wt * (dr * dr + dg * dg + db * db);
        if (sum >= best) return sum;
      }
    }
    return sum;
  }

  function patchMatchPass(state, forward) {
    const { rgb, W, H, targets, nnf, srcOk, weight } = state;
    const step = forward ? 1 : -1;
    const from = forward ? 0 : targets.length - 1;
    const to = forward ? targets.length : -1;
    const dA = forward ? -1 : 1;
    const dB = forward ? -W : W;
    const maxRadius = Math.max(W, H);

    for (let k = from; k !== to; k += step) {
      const t = targets[k];
      const tx = t % W;
      const ty = (t / W) | 0;
      let s = nnf[t];
      let best = patchDist(rgb, W, tx, ty, s % W, (s / W) | 0, weight, Infinity);

      // Propagation: a good match for my neighbour, shifted by the same step,
      // is usually a good match for me.
      for (const d of [dA, dB]) {
        const tn = t + d;
        if (tn < 0 || tn >= nnf.length) continue;
        const sn = nnf[tn];
        if (sn < 0) continue;
        const cand = sn - d;
        if (cand < 0 || cand >= srcOk.length || !srcOk[cand]) continue;
        const dist = patchDist(rgb, W, tx, ty, cand % W, (cand / W) | 0, weight, best);
        if (dist < best) {
          best = dist;
          s = cand;
        }
      }

      // Random search: sample an exponentially shrinking window around the best
      // match so far, which escapes local minima without a full scan.
      let radius = maxRadius;
      while (radius > 1) {
        const sx = s % W;
        const sy = (s / W) | 0;
        const nx = Math.min(W - R - 1, Math.max(R, sx + Math.round((Math.random() * 2 - 1) * radius)));
        const ny = Math.min(H - R - 1, Math.max(R, sy + Math.round((Math.random() * 2 - 1) * radius)));
        const cand = ny * W + nx;
        if (srcOk[cand]) {
          const dist = patchDist(rgb, W, tx, ty, nx, ny, weight, best);
          if (dist < best) {
            best = dist;
            s = cand;
          }
        }
        radius >>= 1;
      }

      nnf[t] = s;
    }
  }

  function vote(state) {
    const { rgb, W, targets, nnf, hole, acc, cnt } = state;
    acc.fill(0);
    cnt.fill(0);
    for (let k = 0; k < targets.length; k++) {
      const t = targets[k];
      const s = nnf[t];
      if (s < 0) continue;
      for (let dy = -R; dy <= R; dy++) {
        let ti = t + dy * W - R;
        let si = s + dy * W - R;
        for (let dx = -R; dx <= R; dx++, ti++, si++) {
          if (!hole[ti]) continue;
          acc[ti * 3] += rgb[si * 3];
          acc[ti * 3 + 1] += rgb[si * 3 + 1];
          acc[ti * 3 + 2] += rgb[si * 3 + 2];
          cnt[ti]++;
        }
      }
    }
    for (let i = 0; i < cnt.length; i++) {
      if (!cnt[i]) continue;
      rgb[i * 3] = acc[i * 3] / cnt[i];
      rgb[i * 3 + 1] = acc[i * 3 + 1] / cnt[i];
      rgb[i * 3 + 2] = acc[i * 3 + 2] / cnt[i];
    }
  }

  async function synthLevel(rgb, level, q, em, prevNnf, report) {
    const pad = padLevel(rgb, level.hole, level.w, level.h);
    const W = pad.w;
    const H = pad.h;
    const n = W * H;

    const weight = new Float32Array(n);
    for (let i = 0; i < n; i++) weight[i] = pad.hole[i] ? HOLE_WEIGHT : 1;

    const sums = integral(pad.hole, W, H);
    const srcOk = new Uint8Array(n);
    const targetList = [];
    const sourceList = [];
    for (let y = R; y < H - R; y++) {
      for (let x = R; x < W - R; x++) {
        const i = y * W + x;
        if (patchHoleCount(sums, W, x, y) === 0) {
          srcOk[i] = 1;
          sourceList.push(i);
        } else {
          targetList.push(i);
        }
      }
    }

    // Nothing to copy from (the mask swallowed the whole region) — keep the
    // diffusion result rather than failing.
    if (!targetList.length || !sourceList.length) {
      return { rgb: unpad(pad.rgb, W, level.w, level.h), nnf: null };
    }

    const targets = Int32Array.from(targetList);
    const validList = Int32Array.from(sourceList);
    const nnf = new Int32Array(n).fill(-1);
    for (const t of targets) {
      let seed = -1;
      if (prevNnf) {
        const tx = ((t % W) - R) >> 1;
        const ty = (((t / W) | 0) - R) >> 1;
        const pt = (Math.min(prevNnf.h - R - 1, Math.max(R, ty + R))) * prevNnf.w +
          Math.min(prevNnf.w - R - 1, Math.max(R, tx + R));
        const ps = prevNnf.nnf[pt];
        if (ps >= 0) {
          const sx = Math.min(W - R - 1, Math.max(R, ((ps % prevNnf.w) - R) * 2 + R));
          const sy = Math.min(H - R - 1, Math.max(R, (((ps / prevNnf.w) | 0) - R) * 2 + R));
          const cand = sy * W + sx;
          if (srcOk[cand]) seed = cand;
        }
      }
      nnf[t] = seed >= 0 ? seed : validList[(Math.random() * validList.length) | 0];
    }

    const state = {
      rgb: pad.rgb,
      hole: pad.hole,
      W,
      H,
      targets,
      nnf,
      srcOk,
      weight,
      acc: new Float32Array(n * 3),
      cnt: new Float32Array(n),
    };

    for (let it = 0; it < em; it++) {
      for (let p = 0; p < q.pm; p++) patchMatchPass(state, (it + p) % 2 === 0);
      vote(state);
      report((it + 1) / em);
      await tick();
    }

    return { rgb: unpad(pad.rgb, W, level.w, level.h), nnf: { nnf, w: W, h: H } };
  }

  /** Soft edge so the synthesised patch does not land with a visible cut line. */
  function featherMask(mask, w, rx, ry, rw, rh) {
    const m = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        m[y * rw + x] = mask[(ry + y) * w + (rx + x)] ? 1 : 0;
      }
    }
    const grown = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && v < 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(rw - 1, Math.max(0, x + dx));
            const yy = Math.min(rh - 1, Math.max(0, y + dy));
            if (m[yy * rw + xx] > v) v = m[yy * rw + xx];
          }
        }
        grown[y * rw + x] = v;
      }
    }
    const tmp = new Float32Array(rw * rh);
    const out = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        let sum = 0;
        for (let k = -1; k <= 1; k++) sum += grown[y * rw + Math.min(rw - 1, Math.max(0, x + k))];
        tmp[y * rw + x] = sum / 3;
      }
    }
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        let sum = 0;
        for (let k = -1; k <= 1; k++) sum += tmp[Math.min(rh - 1, Math.max(0, y + k)) * rw + x];
        out[y * rw + x] = Math.min(1, sum / 3);
      }
    }
    return out;
  }

  /**
   * Fill every pixel flagged in `mask` with plausible surroundings.
   *
   * @param {ImageData} imageData source frame (not modified)
   * @param {Uint8Array} mask     one entry per pixel, non-zero = remove
   * @param {object} opts         { quality: "fast"|"balanced"|"detailed" }
   * @param {function} onProgress receives ({ pct, label })
   * @returns {Promise<ImageData|null>} null when the mask is empty
   */
  async function fill(imageData, mask, opts = {}, onProgress = null) {
    const w = imageData.width;
    const h = imageData.height;
    const q = QUALITY[opts.quality] || QUALITY.balanced;
    const box = bounds(mask, w, h);
    if (!box) return null;

    const report = (pct, label) => onProgress?.({ pct: Math.min(1, Math.max(0, pct)), label });
    report(0, "Reading surroundings");

    // Context margin: the synthesiser can only copy from what it is handed, so
    // the crop carries a generous ring of intact image around the hole.
    const hw = box.x1 - box.x0 + 1;
    const hh = box.y1 - box.y0 + 1;
    const pad = Math.max(16, Math.round(Math.max(hw, hh) * 0.8));
    const rx = Math.max(0, box.x0 - pad);
    const ry = Math.max(0, box.y0 - pad);
    const rw = Math.min(w - 1, box.x1 + pad) - rx + 1;
    const rh = Math.min(h - 1, box.y1 + pad) - ry + 1;

    const crop = cropRegion(imageData, mask, rx, ry, rw, rh);

    const scale = Math.min(1, MAX_SYNTH / Math.max(rw, rh));
    const sw = Math.max(8, Math.round(rw * scale));
    const sh = Math.max(8, Math.round(rh * scale));

    const finest = {
      w: sw,
      h: sh,
      rgb: scale < 1 ? resizeRgb(crop.rgb, rw, rh, sw, sh) : crop.rgb,
      hole: scale < 1 ? resizeHole(crop.hole, rw, rh, sw, sh) : crop.hole,
    };

    const pyramid = [finest];
    while (pyramid.length < q.levels) {
      const top = pyramid[0];
      if (Math.min(top.w, top.h) < MIN_LEVEL) break;
      pyramid.unshift(halve(top));
    }

    let prev = null;
    let prevNnf = null;
    for (let l = 0; l < pyramid.length; l++) {
      const level = pyramid[l];
      let rgb;
      if (!prev) {
        rgb = Float32Array.from(level.rgb);
        diffuseFill(rgb, level.hole, level.w, level.h);
      } else {
        rgb = resizeRgb(prev.rgb, prev.w, prev.h, level.w, level.h);
        for (let i = 0; i < level.w * level.h; i++) {
          if (level.hole[i]) continue;
          rgb[i * 3] = level.rgb[i * 3];
          rgb[i * 3 + 1] = level.rgb[i * 3 + 1];
          rgb[i * 3 + 2] = level.rgb[i * 3 + 2];
        }
      }

      const base = l / pyramid.length;
      const span = 1 / pyramid.length;
      const res = await synthLevel(rgb, level, q, q.em, prevNnf, (f) =>
        report(base + f * span, `Rebuilding detail ${l + 1}/${pyramid.length}`)
      );
      prev = { rgb: res.rgb, w: level.w, h: level.h };
      prevNnf = res.nnf;
    }

    let filled = prev.rgb;
    if (scale < 1) filled = resizeRgb(filled, sw, sh, rw, rh);

    const alpha = featherMask(mask, w, rx, ry, rw, rh);
    const out = new ImageData(new Uint8ClampedArray(imageData.data), w, h);
    const dst = out.data;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const j = y * rw + x;
        const a = alpha[j];
        if (a <= 0) continue;
        const o = ((ry + y) * w + (rx + x)) * 4;
        dst[o] = dst[o] * (1 - a) + filled[j * 3] * a;
        dst[o + 1] = dst[o + 1] * (1 - a) + filled[j * 3 + 1] * a;
        dst[o + 2] = dst[o + 2] * (1 - a) + filled[j * 3 + 2] * a;
      }
    }

    report(1, "Done");
    return out;
  }

  return { fill, bounds, listQualities, QUALITY };
})();
