"""
DeepFace analysis API for the Smart Room Interface, hosted on Modal.

One-time setup (on your machine):
    pip install modal
    modal setup

Deploy:
    modal deploy modal_app/deepface_api.py

Dev loop (temporary URL, hot-reloads on save):
    modal serve modal_app/deepface_api.py

After deploying, Modal prints a URL like:
    https://<your-workspace>--smart-room-deepface-api.modal.run

Put that URL in .env.local as:
    VITE_DEEPFACE_API_URL=https://<your-workspace>--smart-room-deepface-api.modal.run

The frontend POSTs a base64 JPEG to <url>/analyze and receives face boxes with
age / gender / race / emotion, which it draws on the snapshot.
"""

import modal

ACTIONS = ["age", "gender", "race", "emotion"]

# SSD is much more resistant to false positives than the default Haar cascade,
# while staying fast on CPU.
DETECTOR = "ssd"

# Detections below this confidence, or smaller than this fraction of the
# frame area, are discarded as false positives.
MIN_CONFIDENCE = 0.80
MIN_BOX_FRACTION = 0.002

# Only these sites may call the API. Add your GitHub Pages URL (or custom
# domain) here when you publish, then redeploy.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://naikynook.github.io",
]

# Per-visitor rate limit for /analyze
RATE_LIMIT_MAX_REQUESTS = 15
RATE_LIMIT_WINDOW_S = 60


def download_weights():
    """Run a dummy analysis at image-build time so all DeepFace model weights
    (age, gender, race, emotion + the OpenCV detector) are baked into the
    container image. Cold starts then skip the multi-hundred-MB downloads."""
    import numpy as np
    from deepface import DeepFace

    dummy = np.zeros((320, 320, 3), dtype=np.uint8)
    DeepFace.analyze(
        dummy,
        actions=ACTIONS,
        detector_backend=DETECTOR,
        enforce_detection=False,
        silent=True,
    )


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "deepface==0.0.93",
        "tf-keras",
        "numpy",
        "fastapi[standard]",
    )
    # DeepFace pulls in opencv-python as a dependency; installing both it and
    # the headless variant corrupts the cv2/data files. Strip every variant,
    # then install exactly one clean headless build.
    .run_commands(
        "pip uninstall -y opencv-python opencv-python-headless opencv-contrib-python",
        "pip install --no-cache-dir opencv-python-headless==4.10.0.84",
    )
    .run_function(download_weights)
)

app = modal.App("smart-room-deepface")


@app.function(image=image, timeout=120)
@modal.asgi_app()
def api():
    import base64
    import time
    from collections import defaultdict, deque

    import cv2
    import numpy as np
    from deepface import DeepFace
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware

    web = FastAPI(title="Smart Room DeepFace API")

    # Browsers enforce this list — pages on other domains can't read responses
    web.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Server-side origin check: reject requests that don't come from one of
    # our own pages (curl/scripts send no Origin header and are rejected too)
    def require_allowed_origin(request: Request):
        origin = request.headers.get("origin") or ""
        referer = request.headers.get("referer") or ""
        if origin in ALLOWED_ORIGINS:
            return
        if any(referer.startswith(o) for o in ALLOWED_ORIGINS):
            return
        raise HTTPException(status_code=403, detail="Origin not allowed.")

    # Simple sliding-window rate limit per client IP (per container — good
    # enough to stop someone hammering the endpoint and draining credit)
    request_log = defaultdict(deque)

    def enforce_rate_limit(request: Request):
        ip = (
            request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "unknown")
        )
        now = time.monotonic()
        log = request_log[ip]
        while log and now - log[0] > RATE_LIMIT_WINDOW_S:
            log.popleft()
        if len(log) >= RATE_LIMIT_MAX_REQUESTS:
            raise HTTPException(
                status_code=429,
                detail="Too many requests — please wait a minute and try again.",
            )
        log.append(now)

    def decode_image(data: str):
        if data.strip().startswith("data:"):
            data = data.split(",", 1)[1]
        raw = base64.b64decode(data)
        buf = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("could not decode image bytes")
        return img

    @web.get("/")
    def health():
        return {"ok": True, "service": "smart-room-deepface"}

    @web.post("/analyze")
    def analyze(payload: dict, request: Request):
        require_allowed_origin(request)
        enforce_rate_limit(request)

        data = payload.get("image")
        if not data:
            raise HTTPException(
                status_code=400, detail="Missing 'image' field (base64 JPEG/PNG)."
            )

        try:
            img = decode_image(data)
        except Exception as err:
            raise HTTPException(status_code=400, detail=f"Bad image data: {err}")

        results = DeepFace.analyze(
            img,
            actions=ACTIONS,
            detector_backend=DETECTOR,
            enforce_detection=False,
            silent=True,
        )

        height, width = img.shape[:2]
        frame_area = float(width * height)
        faces = []
        for r in results:
            region = r.get("region") or {}
            confidence = float(r.get("face_confidence") or 0)
            # With enforce_detection=False, DeepFace returns one whole-frame
            # entry (confidence 0) when no face is found — skip those.
            if confidence <= 0:
                continue
            # Drop weak detections and specks — these are false positives
            if confidence < MIN_CONFIDENCE:
                continue
            box_area = float(region.get("w", 0)) * float(region.get("h", 0))
            if frame_area and box_area / frame_area < MIN_BOX_FRACTION:
                continue

            faces.append(
                {
                    "box": {
                        "x": int(region.get("x", 0)),
                        "y": int(region.get("y", 0)),
                        "w": int(region.get("w", 0)),
                        "h": int(region.get("h", 0)),
                    },
                    "confidence": round(confidence, 3),
                    "age": int(r.get("age", 0)),
                    "gender": str(r.get("dominant_gender", "")),
                    "race": str(r.get("dominant_race", "")),
                    "emotion": str(r.get("dominant_emotion", "")),
                    "scores": {
                        "gender": {
                            k: round(float(v), 2)
                            for k, v in (r.get("gender") or {}).items()
                        },
                        "race": {
                            k: round(float(v), 2)
                            for k, v in (r.get("race") or {}).items()
                        },
                        "emotion": {
                            k: round(float(v), 2)
                            for k, v in (r.get("emotion") or {}).items()
                        },
                    },
                }
            )

        return {"count": len(faces), "width": width, "height": height, "faces": faces}

    return web
