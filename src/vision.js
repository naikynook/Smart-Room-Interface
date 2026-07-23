/**
 * Vision pipeline:
 * - Webcam via getUserMedia
 * - COCO-SSD on WASM (no WebGL fight with Three.js)
 * - Reports the single best object in view
 */

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

const DETECT_W = 320;
const DETECT_H = 240;

setWasmPaths(
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.22.0/dist/"
);

function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function articleFor(name) {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

export class VisionSystem {
  constructor() {
    this.video = null;
    this.stream = null;
    this.model = null;
    this.canvas = null;
    this.ctx = null;
    this.detectCanvas = null;
    this.detectCtx = null;
    this.ready = false;
  }

  async init() {
    this.video = document.getElementById("camera-feed");
    if (!this.video) {
      this.video = document.createElement("video");
      this.video.id = "camera-feed";
      this.video.playsInline = true;
      this.video.muted = true;
      this.video.autoplay = true;
      document.body.appendChild(this.video);
    }

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.detectCanvas = document.createElement("canvas");
    this.detectCanvas.width = DETECT_W;
    this.detectCanvas.height = DETECT_H;
    this.detectCtx = this.detectCanvas.getContext("2d", {
      willReadFrequently: true,
    });

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 24 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    await yieldToPaint();

    try {
      await tf.setBackend("wasm");
      await tf.ready();
    } catch (err) {
      console.warn("WASM backend unavailable, falling back to CPU", err);
      await tf.setBackend("cpu");
      await tf.ready();
    }
    await yieldToPaint();

    this.model = await cocoSsd.load({ base: "mobilenet_v2" });
    await yieldToPaint();

    this.detectCtx.fillStyle = "#777";
    this.detectCtx.fillRect(0, 0, DETECT_W, DETECT_H);
    await this.model.detect(this.detectCanvas, 8, 0.45);
    await yieldToPaint();

    this.ready = true;
    return true;
  }

  grabFrame() {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return false;

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(this.video, 0, 0, w, h);
    this.detectCtx.drawImage(this.video, 0, 0, DETECT_W, DETECT_H);
    return true;
  }

  /**
   * Pick one best object and describe it.
   */
  async analyze() {
    if (!this.ready || !this.video?.videoWidth) {
      throw new Error("Vision system is not ready yet.");
    }

    await yieldToPaint();
    if (!this.grabFrame()) {
      throw new Error("Camera frame not available.");
    }
    await yieldToPaint();

    const predictions = await this.model.detect(this.detectCanvas, 12, 0.4);
    await yieldToPaint();

    const timestamp = Date.now();
    const frameArea = DETECT_W * DETECT_H;

    // Prefer confident, reasonably sized detections
    const ranked = predictions
      .filter((p) => p.score >= 0.45)
      .map((p) => {
        const [, , bw, bh] = p.bbox;
        const area = (bw * bh) / frameArea;
        // Score blends confidence with how much of the frame it fills
        const rank = p.score * 0.75 + Math.min(area, 0.5) * 0.5;
        return { ...p, area, rank };
      })
      .filter((p) => {
        // Tiny junk boxes
        if (p.area < 0.01) return false;
        // Person needs a bit more confidence to avoid empty-room FPs
        if (p.class === "person" && (p.score < 0.58 || p.area < 0.04)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.rank - a.rank);

    const best = ranked[0] || null;
    const detections = best
      ? [
          {
            timestamp,
            object: best.class,
            confidence: Number(best.score.toFixed(3)),
            color: "",
          },
        ]
      : [];

    const summary = best
      ? `I can see ${articleFor(best.class)} ${best.class}.`
      : "I don't clearly see a familiar object right now.";

    return {
      detections,
      summary,
      hairColor: null,
      shirtColor: null,
      objects: detections,
    };
  }

  stop() {
    this.ready = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}
