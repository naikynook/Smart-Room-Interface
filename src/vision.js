/**
 * Vision pipeline:
 * - Reuses an existing webcam stream when possible
 * - COCO-SSD on WASM (no WebGL fight with Three.js)
 * - Reports the single best object in view
 */

import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { startCameraPreview } from "./camera.js";

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
    this.cameraReady = false;
  }

  /**
   * Attach an already-running camera preview (from startCameraPreview).
   */
  attachCamera({ video, stream } = {}) {
    this.video = video || document.getElementById("camera-feed");
    this.stream = stream || this.video?.srcObject || null;
    this.cameraReady = !!(this.video && this.stream);
  }

  async init({ video, stream } = {}) {
    if (video || stream) {
      this.attachCamera({ video, stream });
    }

    if (!this.cameraReady) {
      const cam = await startCameraPreview(
        document.getElementById("camera-feed")
      );
      this.attachCamera(cam);
    }

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.detectCanvas = document.createElement("canvas");
    this.detectCanvas.width = DETECT_W;
    this.detectCanvas.height = DETECT_H;
    this.detectCtx = this.detectCanvas.getContext("2d", {
      willReadFrequently: true,
    });

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

    this.model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    await yieldToPaint();

    this.detectCtx.fillStyle = "#777";
    this.detectCtx.fillRect(0, 0, DETECT_W, DETECT_H);
    await this.model.detect(this.detectCanvas, 8, 0.45);
    await yieldToPaint();

    this.ready = true;
    return true;
  }

  grabFrame() {
    const w = this.video?.videoWidth;
    const h = this.video?.videoHeight;
    if (!w || !h) return false;

    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.drawImage(this.video, 0, 0, w, h);
    this.detectCtx.drawImage(this.video, 0, 0, DETECT_W, DETECT_H);
    return true;
  }

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

    const ranked = predictions
      .filter((p) => p.score >= 0.45)
      .map((p) => {
        const [, , bw, bh] = p.bbox;
        const area = (bw * bh) / frameArea;
        const rank = p.score * 0.75 + Math.min(area, 0.5) * 0.5;
        return { ...p, area, rank };
      })
      .filter((p) => {
        if (p.area < 0.01) return false;
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
    this.cameraReady = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}
