/**
 * Neural alpha matting. Loads an ONNX matting model through Transformers.js
 * (WebGPU when available, WASM otherwise) and returns a float alpha matte at
 * working resolution. Model weights stream from the Hugging Face CDN on first
 * use and are then served from the browser HTTP cache.
 */
const LuminaMatte = (() => {
  const LIB_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

  const MODELS = {
    portrait: {
      id: "Xenova/modnet",
      label: "Portrait",
      note: "MODNet · people, hair detail · ~26 MB",
      license: "Apache-2.0",
      input: "input",
      output: "output",
      sigmoid: false,
      dtype: { webgpu: "fp32", wasm: "fp32" },
    },
    subject: {
      id: "onnx-community/BiRefNet_lite-ONNX",
      label: "Any subject",
      note: "BiRefNet-lite · products, animals, objects · ~115 MB",
      license: "MIT",
      input: "input_image",
      output: "output_image",
      sigmoid: true,
      dtype: { webgpu: "fp16", wasm: "fp32" },
    },
  };

  let lib = null;
  let libPromise = null;
  let device = null;
  const loaded = new Map();
  const loading = new Map();

  function listModels() {
    return Object.entries(MODELS).map(([key, m]) => ({
      key,
      label: m.label,
      note: m.note,
      license: m.license,
      ready: loaded.has(key),
    }));
  }

  function isReady(key) {
    return loaded.has(key);
  }

  /** Neural matting needs dynamic import + fetch; both are unavailable offline. */
  function isSupported() {
    return typeof WebAssembly !== "undefined" && typeof fetch === "function";
  }

  async function pickDevice() {
    if (device) return device;
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          device = "webgpu";
          return device;
        }
      } catch (_) {
        /* fall through to wasm */
      }
    }
    device = "wasm";
    return device;
  }

  async function loadLib() {
    if (lib) return lib;
    if (!libPromise) {
      libPromise = import(/* webpackIgnore: true */ LIB_URL).then((mod) => {
        const env = mod.env;
        // The app ships no local weights, so always resolve against the HF hub
        // and let the browser cache keep them between sessions.
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        try {
          // No COOP/COEP headers on the local static server, so SharedArrayBuffer
          // (and therefore threaded WASM) is unavailable.
          env.backends.onnx.wasm.numThreads = 1;
        } catch (_) {
          /* older builds expose no wasm knobs */
        }
        lib = mod;
        return mod;
      });
      libPromise.catch(() => {
        libPromise = null;
      });
    }
    return libPromise;
  }

  /**
   * Fetch + compile a model. Safe to call repeatedly; concurrent callers share
   * one load. onProgress receives { phase, pct, label }.
   */
  async function ensureModel(key, onProgress) {
    if (loaded.has(key)) return loaded.get(key);
    if (loading.has(key)) return loading.get(key);

    const cfg = MODELS[key];
    if (!cfg) throw new Error(`Unknown matting model: ${key}`);

    const task = (async () => {
      const mod = await loadLib();
      const dev = await pickDevice();
      const dtype = cfg.dtype[dev] || "fp32";

      const files = new Map();
      const report = (data) => {
        if (!onProgress) return;
        if (data.status === "progress" && data.total) {
          files.set(data.file, { loaded: data.loaded, total: data.total });
          let loadedBytes = 0;
          let totalBytes = 0;
          for (const f of files.values()) {
            loadedBytes += f.loaded;
            totalBytes += f.total;
          }
          onProgress({
            phase: "download",
            pct: totalBytes ? loadedBytes / totalBytes : 0,
            label: `Downloading ${cfg.label} model`,
          });
        } else if (data.status === "ready" || data.status === "done") {
          onProgress({ phase: "compile", pct: 1, label: `Preparing ${cfg.label} model` });
        }
      };

      const [model, processor] = await Promise.all([
        mod.AutoModel.from_pretrained(cfg.id, { dtype, device: dev, progress_callback: report }),
        mod.AutoProcessor.from_pretrained(cfg.id, { progress_callback: report }),
      ]);

      const entry = { cfg, model, processor, device: dev, dtype, RawImage: mod.RawImage };
      loaded.set(key, entry);
      return entry;
    })();

    loading.set(key, task);
    try {
      return await task;
    } finally {
      loading.delete(key);
    }
  }

  /**
   * Run matting on an ImageData and return a Float32Array of length w*h in 0..1.
   */
  async function run(imageData, key, onProgress) {
    const entry = await ensureModel(key, onProgress);
    onProgress?.({ phase: "infer", pct: 1, label: `Matting with ${entry.cfg.label}` });

    const image = new entry.RawImage(
      toRgb(imageData.data),
      imageData.width,
      imageData.height,
      3
    );
    const { pixel_values } = await entry.processor(image);
    const outputs = await entry.model({ [entry.cfg.input]: pixel_values });

    let tensor = outputs[entry.cfg.output] ?? Object.values(outputs)[0];
    if (!tensor) throw new Error("Matting model returned no output tensor");
    if (entry.cfg.sigmoid) tensor = tensor.sigmoid();
    if (tensor.type !== "float32") tensor = tensor.to("float32");

    const dims = tensor.dims;
    const mh = dims[dims.length - 2];
    const mw = dims[dims.length - 1];
    return resample(tensor.data, mw, mh, imageData.width, imageData.height);
  }

  /** Bilinear resample of the model matte back to working resolution. */
  function resample(src, sw, sh, dw, dh) {
    const out = new Float32Array(dw * dh);
    if (sw === dw && sh === dh) {
      for (let i = 0; i < out.length; i++) out[i] = clamp01(src[i]);
      return out;
    }
    const xRatio = sw / dw;
    const yRatio = sh / dh;
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * yRatio - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const wy = sy - y0;
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * xRatio - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(sw - 1, x0 + 1);
        const wx = sx - x0;
        const a = src[y0 * sw + x0];
        const b = src[y0 * sw + x1];
        const c = src[y1 * sw + x0];
        const d = src[y1 * sw + x1];
        const top = a + (b - a) * wx;
        const bottom = c + (d - c) * wx;
        out[y * dw + x] = clamp01(top + (bottom - top) * wy);
      }
    }
    return out;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** Processors expect RGB; drop the alpha channel the canvas always carries. */
  function toRgb(rgba) {
    const out = new Uint8ClampedArray((rgba.length / 4) * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      out[o] = rgba[i];
      out[o + 1] = rgba[i + 1];
      out[o + 2] = rgba[i + 2];
    }
    return out;
  }

  return { MODELS, listModels, isReady, isSupported, ensureModel, run };
})();
