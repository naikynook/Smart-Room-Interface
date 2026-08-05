/**
 * Immersion mode gallery for projection.
 * 1. Creatures — parametric five-form point cloud (white canvas)
 * 2. Slime     — Patt Vira Physarum (white canvas, black trails)
 * 3. Noise     — colorful flowing Perlin field (white canvas)
 *
 * Aspect presets letterbox on black: 1:1, 16:9, 21:9, 9:16, or Fill.
 */
import p5 from "p5";

const MAX_EDGE = 1280;

const ASPECTS = [
  { id: "square", label: "1:1", ratio: 1 },
  { id: "wide", label: "16:9", ratio: 16 / 9 },
  { id: "ultrawide", label: "21:9", ratio: 21 / 9 },
  { id: "portrait", label: "9:16", ratio: 9 / 16 },
  { id: "fill", label: "Fill", ratio: null },
];

const VISUALS = [
  { id: "creatures", title: "Creatures", build: buildCreatures },
  { id: "slime", title: "Slime", build: buildSlime },
  { id: "noise", title: "Noise", build: buildNoise },
];

let overlay = null;
let sketchInstance = null;
let visible = false;
let visualIndex = 0;
let aspectIndex = 1; // default 16:9 for walls
let aspectBtn = null;
let chromeIdleTimer = null;
const CHROME_IDLE_MS = 2800;

function bumpChrome() {
  if (!overlay || !visible) return;
  overlay.classList.remove("chrome-idle");
  window.clearTimeout(chromeIdleTimer);
  chromeIdleTimer = window.setTimeout(() => {
    if (visible) overlay?.classList.add("chrome-idle");
  }, CHROME_IDLE_MS);
}

function stopChromeIdle() {
  window.clearTimeout(chromeIdleTimer);
  chromeIdleTimer = null;
  overlay?.classList.remove("chrome-idle");
}

function currentAspect() {
  return ASPECTS[aspectIndex];
}

function currentVisual() {
  return VISUALS[visualIndex];
}

/** Fit canvas into the host using the active aspect preset. */
function sizeForHost(host) {
  const availW = host.clientWidth || window.innerWidth;
  const availH = host.clientHeight || window.innerHeight;
  const aspect = currentAspect();

  if (!aspect.ratio) {
    return {
      w: Math.max(320, Math.min(availW, MAX_EDGE * 2)),
      h: Math.max(320, Math.min(availH, MAX_EDGE * 2)),
    };
  }

  let w;
  let h;
  if (availW / availH > aspect.ratio) {
    h = Math.min(availH, MAX_EDGE);
    w = h * aspect.ratio;
  } else {
    w = Math.min(availW, MAX_EDGE);
    h = w / aspect.ratio;
  }
  return {
    w: Math.max(320, Math.floor(w)),
    h: Math.max(320, Math.floor(h)),
  };
}

// ---------------------------------------------------------------------------
// Visual 1 — Creatures (white bg)
// ---------------------------------------------------------------------------
function buildCreatures(host) {
  const FORMS = 5;
  const FIT = 0.82;
  const SAMPLE_STEP = 3;
  const TOTAL = 10000;
  const SPEED = (Math.PI * 4) / 3;

  return (p) => {
    let t = 0;
    let palette;
    let lobeG;
    let W = 400;
    let H = 400;

    p.setup = () => {
      ({ w: W, h: H } = sizeForHost(host));
      const canvas = p.createCanvas(W, H);
      canvas.parent(host);
      p.pixelDensity(1);
      p.frameRate(30);
      p.noSmooth();

      lobeG = p.createGraphics(400, 400);
      lobeG.pixelDensity(1);
      lobeG.noSmooth();
      lobeG.strokeWeight(1.5);

      palette = [
        p.color(60, 200, 140, 120),
        p.color(200, 100, 200, 120),
        p.color(40, 50, 160, 120),
        p.color(30, 170, 210, 120),
      ];
    };

    p.windowResized = () => {
      if (!visible) return;
      ({ w: W, h: H } = sizeForHost(host));
      p.resizeCanvas(W, H);
    };

    p.draw = () => {
      if (!visible) {
        p.noLoop();
        return;
      }
      const dt = Math.min(p.deltaTime || 33, 50) / 1000;
      t += SPEED * dt;

      lobeG.clear();
      for (let rangeIndex = 0; rangeIndex < 4; rangeIndex++) {
        lobeG.stroke(palette[rangeIndex]);
        const iStart = Math.floor((rangeIndex / 4) * TOTAL) + 1;
        const iEnd = Math.floor(((rangeIndex + 1) / 4) * TOTAL);
        for (let i = iEnd; i >= iStart; i -= SAMPLE_STEP) {
          const k = 9 * Math.cos(i / 81);
          const e = i / 461 - 11;
          const r2 = k * k + e * e;
          const d = (r2 * r2) / 40000 + 1.5 + Math.sin(t * 0.5) / 4;
          const qCore =
            89 - e * Math.sin(k) + k * (4 + 2 * Math.sin(d * 9 + e / 9 - t));
          const c = d + Math.sin(t - d * 4) / 9 - t / 9;
          lobeG.point(
            qCore * Math.cos(c) * FIT + 200,
            (qCore + 30) * Math.sin(c) * FIT + 200
          );
        }
      }

      p.background(255);
      const side = Math.min(W, H);
      p.imageMode(p.CENTER);
      p.push();
      p.translate(W * 0.5, H * 0.5);
      for (let n = 0; n < FORMS; n++) {
        p.push();
        p.rotate((n * p.TWO_PI) / FORMS);
        p.image(lobeG, 0, 0, side, side);
        p.pop();
      }
      p.pop();
    };
  };
}

// ---------------------------------------------------------------------------
// Visual 2 — Slime molds (Physarum)
// Exact Patt Vira code; white background + black molds.
// https://p5js.org/sketches/2213463/
// ---------------------------------------------------------------------------
function buildSlime(host) {
  const num = 4000;
  const rotAngle = 30; // smaller turns = smoother paths
  const sensorAngle = 45;
  const sensorDist = 14;
  const moldSpeed = 2.8;

  return (p) => {
    let molds = [];
    let d;
    let W = 400;
    let H = 400;

    class Mold {
      constructor() {
        this.x = p.random(W / 2 - 20, W / 2 + 20);
        this.y = p.random(H / 2 - 20, H / 2 + 20);
        this.r = 0.5;

        this.heading = p.random(360);
        this.vx = p.cos(this.heading);
        this.vy = p.sin(this.heading);

        this.rSensorPos = p.createVector(0, 0);
        this.lSensorPos = p.createVector(0, 0);
        this.fSensorPos = p.createVector(0, 0);
      }

      update() {
        this.vx = p.cos(this.heading) * moldSpeed;
        this.vy = p.sin(this.heading) * moldSpeed;

        this.x = (this.x + this.vx + W) % W;
        this.y = (this.y + this.vy + H) % H;

        this.getSensorPos(this.rSensorPos, this.heading + sensorAngle);
        this.getSensorPos(this.lSensorPos, this.heading - sensorAngle);
        this.getSensorPos(this.fSensorPos, this.heading);

        let index;
        let l;
        let r;
        let f;

        // Black trails on white: invert so sensors still seek deposited trails
        index =
          4 * (d * p.floor(this.rSensorPos.y)) * (d * W) +
          4 * (d * p.floor(this.rSensorPos.x));
        r = 255 - p.pixels[index];

        index =
          4 * (d * p.floor(this.lSensorPos.y)) * (d * W) +
          4 * (d * p.floor(this.lSensorPos.x));
        l = 255 - p.pixels[index];

        index =
          4 * (d * p.floor(this.fSensorPos.y)) * (d * W) +
          4 * (d * p.floor(this.fSensorPos.x));
        f = 255 - p.pixels[index];

        if (f > l && f > r) {
          this.heading += 0;
        } else if (f < l && f < r) {
          if (p.random(1) < 0.5) {
            this.heading += rotAngle;
          } else {
            this.heading -= rotAngle;
          }
        } else if (l > r) {
          this.heading += -rotAngle;
        } else if (r > l) {
          this.heading += rotAngle;
        }
      }

      display() {
        p.noStroke();
        p.fill(0);
        p.ellipse(this.x, this.y, this.r * 2, this.r * 2);
      }

      getSensorPos(sensor, angle) {
        sensor.x = (this.x + sensorDist * p.cos(angle) + W) % W;
        sensor.y = (this.y + sensorDist * p.sin(angle) + H) % H;
      }
    }

    p.setup = () => {
      ({ w: W, h: H } = sizeForHost(host));
      const canvas = p.createCanvas(W, H);
      canvas.parent(host);
      p.angleMode(p.DEGREES);
      p.pixelDensity(1);
      p.frameRate(60);
      d = p.pixelDensity();
      p.background(255);
      molds = [];
      for (let i = 0; i < num; i++) {
        molds[i] = new Mold();
      }
    };

    p.windowResized = () => {
      if (!visible) return;
      ({ w: W, h: H } = sizeForHost(host));
      p.resizeCanvas(W, H);
      d = p.pixelDensity();
      p.background(255);
      molds = [];
      for (let i = 0; i < num; i++) {
        molds[i] = new Mold();
      }
    };

    p.draw = () => {
      if (!visible) {
        p.noLoop();
        return;
      }
      p.background(255, 4);
      p.loadPixels();

      for (let i = 0; i < num; i++) {
        molds[i].update();
        molds[i].display();
      }
    };
  };
}


// ---------------------------------------------------------------------------
// Visual 3 — Colorful animated Perlin noise on white
// ---------------------------------------------------------------------------
function buildNoise(host) {
  const STEP = 22;

  return (p) => {
    let zoff = 0;
    let W = 400;
    let H = 400;

    p.setup = () => {
      ({ w: W, h: H } = sizeForHost(host));
      const canvas = p.createCanvas(W, H);
      canvas.parent(host);
      p.pixelDensity(1);
      p.frameRate(60);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.noStroke();
    };

    p.windowResized = () => {
      if (!visible) return;
      ({ w: W, h: H } = sizeForHost(host));
      p.resizeCanvas(W, H);
    };

    p.draw = () => {
      if (!visible) {
        p.noLoop();
        return;
      }

      // Advance the noise field every frame so color/shape clearly shift
      zoff += 0.028;
      p.background(0, 0, 100);

      const cols = Math.ceil(W / STEP);
      const rows = Math.ceil(H / STEP);
      const hueSpin = p.frameCount * 1.8;

      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * STEP;
          const y = j * STEP;
          const n = p.noise(i * 0.08, j * 0.08, zoff);
          const n2 = p.noise(i * 0.05 + 20, j * 0.05 + 20, zoff * 0.6);

          const hue = (n * 360 + hueSpin) % 360;
          const sat = 45 + n2 * 50;
          const bri = 65 + n * 35;

          p.fill(hue, sat, bri, 75);
          p.rect(x, y, STEP + 1, STEP + 1);
        }
      }
    };
  };
}

// ---------------------------------------------------------------------------
// Overlay / gallery controls
// ---------------------------------------------------------------------------
function updateChromeLabels() {
  if (aspectBtn) {
    aspectBtn.textContent = `Aspect ${currentAspect().label}`;
  }
}

function mountSketch() {
  const el = ensureOverlay();
  const stage = el.querySelector(".visuals-stage");
  if (sketchInstance) {
    sketchInstance.remove();
    sketchInstance = null;
    stage.innerHTML = "";
  }
  sketchInstance = new p5(currentVisual().build(stage), stage);
  sketchInstance.loop();
  updateChromeLabels();
}

function ensureOverlay() {
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "visuals-overlay";
  overlay.innerHTML = `
    <div class="visuals-stage" aria-label="Immersion mode"></div>
    <div class="visuals-chrome">
      <button type="button" class="visuals-prev" title="Previous">‹ Prev</button>
      <button type="button" class="visuals-next" title="Next">Next ›</button>
      <button type="button" class="visuals-aspect" title="Cycle aspect ratio">Aspect 16:9</button>
      <button type="button" class="visuals-fullscreen" title="Fullscreen">Fullscreen</button>
      <button type="button" class="visuals-close" title="Close">Close</button>
    </div>
    <p class="visuals-hint">Say "immersion mode" · "next visual" · "exit immersion mode"</p>
  `;
  document.body.appendChild(overlay);
  aspectBtn = overlay.querySelector(".visuals-aspect");

  overlay.addEventListener("mousemove", bumpChrome);
  overlay.addEventListener("mousedown", bumpChrome);
  overlay.addEventListener("touchstart", bumpChrome, { passive: true });

  overlay.querySelector(".visuals-close").addEventListener("click", (e) => {
    e.stopPropagation();
    hideVisuals();
  });
  overlay.querySelector(".visuals-prev").addEventListener("click", (e) => {
    e.stopPropagation();
    bumpChrome();
    cycleVisual(-1);
  });
  overlay.querySelector(".visuals-next").addEventListener("click", (e) => {
    e.stopPropagation();
    bumpChrome();
    cycleVisual(1);
  });
  aspectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    bumpChrome();
    cycleAspect(1);
  });
  overlay
    .querySelector(".visuals-fullscreen")
    .addEventListener("click", async (e) => {
      e.stopPropagation();
      bumpChrome();
      await toggleVisualsFullscreen();
    });

  document.addEventListener("fullscreenchange", () => {
    overlay?.classList.toggle(
      "is-fullscreen",
      document.fullscreenElement === overlay
    );
    if (visible && sketchInstance?.windowResized) {
      sketchInstance.windowResized();
    }
    bumpChrome();
  });

  document.addEventListener("keydown", (e) => {
    if (!visible) return;
    bumpChrome();
    if (e.key === "ArrowRight") cycleVisual(1);
    if (e.key === "ArrowLeft") cycleVisual(-1);
    if (e.key === "a" || e.key === "A") cycleAspect(1);
    if (e.key === "f" || e.key === "F") toggleVisualsFullscreen();
  });

  return overlay;
}

async function enterVisualsFullscreen() {
  const el = ensureOverlay();
  if (document.fullscreenElement === el) return;
  try {
    await el.requestFullscreen?.();
  } catch (err) {
    console.warn("Fullscreen blocked:", err);
  }
}

async function exitVisualsFullscreen() {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    }
  }
}

async function toggleVisualsFullscreen() {
  if (document.fullscreenElement === overlay) {
    await exitVisualsFullscreen();
  } else {
    await enterVisualsFullscreen();
  }
}

export function cycleAspect(dir = 1) {
  aspectIndex = (aspectIndex + dir + ASPECTS.length) % ASPECTS.length;
  updateChromeLabels();
  if (visible && sketchInstance?.windowResized) {
    sketchInstance.windowResized();
  }
  return currentAspect();
}

export function cycleVisual(dir = 1) {
  visualIndex = (visualIndex + dir + VISUALS.length) % VISUALS.length;
  if (visible) mountSketch();
  else updateChromeLabels();
  return currentVisual();
}

export function isVisualsVisible() {
  return visible;
}

/** @deprecated alias */
export const isCreaturesVisible = isVisualsVisible;

export function showVisuals(startId) {
  if (startId) {
    const idx = VISUALS.findIndex((v) => v.id === startId);
    if (idx >= 0) visualIndex = idx;
  }
  ensureOverlay();
  mountSketch();
  visible = true;
  overlay.classList.add("visible");
  bumpChrome();
  window.dispatchEvent(new Event("resize"));
  enterVisualsFullscreen();
  return currentVisual();
}

/** @deprecated alias */
export function showCreatures() {
  return showVisuals("creatures");
}

export async function hideVisuals() {
  visible = false;
  stopChromeIdle();
  if (sketchInstance) {
    try {
      sketchInstance.noLoop();
    } catch {
      // ignore
    }
  }
  await exitVisualsFullscreen();
  if (overlay) overlay.classList.remove("visible");
  return true;
}

/** @deprecated alias */
export const hideCreatures = hideVisuals;

export function toggleVisuals() {
  if (visible) return hideVisuals();
  return showVisuals();
}

export function getVisualTitle() {
  return currentVisual().title;
}
