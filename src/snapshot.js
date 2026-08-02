/**
 * "Take a picture" flow:
 * - Capture the current webcam frame (mirrored, to match the on-screen preview)
 * - Send it to the DeepFace API on Modal
 * - Draw annotated boxes (age / gender / race / emotion) + a people count
 * - Pop the photo up for a few seconds, then leave a "Download photo" button
 */

const API_URL = (import.meta.env.VITE_DEEPFACE_API_URL || "").replace(/\/+$/, "");

const POPUP_VISIBLE_MS = 3200;

let lastCanvas = null;
let popupEl = null;
let cornerBtn = null;
let hideTimer = 0;

export function isPhotoApiConfigured() {
  return Boolean(API_URL);
}

// ---------------------------------------------------------------------------
// Capture + API
// ---------------------------------------------------------------------------

function captureFrame(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Camera frame not available yet.");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Mirror so the saved photo matches the mirrored preview the user sees
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return canvas;
}

async function analyzeImage(dataUrl) {
  const res = await fetch(`${API_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepFace API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Annotation drawing
// ---------------------------------------------------------------------------

const BOX_COLORS = ["#27e0a6", "#4aa8ff", "#c792ea", "#ffd166", "#ff6b81"];

function titleCase(s) {
  return String(s || "")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function drawAnnotations(canvas, result) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;

  // Sizes scale with the frame so labels stay readable at any resolution
  const unit = Math.max(1, w / 640);
  const boxStroke = 2.5 * unit;
  const fontPx = Math.round(11 * unit);
  const lineH = Math.round(fontPx * 1.35);
  const pad = Math.round(5 * unit);
  const font = `600 ${fontPx}px "Segoe UI", system-ui, sans-serif`;

  const faces = result.faces || [];

  faces.forEach((face, i) => {
    const color = BOX_COLORS[i % BOX_COLORS.length];
    const { x, y, w: bw, h: bh } = face.box;

    ctx.strokeStyle = color;
    ctx.lineWidth = boxStroke;
    ctx.strokeRect(x, y, bw, bh);

    const lines = [
      `Person ${i + 1}`,
      `Age ~${face.age}`,
      `Gender: ${titleCase(face.gender)}`,
      `Race: ${titleCase(face.race)}`,
      `Emotion: ${titleCase(face.emotion)}`,
    ];

    ctx.font = font;
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const blockW = textW + pad * 2;
    const blockH = lines.length * lineH + pad * 2;

    // Prefer above the box; fall back to inside-top if it would clip
    let lx = Math.min(Math.max(0, x), canvas.width - blockW);
    let ly = y - blockH - boxStroke;
    if (ly < 0) ly = y + boxStroke;

    ctx.fillStyle = "rgba(10, 12, 16, 0.78)";
    ctx.fillRect(lx, ly, blockW, blockH);
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly, 3 * unit, blockH);

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "top";
    lines.forEach((line, li) => {
      ctx.fillText(line, lx + pad + 3 * unit, ly + pad + li * lineH);
    });
  });

  // Header: people count + timestamp
  const count = result.count ?? faces.length;
  const header =
    count === 1 ? "1 person detected" : `${count} people detected`;
  const stamp = new Date().toLocaleString();
  const headerFont = `700 ${Math.round(13 * unit)}px "Segoe UI", system-ui, sans-serif`;

  ctx.font = headerFont;
  const headerW =
    Math.max(ctx.measureText(header).width, ctx.measureText(stamp).width) +
    pad * 2;
  const headerH = Math.round(13 * unit * 1.4) * 2 + pad * 2;

  ctx.fillStyle = "rgba(10, 12, 16, 0.78)";
  ctx.fillRect(pad, pad, headerW, headerH);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.fillText(header, pad * 2, pad * 2);
  ctx.font = `400 ${Math.round(11 * unit)}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(stamp, pad * 2, pad * 2 + Math.round(13 * unit * 1.4));
}

// ---------------------------------------------------------------------------
// Popup + download
// ---------------------------------------------------------------------------

function downloadLastPhoto() {
  if (!lastCanvas) return;
  lastCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart-room-photo-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function ensureElements() {
  if (!popupEl) {
    popupEl = document.createElement("div");
    popupEl.id = "photo-popup";
    popupEl.innerHTML = `
      <div class="photo-popup-frame">
        <img alt="Annotated snapshot" />
        <button type="button" class="photo-popup-download" title="Download photo">Download</button>
      </div>
    `;
    popupEl
      .querySelector(".photo-popup-download")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        downloadLastPhoto();
      });
    // Clicking the photo dismisses it early
    popupEl.addEventListener("click", hidePopup);
    document.body.appendChild(popupEl);
  }

  if (!cornerBtn) {
    cornerBtn = document.createElement("button");
    cornerBtn.id = "photo-download-corner";
    cornerBtn.type = "button";
    cornerBtn.textContent = "Download photo";
    cornerBtn.addEventListener("click", downloadLastPhoto);
    document.body.appendChild(cornerBtn);
  }
}

function hidePopup() {
  window.clearTimeout(hideTimer);
  if (popupEl) popupEl.classList.remove("visible");
  if (cornerBtn && lastCanvas) cornerBtn.classList.add("visible");
}

function showPopup(canvas) {
  ensureElements();

  const img = popupEl.querySelector("img");
  img.src = canvas.toDataURL("image/png");

  cornerBtn.classList.remove("visible");
  popupEl.classList.add("visible");

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hidePopup, POPUP_VISIBLE_MS);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function summarize(result) {
  const faces = result.faces || [];
  const count = result.count ?? faces.length;
  if (!count) return "Picture taken, but I don't see anyone in it.";

  const people = count === 1 ? "one person" : `${count} people`;
  const f = faces[0];
  const detail = f
    ? ` The ${count === 1 ? "person" : "closest person"} looks ${f.emotion}, around ${f.age} years old.`
    : "";
  return `I see ${people}.${detail}`;
}

export async function takePicture(video, { onStatus } = {}) {
  if (!API_URL) {
    const err = new Error(
      "Photo API not configured — set VITE_DEEPFACE_API_URL in .env.local and restart the dev server."
    );
    err.code = "NO_API";
    throw err;
  }

  const canvas = captureFrame(video);
  onStatus?.("Analyzing photo…");

  const result = await analyzeImage(canvas.toDataURL("image/jpeg", 0.92));

  drawAnnotations(canvas, result);
  lastCanvas = canvas;
  showPopup(canvas);

  return {
    count: result.count,
    faces: result.faces,
    summary: summarize(result),
  };
}
