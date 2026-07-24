import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { startVoiceWake } from "./voiceWake.js";
import { speak as speakFn, stopSpeaking as stopSpeakingFn, speakTunnelGoodbye } from "./speechTalk.js";
import { startCameraPreview, describeCameraError, wireCameraRetry } from "./camera.js";

const PARTICLE_COUNT = 48000;
const FACE_MODEL_URL = `${import.meta.env.BASE_URL}models/LeePerrySmith.glb`;

const container = document.getElementById("canvas-container");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0.05, 3.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// If another lib tries to take WebGL, keep the particle loop alive if possible
renderer.domElement.addEventListener(
  "webglcontextlost",
  (event) => {
    event.preventDefault();
    console.warn("WebGL context lost — particle animation may stall until refresh.");
    if (hint) {
      hint.textContent =
        "Graphics hiccup — refresh the page if the swirl freezes.";
    }
  },
  false
);

const hint = document.querySelector(".hint");
if (hint) hint.textContent = "Loading face scan…";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function sampleSwirlPositions(count) {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 0.55 + Math.random() * 0.95;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.9;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }

  return positions;
}

function spectralColor(x, y, z, out, i, normal, concavity = 0) {
  // Spectral hue with stronger relief shading so features read head-on
  const hue =
    ((y * 0.38 + z * 0.22 + Math.atan2(x, z + 1.15) * 0.1) % 1 + 1) % 1;
  const facing = normal ? Math.pow(Math.max(0, normal.z), 1.35) : 0.55;
  const depthLift = THREE.MathUtils.clamp(z * 0.18, -0.08, 0.14);
  // Concave sockets / philtrum darken; ridges stay brighter
  const cave = THREE.MathUtils.clamp(concavity * 0.55, -0.12, 0.2);
  const light = THREE.MathUtils.clamp(
    0.18 + facing * 0.52 + depthLift - cave,
    0.12,
    0.68
  );
  const sat = 0.72 + facing * 0.18;
  const color = new THREE.Color().setHSL(hue, sat, light);
  out[i * 3] = color.r;
  out[i * 3 + 1] = color.g;
  out[i * 3 + 2] = color.b;
}

function collectTriangles(root) {
  const triangles = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();

  root.updateMatrixWorld(true);

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;

    const geometry = obj.geometry.index
      ? obj.geometry.toNonIndexed()
      : obj.geometry;
    const pos = geometry.attributes.position;
    if (!pos) return;

    const matrix = obj.matrixWorld;

    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      b.fromBufferAttribute(pos, i + 1).applyMatrix4(matrix);
      c.fromBufferAttribute(pos, i + 2).applyMatrix4(matrix);

      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);
      const area = normal.length() * 0.5;
      if (area < 1e-10) continue;
      normal.normalize();

      triangles.push({
        a: a.clone(),
        b: b.clone(),
        c: c.clone(),
        area,
        normal: normal.clone(),
        centroid: new THREE.Vector3(
          (a.x + b.x + c.x) / 3,
          (a.y + b.y + c.y) / 3,
          (a.z + b.z + c.z) / 3
        ),
      });
    }
  });

  return triangles;
}

/**
 * Theatrical face-mask crop (reference: front plate only).
 * Forehead → chin, temple-to-temple. No ears, neck, skull, or rear head.
 */
function cropToFaceMask(triangles) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const t of triangles) {
    minX = Math.min(minX, t.centroid.x);
    maxX = Math.max(maxX, t.centroid.x);
    minY = Math.min(minY, t.centroid.y);
    maxY = Math.max(maxY, t.centroid.y);
    minZ = Math.min(minZ, t.centroid.z);
    maxZ = Math.max(maxZ, t.centroid.z);
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const spanZ = maxZ - minZ || 1;

  const rough = triangles.filter((t) => {
    const nx = (t.centroid.x - minX) / spanX;
    const ny = (t.centroid.y - minY) / spanY;
    const nz = (t.centroid.z - minZ) / spanZ;

    if (ny < 0.4 || ny > 0.93) return false;
    if (nx < 0.2 || nx > 0.8) return false;
    if (nz < 0.55) return false;
    if (t.normal.z < 0.18) return false;
    return true;
  });

  if (!rough.length) return rough;

  let rMinX = Infinity;
  let rMaxX = -Infinity;
  let rMinY = Infinity;
  let rMaxY = -Infinity;
  let rMinZ = Infinity;
  let rMaxZ = -Infinity;

  for (const t of rough) {
    rMinX = Math.min(rMinX, t.centroid.x);
    rMaxX = Math.max(rMaxX, t.centroid.x);
    rMinY = Math.min(rMinY, t.centroid.y);
    rMaxY = Math.max(rMaxY, t.centroid.y);
    rMinZ = Math.min(rMinZ, t.centroid.z);
    rMaxZ = Math.max(rMaxZ, t.centroid.z);
  }

  const rSpanX = rMaxX - rMinX || 1;
  const rSpanY = rMaxY - rMinY || 1;
  const rSpanZ = rMaxZ - rMinZ || 1;
  const cx = (rMinX + rMaxX) * 0.5;
  const cy = (rMinY + rMaxY) * 0.5 + rSpanY * 0.01;
  const rx = rSpanX * 0.44;
  const ry = rSpanY * 0.5;

  return rough.filter((t) => {
    const ox = (t.centroid.x - cx) / rx;
    const oy = (t.centroid.y - cy) / ry;
    const edge = ox * ox + oy * oy;
    if (edge > 0.96) return false;
    if (edge > 0.7 && t.normal.z < 0.4) return false;
    if (edge > 0.85 && t.normal.z < 0.55) return false;

    const nx = (t.centroid.x - rMinX) / rSpanX;
    const ny = (t.centroid.y - rMinY) / rSpanY;
    const inNose = Math.abs(nx - 0.5) < 0.14 && ny > 0.4 && ny < 0.72;
    const zFloor = inNose ? rMinZ + rSpanZ * 0.12 : rMinZ + rSpanZ * 0.32;
    if (t.centroid.z < zFloor) return false;
    if (!inNose && t.normal.z < 0.22) return false;
    return true;
  });
}

/**
 * Outer-front shell. Mouth + eye sockets sealed; nose sides keep slack.
 */
function keepFrontShell(triangles, resolution = 110) {
  if (!triangles.length) return triangles;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const t of triangles) {
    minX = Math.min(minX, t.centroid.x);
    maxX = Math.max(maxX, t.centroid.x);
    minY = Math.min(minY, t.centroid.y);
    maxY = Math.max(maxY, t.centroid.y);
    minZ = Math.min(minZ, t.centroid.z);
    maxZ = Math.max(maxZ, t.centroid.z);
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const spanZ = maxZ - minZ || 1;
  const frontZ = new Float32Array(resolution * resolution).fill(-Infinity);
  const backZ = new Float32Array(resolution * resolution).fill(Infinity);

  function cellIndex(x, y) {
    const ix = Math.min(
      resolution - 1,
      Math.max(0, Math.floor(((x - minX) / spanX) * resolution))
    );
    const iy = Math.min(
      resolution - 1,
      Math.max(0, Math.floor(((y - minY) / spanY) * resolution))
    );
    return iy * resolution + ix;
  }

  for (const t of triangles) {
    const i = cellIndex(t.centroid.x, t.centroid.y);
    frontZ[i] = Math.max(frontZ[i], t.centroid.z);
    backZ[i] = Math.min(backZ[i], t.centroid.z);
  }

  function inEyeSocket(nx, ny) {
    const left =
      Math.pow((nx - 0.34) / 0.12, 2) + Math.pow((ny - 0.63) / 0.09, 2) < 1;
    const right =
      Math.pow((nx - 0.66) / 0.12, 2) + Math.pow((ny - 0.63) / 0.09, 2) < 1;
    return left || right;
  }

  return triangles.filter((t) => {
    const i = cellIndex(t.centroid.x, t.centroid.y);
    const envelope = frontZ[i];
    if (!Number.isFinite(envelope)) return false;

    const nx = (t.centroid.x - minX) / spanX;
    const ny = (t.centroid.y - minY) / spanY;
    const cx = nx - 0.5;

    const inMouth = Math.abs(cx) < 0.2 && ny > 0.2 && ny < 0.48;
    const inNose = Math.abs(cx) < 0.16 && ny > 0.4 && ny < 0.72;
    const inEye = inEyeSocket(nx, ny);
    const depth = envelope - (Number.isFinite(backZ[i]) ? backZ[i] : envelope);
    const deepPocket = depth > spanZ * 0.1;

    // Keep lids/brows; only strip deep socket / mouth cavity walls
    let slack = spanZ * 0.045;
    if (inNose) slack = spanZ * 0.1;
    if (inMouth || deepPocket) slack = spanZ * 0.012;
    if (inEye) slack = spanZ * 0.018;

    if (t.centroid.z < envelope - slack) return false;
    if (inMouth && t.centroid.z < envelope - spanZ * 0.006) return false;
    return true;
  });
}

/**
 * Contour-style face point cloud (reference: organized surface grid + soft rim dissolve).
 * Eyes stay as recessed sockets (not punched white holes). Spectral colors shaded by normals.
 */
function sampleFaceSurface(triangles, count, targetSize = 2.15) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const t of triangles) {
    minX = Math.min(minX, t.a.x, t.b.x, t.c.x);
    maxX = Math.max(maxX, t.a.x, t.b.x, t.c.x);
    minY = Math.min(minY, t.a.y, t.b.y, t.c.y);
    maxY = Math.max(maxY, t.a.y, t.b.y, t.c.y);
    minZ = Math.min(minZ, t.a.z, t.b.z, t.c.z);
    maxZ = Math.max(maxZ, t.a.z, t.b.z, t.c.z);
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const spanZ = maxZ - minZ || 1;

  const RES = 320;
  const zBuf = new Float32Array(RES * RES).fill(-Infinity);
  const nxBuf = new Float32Array(RES * RES);
  const nyBuf = new Float32Array(RES * RES);
  const nzBuf = new Float32Array(RES * RES);

  function pointInTri(px, py, ax, ay, bx, by, cx0, cy0) {
    const v0x = cx0 - ax;
    const v0y = cy0 - ay;
    const v1x = bx - ax;
    const v1y = by - ay;
    const v2x = px - ax;
    const v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const inv = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-12);
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5;
  }

  for (const t of triangles) {
    const minTx = Math.min(t.a.x, t.b.x, t.c.x);
    const maxTx = Math.max(t.a.x, t.b.x, t.c.x);
    const minTy = Math.min(t.a.y, t.b.y, t.c.y);
    const maxTy = Math.max(t.a.y, t.b.y, t.c.y);
    const i0 = Math.max(0, Math.floor(((minTx - minX) / spanX) * (RES - 1)));
    const i1 = Math.min(RES - 1, Math.ceil(((maxTx - minX) / spanX) * (RES - 1)));
    const j0 = Math.max(0, Math.floor(((minTy - minY) / spanY) * (RES - 1)));
    const j1 = Math.min(RES - 1, Math.ceil(((maxTy - minY) / spanY) * (RES - 1)));

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = minX + (i / (RES - 1)) * spanX;
        const y = minY + (j / (RES - 1)) * spanY;
        if (!pointInTri(x, y, t.a.x, t.a.y, t.b.x, t.b.y, t.c.x, t.c.y)) continue;
        const denom =
          (t.b.y - t.c.y) * (t.a.x - t.c.x) + (t.c.x - t.b.x) * (t.a.y - t.c.y) ||
          1e-12;
        const w1 =
          ((t.b.y - t.c.y) * (x - t.c.x) + (t.c.x - t.b.x) * (y - t.c.y)) / denom;
        const w2 =
          ((t.c.y - t.a.y) * (x - t.c.x) + (t.a.x - t.c.x) * (y - t.c.y)) / denom;
        const w3 = 1 - w1 - w2;
        const z = w1 * t.a.z + w2 * t.b.z + w3 * t.c.z;
        const idx = j * RES + i;
        if (z >= zBuf[idx]) {
          zBuf[idx] = z;
          nxBuf[idx] = t.normal.x;
          nyBuf[idx] = t.normal.y;
          nzBuf[idx] = t.normal.z;
        }
      }
    }
  }

  function ellipseR(nx, ny) {
    // Tighter oval — removes square corner silhouette from the bbox
    const ox = (nx - 0.5) / 0.44;
    const oy = (ny - 0.5) / 0.5;
    return Math.sqrt(ox * ox + oy * oy);
  }

  function slopeAt(ix, iy) {
    const i0 = Math.max(0, ix - 1);
    const i1 = Math.min(RES - 1, ix + 1);
    const j0 = Math.max(0, iy - 1);
    const j1 = Math.min(RES - 1, iy + 1);
    const zc = zBuf[iy * RES + ix];
    if (!Number.isFinite(zc) || zc === -Infinity) return 0;
    const zl = zBuf[iy * RES + i0];
    const zr = zBuf[iy * RES + i1];
    const zd = zBuf[j0 * RES + ix];
    const zu = zBuf[j1 * RES + ix];
    let dx = 0;
    let dy = 0;
    if (Number.isFinite(zl) && zl !== -Infinity && Number.isFinite(zr) && zr !== -Infinity) {
      dx = Math.abs(zr - zl);
    }
    if (Number.isFinite(zd) && zd !== -Infinity && Number.isFinite(zu) && zu !== -Infinity) {
      dy = Math.abs(zu - zd);
    }
    return (dx + dy) / spanZ;
  }

  function concavityAt(ix, iy) {
    const zc = zBuf[iy * RES + ix];
    if (!Number.isFinite(zc) || zc === -Infinity) return 0;
    let sum = 0;
    let n = 0;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        if (!ox && !oy) continue;
        const jx = ix + ox;
        const jy = iy + oy;
        if (jx < 0 || jy < 0 || jx >= RES || jy >= RES) continue;
        const z = zBuf[jy * RES + jx];
        if (!Number.isFinite(z) || z === -Infinity) continue;
        sum += z;
        n++;
      }
    }
    if (!n) return 0;
    return (sum / n - zc) / spanZ;
  }

  const samples = [];
  const cols = 190;
  const rows = 220;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const onRow = j % 2 === 0;
      const onCol = i % 2 === 0;
      if (!onRow && !onCol) continue;

      const nx = i / (cols - 1);
      const ny = j / (rows - 1);
      const er = ellipseR(nx, ny);
      if (er > 0.98) continue;

      const ix = Math.min(RES - 1, Math.max(0, Math.round(nx * (RES - 1))));
      const iy = Math.min(RES - 1, Math.max(0, Math.round(ny * (RES - 1))));
      const idx = iy * RES + ix;
      if (!Number.isFinite(zBuf[idx]) || zBuf[idx] === -Infinity) continue;

      const slope = slopeAt(ix, iy);
      const cave = concavityAt(ix, iy);

      if (er > 0.72) {
        const peel = (er - 0.72) / 0.26;
        const ox = Math.abs(nx - 0.5) / 0.44;
        const oy = Math.abs(ny - 0.5) / 0.5;
        const cornerBias = Math.pow(Math.max(ox, oy), 1.6);
        if (Math.random() < peel * (0.45 + cornerBias * 0.7)) continue;
      }

      let x = minX + nx * spanX;
      let y = minY + ny * spanY;
      let z = zBuf[idx];
      const nnx = nxBuf[idx];
      const nny = nyBuf[idx];
      const nnz = nzBuf[idx];

      if (er > 0.78) {
        const peel = (er - 0.78) / 0.2;
        const ang = Math.atan2(ny - 0.5, nx - 0.5);
        const spray = peel * peel * (0.1 + Math.random() * 0.45);
        x += Math.cos(ang) * spray * spanX * 0.18;
        y += Math.sin(ang) * spray * spanY * 0.18;
        z += (Math.random() - 0.5) * spray * spanZ * 0.15;
      }

      samples.push(x, y, z, nnx, nny, nnz, cave);

      if (slope > 0.035 && Math.random() < Math.min(0.85, slope * 8)) {
        samples.push(
          x + (Math.random() - 0.5) * spanX * 0.004,
          y + (Math.random() - 0.5) * spanY * 0.004,
          z,
          nnx,
          nny,
          nnz,
          cave
        );
      }
    }
  }

  for (let n = 0; n < Math.floor(count * 0.1); n++) {
    const ang = Math.random() * Math.PI * 2;
    const er = 0.8 + Math.random() * 0.22;
    const nx = 0.5 + Math.cos(ang) * er * 0.44;
    const ny = 0.5 + Math.sin(ang) * er * 0.5;
    if (nx < 0.02 || nx > 0.98 || ny < 0.02 || ny > 0.98) continue;
    const ix = Math.round(nx * (RES - 1));
    const iy = Math.round(ny * (RES - 1));
    let src = -1;
    for (let s = 0; s < 50; s++) {
      const jx = Math.min(
        RES - 1,
        Math.max(0, Math.round(ix + ((RES - 1) * 0.5 - ix) * (s / 50)))
      );
      const jy = Math.min(
        RES - 1,
        Math.max(0, Math.round(iy + ((RES - 1) * 0.5 - iy) * (s / 50)))
      );
      const tidx = jy * RES + jx;
      if (Number.isFinite(zBuf[tidx]) && zBuf[tidx] !== -Infinity) {
        src = tidx;
        break;
      }
    }
    if (src < 0) continue;
    const peel = (er - 0.78) * (0.25 + Math.random());
    const cave = concavityAt(src % RES, Math.floor(src / RES));
    samples.push(
      minX + nx * spanX + Math.cos(ang) * peel * spanX * 0.2,
      minY + ny * spanY + Math.sin(ang) * peel * spanY * 0.2,
      zBuf[src] + (Math.random() - 0.5) * peel * spanZ * 0.2,
      nxBuf[src],
      nyBuf[src],
      nzBuf[src],
      cave
    );
  }

  const stride = 7;
  const available = Math.floor(samples.length / stride);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const concavities = new Float32Array(count);
  if (!available) {
    return { positions, normals, concavities };
  }

  for (let i = 0; i < count; i++) {
    const pick = Math.floor(Math.random() * available) * stride;
    positions[i * 3] = samples[pick];
    positions[i * 3 + 1] = samples[pick + 1];
    positions[i * 3 + 2] = samples[pick + 2];
    normals[i * 3] = samples[pick + 3];
    normals[i * 3 + 1] = samples[pick + 4];
    normals[i * 3 + 2] = samples[pick + 5];
    concavities[i] = samples[pick + 6];
  }

  const box = new THREE.Box3().setFromArray(positions);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scaleXY = targetSize / maxDim;
  const scaleZ = scaleXY * 1.45;

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (positions[i * 3] - center.x) * scaleXY;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - center.y) * scaleXY;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - center.z) * scaleZ + 0.1;
  }

  return { positions, normals, concavities };
}

function createParticleSystem(facePositions, faceNormals, concavities) {
  const swirlPositions = sampleSwirlPositions(PARTICLE_COUNT);
  const swirlColors = new Float32Array(PARTICLE_COUNT * 3);
  const faceColors = new Float32Array(PARTICLE_COUNT * 3);
  const phases = new Float32Array(PARTICLE_COUNT);
  const lipUpper = new Float32Array(PARTICLE_COUNT);
  const lipLower = new Float32Array(PARTICLE_COUNT);

  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const y = facePositions[i * 3 + 1];
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const ySpan = Math.max(0.001, yMax - yMin);

  // Chin crease was ~0.20; under-nose was ~0.36 — lips sit midway
  const mouthY = yMin + ySpan * 0.28;

  // Estimate local mouth depth from nearby center particles
  let zAcc = 0;
  let zCount = 0;
  const xLim = ySpan * 0.1;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const x = facePositions[i * 3];
    const y = facePositions[i * 3 + 1];
    const z = facePositions[i * 3 + 2];
    if (Math.abs(x) > xLim) continue;
    if (Math.abs(y - mouthY) > ySpan * 0.04) continue;
    zAcc += z;
    zCount += 1;
  }
  const mouthDepth = zCount ? zAcc / zCount : 0;

  // Thin bands right on either side of the slit (between the lips)
  const lipHalfH = ySpan * 0.03;
  const lipHalfW = ySpan * 0.14;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    spectralColor(
      swirlPositions[i * 3],
      swirlPositions[i * 3 + 1],
      swirlPositions[i * 3 + 2],
      swirlColors,
      i
    );
    spectralColor(
      facePositions[i * 3],
      facePositions[i * 3 + 1],
      facePositions[i * 3 + 2],
      faceColors,
      i,
      {
        x: faceNormals[i * 3],
        y: faceNormals[i * 3 + 1],
        z: faceNormals[i * 3 + 2],
      },
      concavities ? concavities[i] : 0
    );
    phases[i] = Math.random() * Math.PI * 2;

    const x = facePositions[i * 3];
    const y = facePositions[i * 3 + 1];
    const z = facePositions[i * 3 + 2];
    lipUpper[i] = 0;
    lipLower[i] = 0;

    if (Math.abs(x) > lipHalfW * 1.15) continue;
    // Stay near the mouth depth — skip far-forward nose tip
    if (zCount && z > mouthDepth + ySpan * 0.09) continue;

    const dx = x / lipHalfW;
    const lateral = Math.exp(-dx * dx * 2.4);
    const dy = (y - mouthY) / lipHalfH;

    // Upper lip: only the strip just above the slit
    if (dy >= 0 && dy <= 1.15) {
      lipUpper[i] = lateral * Math.exp(-dy * dy * 3.5);
    }
    // Lower lip: only the strip just below the slit
    if (dy <= 0 && dy >= -1.25) {
      lipLower[i] = lateral * Math.exp(-dy * dy * 3.2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(swirlPositions, 3)
  );
  geometry.setAttribute("aTarget", new THREE.BufferAttribute(facePositions, 3));
  geometry.setAttribute("aNormal", new THREE.BufferAttribute(faceNormals, 3));
  geometry.setAttribute(
    "aSwirlColor",
    new THREE.BufferAttribute(swirlColors, 3)
  );
  geometry.setAttribute("aFaceColor", new THREE.BufferAttribute(faceColors, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aLipUpper", new THREE.BufferAttribute(lipUpper, 1));
  geometry.setAttribute("aLipLower", new THREE.BufferAttribute(lipLower, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uTalk: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aTarget;
      attribute vec3 aNormal;
      attribute vec3 aSwirlColor;
      attribute vec3 aFaceColor;
      attribute float aPhase;
      attribute float aLipUpper;
      attribute float aLipLower;

      uniform float uTime;
      uniform float uMorph;
      uniform float uTalk;
      uniform float uPixelRatio;

      varying vec3 vColor;
      varying float vAlpha;

      vec3 swirlMotion(vec3 p, float t) {
        float r = length(p);
        float angle = t * 0.35 + r * 1.8 + p.y * 1.2;
        float c = cos(angle);
        float s = sin(angle);
        mat2 rot = mat2(c, -s, s, c);
        vec3 q = p;
        q.xz = rot * q.xz;

        float fold = sin(q.x * 3.2 + t * 0.7) * cos(q.z * 2.8 - t * 0.5);
        q += normalize(q + 0.001) * fold * 0.12;
        q.y += sin(t * 0.6 + r * 4.0) * 0.06;
        return q;
      }

      vec3 faceAlive(vec3 p, float t, float phase) {
        vec3 origin = vec3(0.0, 0.02, 0.15);
        vec3 radial = normalize(p - origin + 0.0001);

        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 tangent = normalize(cross(radial, up));
        if (length(tangent) < 0.01) {
          tangent = normalize(cross(radial, vec3(1.0, 0.0, 0.0)));
        }
        vec3 bitangent = cross(radial, tangent);

        float breathe = sin(t * 1.55 + phase) * 0.016;
        float wave =
          sin(t * 2.4 + p.x * 7.5 + p.y * 5.5 + phase) * 0.02 +
          cos(t * 1.7 + p.y * 9.0 - p.z * 4.0) * 0.012;

        float flowA = t * 1.35 + phase + p.y * 4.0;
        float flowB = t * 1.1 + phase * 1.7 + p.x * 3.5;
        vec3 flow =
          tangent * sin(flowA) * 0.03 +
          bitangent * cos(flowB) * 0.022;

        vec3 flutter = vec3(
          sin(t * 3.1 + phase * 2.0 + p.y * 12.0),
          cos(t * 2.7 + phase + p.x * 10.0),
          sin(t * 2.3 - phase + p.z * 8.0)
        ) * 0.01;

        vec3 q = p + radial * (breathe * 0.35) + flow + flutter + radial * wave * 0.25;

        // Open the gap between the lips only
        float open = clamp(uTalk, 0.0, 1.0);
        q.y += aLipUpper * open * 0.038;
        q.y -= aLipLower * open * 0.048;
        q.z -= (aLipUpper + aLipLower) * open * 0.02;

        return q;
      }

      void main() {
        vec3 swirled = swirlMotion(position, uTime);
        vec3 faced = faceAlive(aTarget, uTime, aPhase);
        vec3 pos = mix(swirled, faced, uMorph);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        float size = mix(3.2, 1.85, uMorph);
        gl_PointSize = size * uPixelRatio * (2.4 / -mvPosition.z);

        vColor = mix(aSwirlColor, aFaceColor, uMorph);

        vec3 viewNormal = normalize(normalMatrix * aNormal);
        float facing = viewNormal.z;
        float frontMask = smoothstep(-0.55, 0.05, facing);
        float swirlAlpha = 0.55;
        float faceAlpha = 0.95 * frontMask;
        vAlpha = mix(swirlAlpha, faceAlpha, uMorph);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        if (vAlpha < 0.004) discard;

        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        if (d > 0.5) discard;

        float soft = smoothstep(0.5, 0.12, d);
        gl_FragColor = vec4(vColor, soft * vAlpha);
      }
    `,
  });

  return new THREE.Points(geometry, material);
}

// ---------------------------------------------------------------------------
// Interaction / render loop
// ---------------------------------------------------------------------------
let points = null;
let morphTarget = 0;
let morphCurrent = 0;
let morphLerp = 0.045;
const clock = new THREE.Clock();

const pointer = { x: 0, y: 0 };
const look = { yaw: 0, pitch: 0 };

let vision = null;
let visionBusy = false;
let visionReady = false;
let cameraPreview = null;
let cameraOk = false;
let voiceControl = null;

let speak = speakFn;
let stopSpeaking = stopSpeakingFn;
let logDetections = () => 0;
let downloadDatasetCSV = () => 0;
let getDataset = () => [];

let isTalking = false;
let talkAmount = 0;
let talkPulse = 0;

function speakSafely(text) {
  voiceControl?.pause();
  isTalking = true;
  talkPulse = 0.25;
  speak(text, {
    onStart: () => {
      isTalking = true;
    },
    onWord: (strength) => {
      // Snap mouth open on each word; vowel-heavy words open wider
      talkPulse = Math.max(talkPulse, 0.45 + strength * 0.55);
    },
    onEnd: () => {
      isTalking = false;
      talkPulse = 0;
      window.setTimeout(() => voiceControl?.resume(), 350);
    },
  });
}

window.addEventListener("pointermove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
});

function setHint(text) {
  if (hint) hint.textContent = text;
}

function voiceStatus(text) {
  // Don't let mic status wipe a real camera failure message
  if (!cameraOk && cameraPreview === null && /Listening/i.test(text)) {
    return;
  }
  setHint(text);
}

async function ensureCamera() {
  if (cameraOk && cameraPreview?.stream) return cameraPreview;
  const result = await startCameraPreview(document.getElementById("camera-feed"));
  cameraPreview = result;
  cameraOk = true;
  return result;
}

function isAwake() {
  return morphTarget > 0.5;
}

function wakeAvatar() {
  if (!points) return;
  const wasAwake = morphTarget > 0.5;
  morphTarget = 1;
  morphLerp = 0.045;
  setHint(
    visionReady
      ? 'Awake — ask "what do you see", or say "goodbye smart room"'
      : "Awake — camera still starting…"
  );
  if (!wasAwake) {
    speakSafely("Hello user.");
  }
}

function sleepAvatar() {
  if (!points) return;
  if (morphTarget < 0.5 && !isTalking) return;

  voiceControl?.pause();
  stopSpeaking();

  // Start dissolving while the goodbye trails into the tunnel
  morphTarget = 0;
  morphLerp = 0.012;
  isTalking = true;
  talkPulse = 0.35;
  setHint("Goodbye…");

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    isTalking = false;
    talkPulse = 0;
    morphLerp = 0.045;
    setHint('Listening… say "hello smart room"');
    window.setTimeout(() => voiceControl?.resume(), 400);
  };

  speakTunnelGoodbye({
    onStart: () => {
      isTalking = true;
    },
    onWord: (strength) => {
      talkPulse = Math.max(talkPulse, 0.35 + strength * 0.4);
    },
    onEnd: finish,
  });
}

async function handleWhatDoYouSee() {
  if (visionBusy) return;
  if (!visionReady) {
    const msg = "My camera is not ready yet. Please wait a moment.";
    setHint(msg);
    speakSafely(msg);
    return;
  }

  visionBusy = true;
  setHint("Looking…");
  try {
    const result = await vision.analyze();
    logDetections(result.detections);
    setHint(result.summary);
    speakSafely(result.summary);
  } catch (err) {
    console.error(err);
    const msg = "I had trouble seeing just now.";
    setHint(msg);
    speakSafely(msg);
  } finally {
    visionBusy = false;
  }
}

function handleDownloadDataset() {
  const n = getDataset().length;
  if (!n) {
    const msg = "There is no dataset yet. Ask me what I see first.";
    setHint(msg);
    speakSafely(msg);
    return;
  }
  downloadDatasetCSV();
  const msg = `Downloading dataset with ${n} rows.`;
  setHint(msg);
  speakSafely(msg);
}

// Click kept as a fallback if mic / speech isn't available
window.addEventListener("pointerdown", () => {
  if (!points) return;
  if (morphTarget > 0.5) sleepAvatar();
  else wakeAvatar();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (points) {
    points.material.uniforms.uPixelRatio.value = Math.min(
      window.devicePixelRatio,
      2
    );
  }
});

function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();

  if (points) {
    const mat = points.material;
    mat.uniforms.uTime.value = t;

    morphCurrent += (morphTarget - morphCurrent) * morphLerp;
    mat.uniforms.uMorph.value = morphCurrent;

    // Word-synced mouth: open fast on pulses, close between words
    talkPulse *= 0.9;
    const talkTarget = isTalking ? Math.max(0.04, talkPulse) : 0;
    const blend = talkTarget > talkAmount ? 0.45 : 0.18;
    talkAmount += (talkTarget - talkAmount) * blend;
    mat.uniforms.uTalk.value = talkAmount * morphCurrent;

    // Face tracks cursor; swirl keeps its own spin
    const targetYaw = pointer.x * 0.7;
    const targetPitch = pointer.y * 0.4;
    look.yaw += (targetYaw - look.yaw) * 0.085;
    look.pitch += (targetPitch - look.pitch) * 0.085;

    const swirlYaw = t * 0.08;
    const swirlPitch = Math.sin(t * 0.15) * 0.04;

    // Subtle nod on stronger mouth opens
    const talkNod = talkAmount * talkAmount * 0.012;

    points.rotation.y = THREE.MathUtils.lerp(swirlYaw, look.yaw, morphCurrent);
    points.rotation.x = THREE.MathUtils.lerp(
      swirlPitch,
      -look.pitch + talkNod,
      morphCurrent
    );
  }

  renderer.render(scene, camera);
}

animate();

// Click the preview to enable/retry camera (works even if auto-start fails)
wireCameraRetry(document.getElementById("camera-feed"), {
  onSuccess: (result) => {
    cameraPreview = result;
    cameraOk = true;
    setHint(
      visionReady
        ? 'Listening… say "hello smart room" · camera ready'
        : 'Camera on · loading the rest…'
    );
  },
  onError: (err) => {
    cameraOk = false;
    setHint(describeCameraError(err));
  },
});

// ---------------------------------------------------------------------------
// Load scan → front face mask → dense surface samples
// ---------------------------------------------------------------------------
const loader = new GLTFLoader();

setHint("Loading face scan…");

loader.load(
  FACE_MODEL_URL,
  (gltf) => {
    try {
      const allTris = collectTriangles(gltf.scene);
      const cropped = cropToFaceMask(allTris);
      const faceTris = keepFrontShell(cropped);

      if (!faceTris.length) {
        setHint("Face crop removed all geometry.");
        return;
      }

      const { positions, normals, concavities } = sampleFaceSurface(
        faceTris,
        PARTICLE_COUNT
      );
      points = createParticleSystem(positions, normals, concavities);
      scene.add(points);
    } catch (err) {
      console.error(err);
      setHint("Failed to build particle face.");
      return;
    }

    voiceControl = startVoiceWake({
      onWake: wakeAvatar,
      onSleep: sleepAvatar,
      onSee: handleWhatDoYouSee,
      onDownload: handleDownloadDataset,
      onStatus: voiceStatus,
      isAwake,
    });

    setHint('Listening… say "hello smart room" · starting camera…');

    // Camera + vision AFTER the swirl is on screen so the page never looks "stuck"
    (async () => {
      try {
        await ensureCamera();
        setHint('Listening… say "hello smart room" · camera on · loading vision…');
      } catch (err) {
        console.error(err);
        cameraOk = false;
        setHint(
          `${describeCameraError(err)} Click the black camera box to retry.`
        );
      }

      try {
        const [{ VisionSystem }, datasetMod] = await Promise.all([
          import("./vision.js"),
          import("./dataset.js"),
        ]);

        logDetections = datasetMod.logDetections;
        downloadDatasetCSV = datasetMod.downloadDatasetCSV;
        getDataset = datasetMod.getDataset;

        vision = new VisionSystem();
        await vision.init(cameraPreview || {});
        visionReady = true;
        cameraOk = true;

        if (isAwake()) {
          setHint('Awake — ask "what do you see", or say "goodbye smart room"');
        } else {
          setHint('Listening… say "hello smart room" · camera ready');
        }
      } catch (err) {
        console.error(err);
        setHint(
          cameraOk
            ? "Camera is on, but the vision model failed to load. Voice wake still works."
            : `${describeCameraError(err)} Click the black camera box to retry.`
        );
      }
    })();
  },
  (progress) => {
    if (!hint || !progress.total) return;
    const pct = Math.round((progress.loaded / progress.total) * 100);
    hint.textContent = `Loading face scan… ${pct}%`;
  },
  (err) => {
    console.error(err);
    setHint("Failed to load face scan. Check that public/models/LeePerrySmith.glb exists.");
  }
);
