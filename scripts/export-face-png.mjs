/**
 * Export a 4000×4000 transparent PNG of the particle face.
 * Run: node scripts/export-face-png.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "exports");
const outPath = path.join(outDir, "face-pointcloud.png");

const server = await createServer({
  root: rootDir,
  configFile: path.join(rootDir, "vite.config.js"),
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
});

await server.listen();
const port = server.config.server.port;
const url = `http://127.0.0.1:${port}/?exportFace=1`;

console.log(`Serving ${url}`);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 4000, height: 4000 },
    deviceScaleFactor: 1,
  });

  page.on("console", (msg) => console.log(`[browser] ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[pageerror] ${err}`));

  await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });

  await page.waitForFunction(
    () => window.__FACE_EXPORT_READY__ === true,
    null,
    { timeout: 180_000 }
  );

  const result = await page.evaluate(() => ({
    dataUrl: window.__FACE_EXPORT_DATA_URL__ || null,
    error: window.__FACE_EXPORT_ERROR__ || null,
  }));

  if (result.error) {
    throw new Error(`Face export failed in browser: ${result.error}`);
  }
  if (!result.dataUrl?.startsWith("data:image/png")) {
    throw new Error("No PNG data URL produced by the face export.");
  }

  const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(base64, "base64"));

  const stats = fs.statSync(outPath);
  console.log(`Wrote ${outPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
} finally {
  await browser.close();
  await server.close();
}
