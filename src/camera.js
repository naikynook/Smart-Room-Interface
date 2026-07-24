/**
 * Lightweight webcam preview — no TensorFlow dependency.
 */

export function describeCameraError(err) {
  const name = err?.name || "Error";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission denied. Allow camera for this site, then refresh.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera was found on this computer.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Camera is busy — close Zoom/Teams/other apps using it, then refresh.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "This camera rejected the settings. Retrying with defaults…";
  }
  if (name === "SecurityError") {
    return "Camera blocked by browser security. Use http://localhost:5173 (not a file:// link).";
  }
  if (name === "AbortError") {
    return "Camera request was interrupted. Click the preview box to try again.";
  }
  if (name === "TimeoutError") {
    return "Camera request timed out. Click the black camera box to retry.";
  }
  return `Camera error (${name}): ${err?.message || "unknown"}`;
}

async function requestStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error("Camera API not available in this browser.");
    err.name = "NotSupportedError";
    throw err;
  }

  const attempts = [
    { video: true, audio: false },
    { video: { facingMode: "user" }, audio: false },
    { video: { facingMode: { ideal: "user" } }, audio: false },
  ];

  let lastErr;
  for (const constraints of attempts) {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise((_, reject) => {
          window.setTimeout(() => {
            const err = new Error("Camera request timed out. Click the camera box to retry.");
            err.name = "TimeoutError";
            reject(err);
          }, 8000);
        }),
      ]);
      return stream;
    } catch (err) {
      lastErr = err;
      console.warn("getUserMedia attempt failed:", constraints, err);
    }
  }
  throw lastErr;
}

export async function startCameraPreview(videoEl) {
  const video = videoEl || document.getElementById("camera-feed");
  if (!video) {
    const err = new Error("Missing #camera-feed video element.");
    err.name = "MissingElementError";
    throw err;
  }

  // Stop any previous tracks so a retry can reclaim the device
  if (video.srcObject) {
    try {
      for (const track of video.srcObject.getTracks()) track.stop();
    } catch {
      // ignore
    }
    video.srcObject = null;
  }

  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;

  const stream = await requestStream();
  video.srcObject = stream;

  // Wait until a real frame is available
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(); // stream may still work even if metadata is slow
    }, 4000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    if (video.readyState >= 2) onReady();
  });

  try {
    await video.play();
  } catch (err) {
    console.warn("video.play() deferred:", err);
  }

  if (!stream.getVideoTracks().some((t) => t.readyState === "live")) {
    const err = new Error("Camera track is not live.");
    err.name = "NotReadableError";
    throw err;
  }

  return { video, stream };
}

/**
 * Click-to-retry helper for flaky permission / autoplay cases.
 */
export function wireCameraRetry(videoEl, { onSuccess, onError } = {}) {
  const video = videoEl || document.getElementById("camera-feed");
  if (!video || video.dataset.cameraRetryWired) return;
  video.dataset.cameraRetryWired = "1";
  video.style.cursor = "pointer";
  video.title = "Click to enable camera";

  video.addEventListener("click", async () => {
    try {
      const result = await startCameraPreview(video);
      onSuccess?.(result);
    } catch (err) {
      console.error(err);
      onError?.(err);
    }
  });
}
