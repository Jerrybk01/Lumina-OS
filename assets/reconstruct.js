/**
 * Scene reconstruction: depth, materials, light field, camera profiles, RAW preview extract.
 */
const LuminaReconstruct = (() => {
  const CAMERA_PROFILES = {
    default: { name: "Generic", noiseFloor: 0.02, highlightRollOff: 0.85, blackPoint: 0.01 },
    "nikon z9": { name: "Nikon Z9", noiseFloor: 0.012, highlightRollOff: 0.9, blackPoint: 0.008 },
    "nikon z8": { name: "Nikon Z8", noiseFloor: 0.013, highlightRollOff: 0.9, blackPoint: 0.008 },
    "canon eos r5": { name: "Canon EOS R5", noiseFloor: 0.015, highlightRollOff: 0.88, blackPoint: 0.01 },
    "sony a7r": { name: "Sony A7R", noiseFloor: 0.014, highlightRollOff: 0.89, blackPoint: 0.009 },
    fuji: { name: "Fujifilm", noiseFloor: 0.016, highlightRollOff: 0.86, blackPoint: 0.01 },
    demo: { name: "Lumina Demo Sensor", noiseFloor: 0.01, highlightRollOff: 0.92, blackPoint: 0.006 },
  };

  function guessProfile(fileName = "") {
    const n = fileName.toLowerCase();
    if (n.includes("nikon") || n.endsWith(".nef")) return CAMERA_PROFILES["nikon z9"];
    if (n.includes("canon") || n.endsWith(".cr2") || n.endsWith(".cr3")) return CAMERA_PROFILES["canon eos r5"];
    if (n.includes("sony") || n.endsWith(".arw")) return CAMERA_PROFILES["sony a7r"];
    if (n.includes("fuji") || n.endsWith(".raf")) return CAMERA_PROFILES.fuji;
    return CAMERA_PROFILES.default;
  }

  function extractEmbeddedJpeg(buffer) {
    const bytes = new Uint8Array(buffer);
    let start = -1;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) {
        start = i;
        break;
      }
    }
    if (start < 0) return null;
    for (let i = bytes.length - 2; i > start; i--) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
        return buffer.slice(start, i + 2);
      }
    }
    return null;
  }

  async function decodeFile(file) {
    const name = file.name || "";
    const isRaw = /\.(dng|nef|cr2|cr3|arw|raf|orf|rw2)$/i.test(name);
    const profile = guessProfile(name);

    if (isRaw) {
      const buf = await file.arrayBuffer();
      const jpeg = extractEmbeddedJpeg(buf);
      if (!jpeg) throw new Error("Could not extract RAW preview. Try a JPEG/DNG with embedded preview.");
      const blob = new Blob([jpeg], { type: "image/jpeg" });
      const img = await blobToImage(blob);
      return { image: img, profile, fromRaw: true, fileName: name };
    }

    const img = await blobToImage(file);
    return { image: img, profile, fromRaw: false, fileName: name };
  }

  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to decode image"));
      };
      img.src = url;
    });
  }

  function imageToWorking(img, maxW = 960) {
    const scale = Math.min(1, maxW / img.width);
    const w = Math.max(2, Math.round(img.width * scale));
    const h = Math.max(2, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas: c, ctx, imageData: ctx.getImageData(0, 0, w, h), w, h };
  }

  function smoothMap(map, w, h, passes) {
    let src = map;
    let dst = new Float32Array(map.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              sum += src[yy * w + xx];
              n++;
            }
          }
          dst[y * w + x] = sum / n;
        }
      }
      [src, dst] = [dst, src];
    }
    return src;
  }

  /** Nearness map [0,1]: 0 = far (sky), 1 = near (foreground). */
  function estimateDepth(imageData, w, h) {
    const { data } = imageData;
    const depth = new Float32Array(w * h);
    const lum = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      lum[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }

    const edge = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = lum[i + 1] - lum[i - 1];
        const gy = lum[i + w] - lum[i - w];
        edge[i] = Math.min(1, Math.hypot(gx, gy) * 2);
      }
    }

    for (let y = 0; y < h; y++) {
      const v = y / Math.max(1, h - 1);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = data[i * 4] / 255;
        const g = data[i * 4 + 1] / 255;
        const b = data[i * 4 + 2] / 255;
        const skyChroma = Math.max(0, b - Math.max(r, g)) + Math.max(0, lum[i] - 0.75);
        depth[i] = Math.min(
          1,
          Math.max(0, v * 0.62 + edge[i] * 0.12 + (1 - lum[i]) * 0.12 - skyChroma * 0.45)
        );
      }
    }
    return smoothMap(depth, w, h, 1);
  }

  /** Material IDs: 0 sky, 1 veg, 2 ground, 3 rock, 4 skin, 5 other */
  function estimateMaterials(imageData, w, h, depth) {
    const { data } = imageData;
    const mat = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        const r = data[o] / 255;
        const g = data[o + 1] / 255;
        const b = data[o + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const v = y / h;
        const d = depth[i];

        if (
          r > 0.35 &&
          g > 0.2 &&
          b > 0.15 &&
          r > g &&
          g > b &&
          sat < 0.55 &&
          lum > 0.25 &&
          lum < 0.9 &&
          v > 0.15 &&
          v < 0.85
        ) {
          mat[i] = 4;
        } else if (d < 0.35 && (b > r * 1.05 || lum > 0.78) && v < 0.5) {
          mat[i] = 0;
        } else if (g > r * 1.05 && g > b * 1.05 && sat > 0.12) {
          mat[i] = 1;
        } else if (v > 0.62 && d > 0.55) {
          mat[i] = 2;
        } else if (sat < 0.2 && lum < 0.55) {
          mat[i] = 3;
        } else {
          mat[i] = 5;
        }
      }
    }
    return mat;
  }

  function estimateLightField(imageData, w, h, depth) {
    const { data } = imageData;
    let sumX = 0;
    let sumY = 0;
    let sumW = 0;
    let warm = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = y * w + x;
        const o = i * 4;
        const lum = (data[o] + data[o + 1] + data[o + 2]) / (3 * 255);
        const weight = lum * lum * (1.1 - depth[i]);
        sumX += x * weight;
        sumY += y * weight;
        sumW += weight;
        warm += ((data[o] - data[o + 2]) / 255) * weight;
      }
    }
    const cx = sumW ? sumX / sumW / w : 0.5;
    const cy = sumW ? sumY / sumW / h : 0.2;
    return {
      sunAngle: Math.min(90, Math.max(5, (1 - cy) * 70 + 10)),
      azimuth: (cx - 0.5) * 120,
      intensity: 0.7,
      colorTemp: warm / (sumW || 1),
      ambient: 0.35,
    };
  }

  function recoverHighlights(imageData, w, h, amount, profile, skyMask) {
    if (amount < 0.01) return imageData;
    const src = imageData.data;
    const out = new ImageData(new Uint8ClampedArray(src), w, h);
    const dst = out.data;
    const thr = 245 - (profile?.highlightRollOff || 0.85) * 20;

    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = (y * w + x) * 4;
        const clipped = src[i] >= thr && src[i + 1] >= thr && src[i + 2] >= thr;
        if (!clipped) continue;
        const inSky = !skyMask || skyMask[y * w + x] > 0.2;
        if (!inSky && amount < 0.5) continue;

        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (!dx && !dy) continue;
            const j = ((y + dy) * w + (x + dx)) * 4;
            if (src[j] >= thr && src[j + 1] >= thr && src[j + 2] >= thr) continue;
            r += src[j];
            g += src[j + 1];
            b += src[j + 2];
            n++;
          }
        }
        if (n < 2) {
          const t = x / w;
          r = 160 + t * 40;
          g = 185 + (1 - t) * 25;
          b = 210;
          n = 1;
        }
        r /= n;
        g /= n;
        b /= n;
        const a = amount * (inSky ? 1 : 0.5);
        dst[i] = src[i] * (1 - a) + r * a;
        dst[i + 1] = src[i + 1] * (1 - a) + g * a;
        dst[i + 2] = src[i + 2] * (1 - a) + b * a;
      }
    }
    return out;
  }

  function buildSkyMask(materials, depth, w, h) {
    const mask = new Float32Array(w * h);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = materials[i] === 0 || depth[i] < 0.32 ? 1 : depth[i] < 0.42 ? 0.4 : 0;
    }
    return smoothMap(mask, w, h, 2);
  }

  function buildEntityMask(entitiesId, materials, depth, w, h, faces) {
    const mask = new Float32Array(w * h);
    if (entitiesId === "sky") return buildSkyMask(materials, depth, w, h);

    if (entitiesId === "mountains" || entitiesId === "terrain") {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = y / h;
          mask[i] =
            (materials[i] === 3 || materials[i] === 5) &&
            v > 0.28 &&
            v < 0.75 &&
            depth[i] > 0.25 &&
            depth[i] < 0.7
              ? 1
              : 0;
        }
      }
      return smoothMap(mask, w, h, 1);
    }

    if (entitiesId === "foreground" || entitiesId === "ground") {
      for (let i = 0; i < mask.length; i++) {
        const y = Math.floor(i / w) / h;
        mask[i] = (materials[i] === 1 || materials[i] === 2 || y > 0.68) && depth[i] > 0.5 ? 1 : 0;
      }
      return smoothMap(mask, w, h, 1);
    }

    if (entitiesId === "face" || entitiesId === "skin") {
      for (let i = 0; i < mask.length; i++) mask[i] = materials[i] === 4 ? 1 : 0;
      if (faces?.length) {
        for (const f of faces) {
          const x0 = Math.floor(f.x * w);
          const y0 = Math.floor(f.y * h);
          const x1 = Math.ceil((f.x + f.w) * w);
          const y1 = Math.ceil((f.y + f.h) * h);
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = Math.max(mask[y * w + x], 0.85);
            }
          }
        }
      }
      return smoothMap(mask, w, h, 1);
    }

    if (entitiesId === "eyes" && faces?.length) {
      for (const f of faces) {
        const x0 = Math.floor((f.x + f.w * 0.15) * w);
        const x1 = Math.ceil((f.x + f.w * 0.85) * w);
        const y0 = Math.floor((f.y + f.h * 0.28) * h);
        const y1 = Math.ceil((f.y + f.h * 0.48) * h);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1;
          }
        }
      }
      return smoothMap(mask, w, h, 1);
    }

    return mask;
  }

  async function ingest(image, profile, opts = {}) {
    const working = imageToWorking(image, opts.maxW || 960);
    const depth = estimateDepth(working.imageData, working.w, working.h);
    const materials = estimateMaterials(working.imageData, working.w, working.h, depth);
    const lightField = estimateLightField(working.imageData, working.w, working.h, depth);
    const skyMask = buildSkyMask(materials, depth, working.w, working.h);
    return {
      source: image,
      profile: profile || CAMERA_PROFILES.default,
      working,
      depth,
      materials,
      lightField,
      skyMask,
      faces: [],
      fromRaw: !!opts.fromRaw,
      fileName: opts.fileName || "",
    };
  }

  return {
    CAMERA_PROFILES,
    guessProfile,
    decodeFile,
    extractEmbeddedJpeg,
    imageToWorking,
    estimateDepth,
    estimateMaterials,
    estimateLightField,
    recoverHighlights,
    buildSkyMask,
    buildEntityMask,
    ingest,
    smoothMap,
  };
})();
