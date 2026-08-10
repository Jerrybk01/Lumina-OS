/**
 * Semantic segmentation + face/portrait entity detection.
 */
const LuminaSegment = (() => {
  async function detectFaces(canvas) {
    const faces = [];
    try {
      if ("FaceDetector" in window) {
        const detector = new FaceDetector({ fastMode: true, maxDetectedFaces: 8 });
        const result = await detector.detect(canvas);
        for (const f of result) {
          const b = f.boundingBox;
          faces.push({
            x: b.x / canvas.width,
            y: b.y / canvas.height,
            w: b.width / canvas.width,
            h: b.height / canvas.height,
          });
        }
      }
    } catch (_) {
      /* unsupported or permission */
    }

    if (!faces.length) {
      // Only run skin-blob fallback when the frame looks portrait-like (little sky)
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const { width: w, height: h } = canvas;
      const data = ctx.getImageData(0, 0, w, h).data;
      let skyish = 0;
      let samples = 0;
      for (let y = 0; y < h * 0.4; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = (r + g + b) / 3;
          if (b > r && lum > 140) skyish++;
          samples++;
        }
      }
      if (skyish / samples > 0.28) return faces;

      let minX = w;
      let minY = h;
      let maxX = 0;
      let maxY = 0;
      let count = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            count++;
          }
        }
      }
      const area = ((maxX - minX) * (maxY - minY)) / (w * h);
      if (count > 120 && area > 0.03 && area < 0.4) {
        faces.push({
          x: minX / w,
          y: minY / h,
          w: (maxX - minX) / w,
          h: (maxY - minY) / h,
        });
      }
    }
    return faces;
  }

  function buildEntities(scene) {
    const { materials, depth, working, faces } = scene;
    const w = working.w;
    const h = working.h;
    const counts = { sky: 0, mountains: 0, foreground: 0, skin: 0, other: 0 };
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      const v = Math.floor(i / w) / h;
      if (m === 0 || depth[i] < 0.3) counts.sky++;
      else if (m === 4) counts.skin++;
      else if (v > 0.68) counts.foreground++;
      else if (v > 0.32 && v < 0.72) counts.mountains++;
      else counts.other++;
    }
    const total = materials.length;
    const entities = [];

    if (counts.sky / total > 0.05) {
      entities.push({
        id: "sky",
        name: "Sky",
        context: "Atmospheric HUD",
        score: counts.sky / total,
        region: averageRegion(materials, depth, w, h, (m, d, v) => m === 0 || d < 0.32),
        controls: [
          { key: "refractiveHaze", label: "Refractive Haze", min: 0, max: 1, step: 0.01 },
          { key: "cloudDensity", label: "Cloud Volumetric Density", min: 0, max: 1, step: 0.01 },
          { key: "drRecovery", label: "Scatter Recover", min: 0, max: 1, step: 0.01 },
        ],
      });
    }

    if (counts.mountains / total > 0.08) {
      entities.push({
        id: "mountains",
        name: "Mountains",
        context: "Terrain HUD",
        score: counts.mountains / total,
        region: averageRegion(materials, depth, w, h, (m, d, v) => v > 0.3 && v < 0.72 && d > 0.25 && d < 0.7 && m !== 0),
        controls: [
          { key: "bounceReflectance", label: "Bounce Reflectance", min: 0, max: 1, step: 0.01 },
          { key: "surfaceTexture", label: "Surface Texture", min: 0, max: 1, step: 0.01 },
          { key: "goldenHour", label: "Warm Relight", min: 0, max: 1, step: 0.01 },
        ],
      });
    }

    if (counts.foreground / total > 0.06) {
      entities.push({
        id: "foreground",
        name: "Foreground",
        context: "Ground HUD",
        score: counts.foreground / total,
        region: averageRegion(materials, depth, w, h, (m, d, v) => v > 0.65 || m === 1 || m === 2),
        controls: [
          { key: "sssDepth", label: "Subsurface Scatter", min: 0, max: 1, step: 0.01 },
          { key: "atmosphericHaze", label: "Near Haze", min: 0, max: 1, step: 0.01 },
          { key: "surfaceTexture", label: "Micro Texture", min: 0, max: 1, step: 0.01 },
        ],
      });
    }

    if (faces?.length) {
      const face = faces[0];
      entities.push({
        id: "skin",
        name: "Skin",
        context: "Portrait Context HUD",
        score: Math.max(counts.skin / total, 0.3),
        region: {
          x0: face.x,
          y0: face.y,
          x1: face.x + face.w,
          y1: face.y + face.h,
        },
        controls: [
          { key: "sssDepth", label: "Subsurface Scattering Depth", min: 0, max: 1, step: 0.01 },
          { key: "surfaceTexture", label: "Surface Texture / Pores", min: 0, max: 1, step: 0.01 },
        ],
      });
      entities.push({
        id: "eyes",
        name: "Eyes",
        context: "Portrait Context HUD",
        score: 0.4,
        region: {
          x0: face.x + face.w * 0.15,
          y0: face.y + face.h * 0.28,
          x1: face.x + face.w * 0.85,
          y1: face.y + face.h * 0.48,
        },
        controls: [
          { key: "catchlight", label: "Catchlight Intensity", min: 0, max: 1, step: 0.01 },
          { key: "irisReflectance", label: "Iris Reflectance", min: 0, max: 1, step: 0.01 },
        ],
      });
    } else if (counts.skin / total > 0.08) {
      entities.push({
        id: "skin",
        name: "Skin",
        context: "Portrait Context HUD",
        score: counts.skin / total,
        region: averageRegion(materials, depth, w, h, (m) => m === 4),
        controls: [
          { key: "sssDepth", label: "Subsurface Scattering Depth", min: 0, max: 1, step: 0.01 },
          { key: "surfaceTexture", label: "Surface Texture / Pores", min: 0, max: 1, step: 0.01 },
        ],
      });
    }

    return entities;
  }

  function averageRegion(materials, depth, w, h, pred) {
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = y * w + x;
        const v = y / h;
        if (pred(materials[i], depth[i], v)) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!found) return { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.4 };
    return {
      x0: minX / w,
      y0: minY / h,
      x1: maxX / w,
      y1: maxY / h,
    };
  }

  function hitTest(entities, nx, ny) {
    // Prefer smaller / higher-score entities containing point
    const hits = entities.filter((e) => {
      const r = e.region;
      return nx >= r.x0 && nx <= r.x1 && ny >= r.y0 && ny <= r.y1;
    });
    if (!hits.length) return null;
    hits.sort((a, b) => {
      const aa = (a.region.x1 - a.region.x0) * (a.region.y1 - a.region.y0);
      const bb = (b.region.x1 - b.region.x0) * (b.region.y1 - b.region.y0);
      return aa - bb || b.score - a.score;
    });
    return hits[0];
  }

  function findByName(entities, query) {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return (
      entities.find((e) => e.id === q || e.name.toLowerCase() === q) ||
      entities.find((e) => e.name.toLowerCase().includes(q) || e.id.includes(q)) ||
      null
    );
  }

  return { detectFaces, buildEntities, hitTest, findByName };
})();
