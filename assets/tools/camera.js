/**
 * Live camera: still capture and video recording.
 *
 * The overlay has two states. Live shows the camera stream and can capture a
 * frame straight into the editor or record a clip. Review plays the recorded
 * clip back in the same <video>, so the frame grab path is shared: whatever the
 * element is showing is what gets captured.
 */
const LuminaCamera = (() => {
  /** Preferred first — MP4 travels better than WebM outside the browser. */
  const VIDEO_TYPES = [
    { mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: ".mp4", label: "MP4" },
    { mime: "video/mp4", ext: ".mp4", label: "MP4" },
    { mime: 'video/webm;codecs="vp9,opus"', ext: ".webm", label: "WebM" },
    { mime: 'video/webm;codecs="vp8,opus"', ext: ".webm", label: "WebM" },
    { mime: "video/webm", ext: ".webm", label: "WebM" },
  ];

  let stream = null;
  let deviceIds = [];
  let deviceIndex = 0;
  let busy = false;
  let onCapture = null;
  let toastFn = () => {};

  let micWanted = false;
  let recorder = null;
  let chunks = [];
  let recordType = null;
  let recStartedAt = 0;
  let recTimer = null;
  let clip = null;

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 8;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let hwZoom = null;
  let dragging = false;
  let dragLast = null;
  let pinchLast = 0;

  function els() {
    return {
      overlay: document.getElementById("cameraOverlay"),
      video: document.getElementById("cameraVideo"),
      status: document.getElementById("cameraStatus"),
      shot: document.getElementById("btnCameraShot"),
      flip: document.getElementById("btnCameraFlip"),
      close: document.getElementById("btnCameraClose"),
      record: document.getElementById("btnCameraRecord"),
      mic: document.getElementById("cameraMic"),
      badge: document.getElementById("cameraRecBadge"),
      time: document.getElementById("cameraRecTime"),
      review: document.getElementById("cameraReview"),
      reviewInfo: document.getElementById("cameraReviewInfo"),
      save: document.getElementById("btnClipSave"),
      discard: document.getElementById("btnClipDiscard"),
      subtitle: document.getElementById("cameraSubtitle"),
      stage: document.getElementById("cameraStage"),
      zoomBar: document.getElementById("cameraZoomBar"),
      zoomIn: document.getElementById("btnCameraZoomIn"),
      zoomOut: document.getElementById("btnCameraZoomOut"),
      zoomLabel: document.getElementById("cameraZoomLabel"),
    };
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function resetView() {
    zoom = 1;
    pan = { x: 0, y: 0 };
    dragging = false;
    dragLast = null;
    pinchLast = 0;
    applyView();
  }

  function clampPan() {
    const extra = (zoom - 1) / 2;
    pan.x = clamp(pan.x, -extra, extra);
    pan.y = clamp(pan.y, -extra, extra);
  }

  function digitalZoom() {
    return hwZoom ? Math.max(1, zoom / hwZoom) : zoom;
  }

  function applyView() {
    const { video, zoomLabel, zoomOut } = els();
    const digital = digitalZoom();
    if (video) {
      video.style.transform = `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${digital})`;
    }
    if (zoomLabel) zoomLabel.textContent = `${zoom.toFixed(1)}×`;
    if (zoomOut) zoomOut.disabled = zoom <= ZOOM_MIN + 0.001;
    applyHardwareZoom();
  }

  function setZoom(next, anchor) {
    const prev = zoom;
    zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
    if (anchor && prev > 0 && zoom !== prev) {
      const { stage } = els();
      if (stage) {
        const r = stage.getBoundingClientRect();
        const nx = ((anchor.x - r.left) / r.width - 0.5) / prev - pan.x;
        const ny = ((anchor.y - r.top) / r.height - 0.5) / prev - pan.y;
        pan.x += nx * (1 - zoom / prev);
        pan.y += ny * (1 - zoom / prev);
      }
    }
    if (zoom <= 1.001) pan = { x: 0, y: 0 };
    else clampPan();
    applyView();
  }

  function zoomBy(factor, anchor) {
    setZoom(zoom * factor, anchor);
  }

  function applyHardwareZoom() {
    const track = stream?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();
    if (!caps?.zoom || !track.applyConstraints) {
      hwZoom = null;
      return;
    }
    const wanted = clamp(zoom, caps.zoom.min, caps.zoom.max);
    if (hwZoom != null && Math.abs(hwZoom - wanted) < 0.05) return;
    hwZoom = wanted;
    track.applyConstraints({ advanced: [{ zoom: wanted }] }).finally(() => {
      const { video } = els();
      if (!video || inReview()) return;
      const digital = digitalZoom();
      video.style.transform = `translate(${pan.x * 100}%, ${pan.y * 100}%) scale(${digital})`;
    });
  }

  function visibleCrop(video) {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const digital = digitalZoom();
    const sw = vw / digital;
    const sh = vh / digital;
    const sx = (vw - sw) / 2 - pan.x * vw;
    const sy = (vh - sh) / 2 - pan.y * vh;
    return {
      sx: clamp(sx, 0, Math.max(0, vw - sw)),
      sy: clamp(sy, 0, Math.max(0, vh - sh)),
      sw,
      sh,
      dw: Math.max(2, Math.round(sw)),
      dh: Math.max(2, Math.round(sh)),
    };
  }

  function supportedType() {
    if (typeof MediaRecorder === "undefined") return null;
    return VIDEO_TYPES.find((t) => {
      try {
        return MediaRecorder.isTypeSupported(t.mime);
      } catch {
        return false;
      }
    }) || null;
  }

  function setStatus(text) {
    const { status } = els();
    if (!status) return;
    if (!text) {
      status.hidden = true;
      status.textContent = "";
      return;
    }
    status.hidden = false;
    status.textContent = text;
  }

  function setSubtitle(text) {
    const { subtitle } = els();
    if (subtitle) subtitle.textContent = text;
  }

  function isRecording() {
    return !!recorder && recorder.state === "recording";
  }

  function inReview() {
    return !!clip;
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    const { video } = els();
    if (video) video.srcObject = null;
  }

  function releaseClip() {
    if (clip?.url) URL.revokeObjectURL(clip.url);
    clip = null;
  }

  function close() {
    if (isRecording()) {
      try {
        recorder.stop();
      } catch (_) {
        /* already stopping */
      }
    }
    recorder = null;
    chunks = [];
    stopTimer();
    stopStream();
    releaseClip();
    busy = false;
    const { overlay, shot, flip, record, badge, review, video } = els();
    if (overlay) overlay.hidden = true;
    if (shot) {
      shot.disabled = true;
      shot.textContent = "Capture";
    }
    if (flip) flip.hidden = true;
    if (record) {
      record.disabled = true;
      record.textContent = "Record";
      record.classList.remove("recording");
    }
    if (badge) badge.hidden = true;
    if (review) review.hidden = true;
    const zoomBar = els().zoomBar;
    if (zoomBar) zoomBar.hidden = false;
    if (video) {
      video.removeAttribute("src");
      video.controls = false;
      video.loop = false;
      video.muted = true;
      video.style.transform = "";
      video.load();
    }
    hwZoom = null;
    resetView();
  }

  async function listVideoInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput" && d.deviceId).map((d) => d.deviceId);
  }

  async function startStream(deviceId) {
    stopStream();
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micWanted, video });
    } catch (err) {
      if (micWanted) {
        // Mic refused or missing — keep the camera rather than failing outright.
        micWanted = false;
        const { mic } = els();
        if (mic) mic.checked = false;
        toastFn("Microphone unavailable — recording video only");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }).catch(() =>
          navigator.mediaDevices.getUserMedia({ audio: false, video: true })
        );
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      }
    }
    const el = els();
    el.video.srcObject = stream;
    el.video.muted = true;
    el.video.controls = false;
    await el.video.play().catch(() => {});
    hwZoom = null;
    applyView();
    setStatus("");
    if (el.shot) el.shot.disabled = false;
    if (el.record) el.record.disabled = !supportedType();
  }

  async function open(handlers = {}) {
    onCapture = handlers.onCapture || onCapture;
    toastFn = handlers.toast || toastFn;
    const { overlay, shot, flip, record } = els();
    if (!overlay) return;

    if (!window.isSecureContext) {
      toastFn("Camera needs HTTPS or localhost (not file://)");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toastFn("Camera API not available in this browser");
      return;
    }

    releaseClip();
    exitReview({ silent: true });
    resetView();
    overlay.hidden = false;
    if (shot) shot.disabled = true;
    if (record) record.disabled = true;
    setStatus("Starting camera…");

    try {
      await startStream(null);
      deviceIds = await listVideoInputs();
      if (deviceIds.length > 1 && flip) {
        flip.hidden = false;
        const activeId = stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
        const idx = deviceIds.indexOf(activeId);
        deviceIndex = idx >= 0 ? idx : 0;
      } else if (flip) {
        flip.hidden = true;
      }
      if (!supportedType()) {
        setSubtitle("Capture a still — recording unsupported in this browser");
      } else {
        setSubtitle("Capture a still or record a clip · pinch or +/− to zoom");
      }
      if (handlers.record) startRecording();
    } catch (err) {
      setStatus(
        err?.name === "NotAllowedError"
          ? "Camera permission denied — allow access and try again"
          : err?.message || "Could not open camera"
      );
      toastFn("Camera unavailable");
    }
  }

  async function flip() {
    if (busy || isRecording() || inReview() || deviceIds.length < 2) return;
    deviceIndex = (deviceIndex + 1) % deviceIds.length;
    setStatus("Switching camera…");
    const { shot } = els();
    if (shot) shot.disabled = true;
    try {
      await startStream(deviceIds[deviceIndex]);
    } catch (err) {
      setStatus(err?.message || "Could not switch camera");
    }
  }

  /* —— recording —— */

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function startTimer() {
    const { time } = els();
    recStartedAt = performance.now();
    stopTimer();
    recTimer = setInterval(() => {
      if (time) time.textContent = formatTime(performance.now() - recStartedAt);
    }, 250);
    if (time) time.textContent = "0:00";
  }

  function stopTimer() {
    if (recTimer) clearInterval(recTimer);
    recTimer = null;
  }

  function startRecording() {
    if (isRecording() || !stream) return;
    const type = supportedType();
    if (!type) {
      toastFn("Video recording is not supported in this browser");
      return;
    }
    chunks = [];
    recordType = type;
    try {
      recorder = new MediaRecorder(stream, { mimeType: type.mime });
    } catch (err) {
      console.warn("[LuminaCamera] recorder init failed:", err);
      toastFn("Could not start recording");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => finishRecording();
    recorder.onerror = () => {
      toastFn("Recording stopped unexpectedly");
      finishRecording();
    };
    recorder.start(1000);

    const { record, badge, shot, flip: flipBtn, mic } = els();
    if (record) {
      record.textContent = "Stop";
      record.classList.add("recording");
    }
    if (badge) badge.hidden = false;
    if (shot) shot.disabled = false;
    if (flipBtn) flipBtn.disabled = true;
    if (mic) mic.disabled = true;
    setSubtitle(micWanted ? "Recording with microphone" : "Recording — no audio");
    startTimer();
  }

  function stopRecording() {
    if (!isRecording()) return;
    try {
      recorder.stop();
    } catch (_) {
      finishRecording();
    }
  }

  function finishRecording() {
    stopTimer();
    const duration = recStartedAt ? performance.now() - recStartedAt : 0;
    const { record, badge, flip: flipBtn, mic } = els();
    if (record) {
      record.textContent = "Record";
      record.classList.remove("recording");
    }
    if (badge) badge.hidden = true;
    if (flipBtn) flipBtn.disabled = false;
    if (mic) mic.disabled = false;
    recorder = null;

    if (!chunks.length) {
      setSubtitle("Capture a still or record a clip · pinch or +/− to zoom");
      return;
    }
    const type = recordType || VIDEO_TYPES[VIDEO_TYPES.length - 1];
    const blob = new Blob(chunks, { type: type.mime.split(";")[0] });
    chunks = [];
    releaseClip();
    clip = {
      blob,
      url: URL.createObjectURL(blob),
      ext: type.ext,
      label: type.label,
      duration,
      size: blob.size,
    };
    enterReview();
  }

  function enterReview() {
    const { video, review, reviewInfo, shot, record, flip: flipBtn, zoomBar } = els();
    if (!clip || !video) return;
    stopStream();
    video.style.transform = "";
    video.srcObject = null;
    video.src = clip.url;
    video.controls = true;
    video.loop = true;
    video.muted = false;
    video.play().catch(() => {});
    if (review) review.hidden = false;
    if (reviewInfo) {
      const mb = (clip.size / (1024 * 1024)).toFixed(1);
      reviewInfo.textContent = `${clip.label} · ${formatTime(clip.duration)} · ${mb} MB`;
    }
    if (shot) {
      shot.disabled = false;
      shot.textContent = "Use this frame";
    }
    if (record) record.disabled = true;
    if (flipBtn) flipBtn.disabled = true;
    if (zoomBar) zoomBar.hidden = true;
    setSubtitle("Scrub to a moment, then save the clip or pull the frame in");
  }

  function exitReview({ silent = false } = {}) {
    const { video, review, shot, record, flip: flipBtn, zoomBar } = els();
    if (review) review.hidden = true;
    if (zoomBar) zoomBar.hidden = false;
    if (shot) shot.textContent = "Capture";
    if (record) record.disabled = !supportedType();
    if (flipBtn) flipBtn.disabled = false;
    if (video) {
      video.pause?.();
      video.removeAttribute("src");
      video.controls = false;
      video.loop = false;
      video.muted = true;
    }
    releaseClip();
    resetView();
    if (!silent) {
      setSubtitle("Capture a still or record a clip · pinch or +/− to zoom");
      startStream(deviceIds[deviceIndex]).catch(() => setStatus("Could not restart the camera"));
    }
  }

  async function saveClip() {
    if (!clip) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    try {
      const result = await LuminaPersist.saveAs({
        suggestedName: `clip-${stamp}${clip.ext}`,
        blob: clip.blob,
        mime: clip.blob.type,
        description: `${clip.label} Video`,
        extensions: [clip.ext],
      });
      if (result.cancelled) {
        toastFn("Save cancelled");
        return;
      }
      toastFn(result.name ? `Saved “${result.name}”` : "Video saved");
    } catch (err) {
      toastFn(err?.message || "Could not save the video");
    }
  }

  /* —— stills —— */

  function frameToFile(video) {
    const crop = visibleCrop(video);
    const canvas = document.createElement("canvas");
    canvas.width = crop.dw;
    canvas.height = crop.dh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.dw, crop.dh);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Capture failed"));
            return;
          }
          const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          resolve(new File([blob], `camera-${stamp}.jpg`, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.92
      );
    });
  }

  async function capture() {
    if (busy) return;
    const { video, shot } = els();
    if (!video || !video.videoWidth) return;
    if (!video.srcObject && !clip) return;
    busy = true;
    if (shot) shot.disabled = true;
    setStatus("Capturing…");
    try {
      const file = await frameToFile(video);
      close();
      await onCapture?.(file);
    } catch (err) {
      setStatus(err?.message || "Capture failed");
      if (shot) shot.disabled = false;
      busy = false;
    }
  }

  function init(handlers = {}) {
    const el = els();
    el.close?.addEventListener("click", () => close());
    el.shot?.addEventListener("click", () => capture());
    el.flip?.addEventListener("click", () => flip());
    el.zoomIn?.addEventListener("click", () => zoomBy(1.25));
    el.zoomOut?.addEventListener("click", () => zoomBy(0.8));
    el.zoomLabel?.addEventListener("click", () => setZoom(1));

    const stage = el.stage;
    stage?.addEventListener(
      "wheel",
      (e) => {
        if (inReview()) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX, y: e.clientY });
      },
      { passive: false }
    );
    stage?.addEventListener("pointerdown", (e) => {
      if (inReview() || zoom <= 1.001 || e.pointerType === "touch") return;
      dragging = true;
      dragLast = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture?.(e.pointerId);
    });
    stage?.addEventListener("pointermove", (e) => {
      if (!dragging || !dragLast || inReview()) return;
      const r = stage.getBoundingClientRect();
      pan.x += (e.clientX - dragLast.x) / (r.width * zoom);
      pan.y += (e.clientY - dragLast.y) / (r.height * zoom);
      dragLast = { x: e.clientX, y: e.clientY };
      clampPan();
      applyView();
    });
    const endDrag = () => {
      dragging = false;
      dragLast = null;
    };
    stage?.addEventListener("pointerup", endDrag);
    stage?.addEventListener("pointercancel", endDrag);
    stage?.addEventListener(
      "touchstart",
      (e) => {
        if (inReview()) return;
        if (e.touches.length === 2) {
          const a = e.touches[0];
          const b = e.touches[1];
          pinchLast = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        }
      },
      { passive: true }
    );
    stage?.addEventListener(
      "touchmove",
      (e) => {
        if (inReview() || e.touches.length !== 2 || !pinchLast) return;
        e.preventDefault();
        const a = e.touches[0];
        const b = e.touches[1];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        zoomBy(dist / pinchLast, mid);
        pinchLast = dist;
      },
      { passive: false }
    );
    stage?.addEventListener("touchend", () => {
      pinchLast = 0;
    });
    el.record?.addEventListener("click", () => {
      if (isRecording()) stopRecording();
      else startRecording();
    });
    el.mic?.addEventListener("change", async () => {
      micWanted = !!el.mic.checked;
      if (!stream || isRecording()) return;
      setStatus("Switching audio…");
      try {
        await startStream(deviceIds[deviceIndex]);
      } catch {
        setStatus("Could not apply the microphone setting");
      }
    });
    el.save?.addEventListener("click", () => saveClip());
    el.discard?.addEventListener("click", () => exitReview());
    el.overlay?.addEventListener("click", (e) => {
      if (e.target === el.overlay && !isRecording()) close();
    });
    window.addEventListener("keydown", (e) => {
      const overlay = els().overlay;
      if (!overlay || overlay.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        if (!inReview()) zoomBy(1.25);
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        if (!inReview()) zoomBy(0.8);
      }
      if (e.key === "0" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        if (!inReview()) setZoom(1);
      }
      if (e.key.toLowerCase() === "r" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        if (isRecording()) stopRecording();
        else if (!inReview()) startRecording();
      }
    });
    if (handlers.onCapture) onCapture = handlers.onCapture;
    if (handlers.toast) toastFn = handlers.toast;
  }

  return {
    init,
    open,
    close,
    startRecording,
    stopRecording,
    isRecording,
    saveClip,
    canRecord: () => !!supportedType(),
  };
})();
