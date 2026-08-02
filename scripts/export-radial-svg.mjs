/**
 * Export a high-resolution PNG of the radial hierarchy tree (2nd viz).
 * Run: node scripts/export-radial-svg.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const csvPath = path.join(rootDir, "public", "data", "rfw_gender_age_labels.csv");
const outPath = path.join(rootDir, "exports", "rfw-radial-tree.png");

const AGE_LABELS = {
  0: "Youth",
  1: "Young adult",
  2: "Adult",
  3: "Mid-age",
  4: "Older adult",
  5: "Senior",
};
const RACE_ORDER = ["African", "Asian", "Caucasian", "Indian"];
const GENDER_ORDER = ["Female", "Male"];
const AGE_ORDER = ["0", "1", "2", "3", "4", "5"];

const SIZE = 4000;
/** Keep diagram inset so larger labels stay inside the frame */
const MARGIN = 600;
const RADIUS = SIZE / 2 - MARGIN;
const FONT = "Outfit, 'Segoe UI', system-ui, sans-serif";
const SCALE = SIZE / 860;
const NODE_BOOST = 1.65;
const LINK_STROKE = 2.85;
/** Base label size (was 8×SCALE) */
const LABEL_SIZE = 10.5 * SCALE;
/** Outward pad past leaf node edge for age text */
const AGE_LABEL_PAD = 26;
/** Side clearance for gender labels */
const GENDER_SIDE_PAD = 14;
/** Below-node clearance for race labels */
const RACE_BELOW_PAD = 8;

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function paletteAt(t, light = 0.58) {
  const u = Math.min(1, Math.max(0, t));
  return d3.hsl(290 - u * 145, 0.5, light).formatHex();
}

function raceTint(d) {
  let race = d;
  while (race && race.depth > 1) race = race.parent;
  if (!race || race.depth === 0) return paletteAt(0.45, 0.7);
  const t =
    RACE_ORDER.indexOf(race.data.name) / Math.max(1, RACE_ORDER.length - 1);
  const light = d.depth === 1 ? 0.54 : d.depth === 2 ? 0.6 : 0.68;
  return paletteAt(Math.max(0, t), light);
}

function parseCsv(text) {
  const rows = d3.csvParse(text, (d) => {
    const p = d.Path || d.path || "";
    return {
      race: p.split("/")[0] || "Unknown",
      gender: d.Gender || d.gender || "Unknown",
      ageCategory: String(d["Age Category"] ?? "").trim(),
    };
  });
  return rows.filter((d) => d.race && d.gender && d.ageCategory !== "");
}

function buildHierarchy(rows) {
  const root = { name: "RFW", children: [] };
  const raceMap = new Map();
  for (const race of RACE_ORDER) {
    const node = { name: race, children: [] };
    raceMap.set(race, node);
    root.children.push(node);
  }
  const genderMaps = new Map();
  for (const race of RACE_ORDER) {
    const gMap = new Map();
    genderMaps.set(race, gMap);
    for (const gender of GENDER_ORDER) {
      const gNode = { name: gender, children: [] };
      gMap.set(gender, gNode);
      raceMap.get(race).children.push(gNode);
      for (const age of AGE_ORDER) {
        gNode.children.push({
          name: AGE_LABELS[age] || age,
          ageKey: age,
          value: 0,
        });
      }
    }
  }
  for (const row of rows) {
    if (!raceMap.has(row.race)) continue;
    if (!GENDER_ORDER.includes(row.gender)) continue;
    if (!AGE_ORDER.includes(row.ageCategory)) continue;
    const gNode = genderMaps.get(row.race).get(row.gender);
    const leaf = gNode.children.find((c) => c.ageKey === row.ageCategory);
    if (leaf) leaf.value += 1;
  }
  for (const race of root.children) {
    for (const gender of race.children) {
      gender.children = gender.children.filter((c) => c.value > 0);
    }
    race.children = race.children.filter((c) => c.children.length > 0);
  }
  root.children = root.children.filter((c) => c.children.length > 0);
  return root;
}

function hierarchySort(a, b) {
  if (a.depth === 1) {
    return RACE_ORDER.indexOf(a.data.name) - RACE_ORDER.indexOf(b.data.name);
  }
  if (a.depth === 2) {
    return (
      GENDER_ORDER.indexOf(a.data.name) - GENDER_ORDER.indexOf(b.data.name)
    );
  }
  return AGE_ORDER.indexOf(a.data.ageKey) - AGE_ORDER.indexOf(b.data.ageKey);
}

async function exportPng() {
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(csvText);
  const hierarchyData = buildHierarchy(rows);

  const root = d3
    .hierarchy(hierarchyData)
    .sum((d) => d.value || 0)
    .sort(hierarchySort);

  d3.cluster().size([2 * Math.PI, RADIUS])(root);

  const total = root.value || 1;
  const sizeK = 40 * SCALE * NODE_BOOST;
  function nodeRadius(d) {
    if (d.depth === 0) return 7 * SCALE * NODE_BOOST;
    const base = Math.max(4.5 * SCALE, sizeK * Math.sqrt(d.value / total));
    // Race nodes ~5% smaller than prior export boost
    if (d.depth === 1) return base * 1.045;
    return base;
  }

  const linkRadial = d3
    .linkRadial()
    .angle((d) => d.x)
    .radius((d) => d.y);

  const labelSize = LABEL_SIZE;
  const parts = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}" role="img" aria-label="RFW radial hierarchy tree">`
  );
  parts.push(
    `<rect x="${-SIZE / 2}" y="${-SIZE / 2}" width="${SIZE}" height="${SIZE}" fill="#0b0c10"/>`
  );

  parts.push(
    `<g fill="none" stroke="rgba(180,190,220,0.42)" stroke-width="${LINK_STROKE * SCALE}" stroke-linecap="round" stroke-linejoin="round">`
  );
  for (const l of root.links()) {
    parts.push(`<path d="${escapeXml(linkRadial(l))}"/>`);
  }
  parts.push(`</g>`);

  parts.push(`<g>`);
  for (const d of root.descendants()) {
    const rot = (d.x * 180) / Math.PI - 90;
    const fill = d.depth === 0 ? "#2a2d38" : raceTint(d);
    const opacity = d.depth === 0 ? 0.9 : 0.92;
    parts.push(
      `<g transform="rotate(${rot}) translate(${d.y},0)"><circle r="${nodeRadius(d)}" fill="${fill}" fill-opacity="${opacity}" stroke="#0b0c10" stroke-width="${0.75 * SCALE}"/></g>`
    );
  }
  parts.push(`</g>`);

  // Race labels (horizontal, below nodes)
  parts.push(`<g font-family="${FONT}" font-size="${labelSize}" font-weight="500" fill="#e8eaef">`);
  for (const d of root.children || []) {
    const x = Math.sin(d.x) * d.y;
    const y = -Math.cos(d.x) * d.y + nodeRadius(d) + RACE_BELOW_PAD * SCALE;
    parts.push(
      `<text text-anchor="middle" dominant-baseline="hanging" x="${x}" y="${y}">${escapeXml(d.data.name)}</text>`
    );
  }
  parts.push(`</g>`);

  // Gender labels beside nodes
  parts.push(`<g font-family="${FONT}" font-size="${labelSize}" font-weight="500" fill="#e8eaef">`);
  for (const d of root.descendants().filter((n) => n.depth === 2)) {
    const side = nodeRadius(d) + GENDER_SIDE_PAD * SCALE;
    const deg = (d.x * 180) / Math.PI - 90;
    const flip = d.x >= Math.PI;
    const y = flip ? -side : side;
    const transform = `rotate(${deg}) translate(${d.y},${y})${flip ? " rotate(180)" : ""}`;
    parts.push(
      `<text dy="0.32em" text-anchor="middle" transform="${transform}">${escapeXml(d.data.name)}</text>`
    );
  }
  parts.push(`</g>`);

  // Age labels — clear of nodes; diagram inset keeps them in frame
  parts.push(`<g font-family="${FONT}" font-size="${labelSize}" font-weight="500" fill="#e8eaef">`);
  for (const d of root.leaves()) {
    const rot = (d.x * 180) / Math.PI - 90;
    const flip = d.x >= Math.PI;
    const pad = nodeRadius(d) + AGE_LABEL_PAD * SCALE;
    const x = flip ? -pad : pad;
    const anchor = flip ? "end" : "start";
    const transform = `rotate(${rot}) translate(${d.y},0)${flip ? " rotate(180)" : ""}`;
    parts.push(
      `<text dy="0.32em" x="${x}" text-anchor="${anchor}" transform="${transform}">${escapeXml(d.data.name)}</text>`
    );
  }
  parts.push(`</g>`);
  parts.push(`</svg>`);

  const svg = parts.join("");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 6 })
    .toFile(outPath);

  console.log(`Wrote ${outPath}`);
  console.log(`Size: ${SIZE}×${SIZE} · ${d3.format(",")(rows.length)} rows`);
}

exportPng().catch((err) => {
  console.error(err);
  process.exit(1);
});
