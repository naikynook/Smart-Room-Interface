# Smart Room Interface

Particle avatar prototype for a camera-aware chatbot.

See [PROJECT.md](./PROJECT.md) for the full project description and phased plan.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`) and allow **microphone** and **camera** when prompted. Best in Chrome / Edge on `localhost`.

## Voice commands

| Phrase | Action |
|---|---|
| **hello smart room** | Particles morph into the face |
| **goodbye smart room** | Face dissolves back into the swirl |
| **what do you see** | Runs camera vision, speaks a summary, logs detections |
| **download dataset** | Downloads `smart-room-dataset.csv` |

Click still toggles wake/sleep as a fallback.

## Vision stack

- **Webcam** — small mirrored preview (bottom-right)
- **COCO-SSD (TF.js, WASM backend)** — object labels. WASM is faster than plain CPU and still leaves WebGL for Three.js.
- **HSV color sampling** — averages non-skin pixels in hair/shirt regions, then names the mean color
- **Speech Synthesis** — avatar speaks the scene summary
- **CSV log** — each detection includes timestamp, object, confidence, color
