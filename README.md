# Smart Room Interface

Particle avatar prototype for a camera-aware chatbot.

See [PROJECT.md](./PROJECT.md) for the full project description and phased plan.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL Vite prints (usually `http://localhost:5173`) and allow **microphone** and **camera** when prompted. Best in Chrome / Edge on `localhost`.

## Deploy to GitHub Pages

GitHub Pages can only serve the **built** site — pushing the raw Vite source (`src/`, `node_modules` imports) will show a blank page stuck on “Loading…”.

### One-time setup

1. Push this project to a GitHub repo.
2. Repo **Settings → Pages → Build and deployment → Source**: choose **GitHub Actions**.
3. Push to `main` (or `master`). The workflow in `.github/workflows/deploy-pages.yml` builds and publishes `dist/`.

### Manual build check

```bash
npm install
npm run build
npm run preview
```

`preview` serves the same files Pages will host.

Camera / mic only work on **https://** (GitHub Pages) or **localhost**.

## Voice commands

| Phrase | Action |
|---|---|
| **hello smart room** | Particles morph into the face |
| **goodbye smart room** | Face dissolves back into the swirl · says goodbye |
| **what do you see** | Names one detected object, logs it |
| **download dataset** | Downloads `smart-room-dataset.csv` |

Click still toggles wake/sleep as a fallback.

## Vision stack

- **Webcam** — small mirrored preview (bottom-right)
- **COCO-SSD (TF.js, WASM backend)** — object labels
- **Speech Synthesis** — avatar speaks replies
- **CSV log** — detections with timestamp / object / confidence
