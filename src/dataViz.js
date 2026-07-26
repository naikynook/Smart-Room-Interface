/**
 * Zoomable radial sunburst for RFW race → gender → age labels.
 * Colors follow the particle spectral HSL look (rainbow, high sat).
 */
import * as d3 from "d3";

const DATA_URL = `${import.meta.env.BASE_URL}data/rfw_gender_age_labels.csv`;

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

const host = document.getElementById("sunburst");
const breadcrumbEl = document.getElementById("breadcrumb");
const detailEl = document.getElementById("detail");
const rowCountEl = document.getElementById("row-count");

function parseRow(d) {
  const path = d.Path || d.path || "";
  return {
    race: path.split("/")[0] || "Unknown",
    gender: d.Gender || d.gender || "Unknown",
    ageCategory: String(d["Age Category"] ?? "").trim(),
  };
}

/** Match particle spectral palette — a bit brighter for night mode */
function spectralColor(t, depth = 1) {
  const hue = (t % 1 + 1) % 1;
  const sat = 0.7 + depth * 0.08;
  const light = 0.58 - depth * 0.05;
  return d3.hsl(hue * 360, sat, light).formatHex();
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

  // Drop empty leaves / branches
  for (const race of root.children) {
    for (const gender of race.children) {
      gender.children = gender.children.filter((c) => c.value > 0);
    }
    race.children = race.children.filter((c) => c.children.length > 0);
  }
  root.children = root.children.filter((c) => c.children.length > 0);

  return root;
}

function pathLabel(d) {
  const parts = d
    .ancestors()
    .map((n) => n.data.name)
    .reverse()
    .slice(1);
  return parts.length ? parts.join(" → ") : "All images";
}

function drawSunburst(hierarchyData) {
  host.innerHTML = "";

  const size = Math.min(host.clientWidth || 800, 860);
  const radius = size / 2;

  const root = d3
    .hierarchy(hierarchyData)
    .sum((d) => d.value || 0)
    .sort((a, b) => b.value - a.value);

  // Stable hue assignment by race order around the circle
  const raceHue = new Map(
    RACE_ORDER.map((name, i) => [name, (i + 0.15) / RACE_ORDER.length])
  );

  d3.partition().size([2 * Math.PI, root.height + 1])(root);

  root.each((d) => {
    d.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
  });

  const svg = d3
    .select(host)
    .append("svg")
    .attr("viewBox", `${-radius} ${-radius} ${size} ${size}`)
    .style("font", "9.5px Outfit, sans-serif");

  const g = svg.append("g");

  const arc = d3
    .arc()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .padAngle(0)
    .innerRadius((d) => (d.y0 * radius) / (root.height + 1))
    .outerRadius((d) => (d.y1 * radius) / (root.height + 1));

  function colorFor(d) {
    // Walk up to race (depth 1) for base hue, then shift by depth / sibling
    let raceNode = d;
    while (raceNode.depth > 1) raceNode = raceNode.parent;
    const base =
      raceNode.depth === 1
        ? raceHue.get(raceNode.data.name) ?? 0.5
        : 0.55;

    if (d.depth === 0) return "#161822";
    if (d.depth === 1) return spectralColor(base, 1);
    if (d.depth === 2) {
      const shift = d.data.name === "Female" ? -0.04 : 0.05;
      return spectralColor(base + shift, 2);
    }
    // Age leaves: fan slightly within the parent arc
    const siblings = d.parent?.children || [];
    const idx = Math.max(0, siblings.indexOf(d));
    const t = siblings.length > 1 ? idx / (siblings.length - 1) : 0.5;
    return spectralColor(base + (t - 0.5) * 0.12, 3);
  }

  let focus = root;

  const path = g
    .append("g")
    .selectAll("path")
    .data(root.descendants().slice(1))
    .join("path")
    .attr("fill", colorFor)
    .attr("fill-opacity", 0.95)
    .attr("d", (d) => arc(d.current))
    .style("cursor", "pointer")
    .on("click", clicked)
    .on("mouseenter", (_, d) => {
      detailEl.textContent = `${pathLabel(d)} · ${d3.format(",")(d.value)} images`;
    });

  path.append("title").text(
    (d) => `${pathLabel(d)}\n${d3.format(",")(d.value)} images`
  );

  const label = g
    .append("g")
    .attr("pointer-events", "none")
    .attr("text-anchor", "middle")
    .selectAll("text")
    .data(root.descendants().slice(1))
    .join("text")
    .attr("dy", "0.35em")
    .attr("fill-opacity", (d) => +labelVisible(d, d.current))
    .attr("transform", (d) => labelTransform(d.current))
    .text((d) => d.data.name);

  const parent = g
    .append("circle")
    .datum(root)
    .attr("r", radius / (root.height + 1))
    .attr("fill", "transparent")
    .attr("pointer-events", "all")
    .style("cursor", "pointer")
    .on("click", clicked);

  const centerText = g
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("fill", "#e8eaef")
    .style("font-size", "11px")
    .style("font-weight", "600")
    .style("font-family", "Outfit, sans-serif")
    .style("pointer-events", "none")
    .text("RFW");

  updateCaption(root);

  function clicked(event, p) {
    focus = p;
    parent.datum(p.parent || root);

    root.each((d) => {
      d.target = {
        x0:
          Math.max(0, Math.min(1, (d.x0 - p.x0) / (p.x1 - p.x0))) *
          2 *
          Math.PI,
        x1:
          Math.max(0, Math.min(1, (d.x1 - p.x0) / (p.x1 - p.x0))) *
          2 *
          Math.PI,
        y0: Math.max(0, d.y0 - p.depth),
        y1: Math.max(0, d.y1 - p.depth),
      };
    });

    const t = g.transition().duration(750);

    path
      .transition(t)
      .tween("data", (d) => {
        const i = d3.interpolate(d.current, d.target);
        return (t) => {
          d.current = i(t);
        };
      })
      .filter(function (d) {
        return +this.getAttribute("fill-opacity") || arcVisible(d.target);
      })
      .attr("fill-opacity", (d) =>
        arcVisible(d.target) ? (d.children ? 0.95 : 0.8) : 0
      )
      .attrTween("d", (d) => () => arc(d.current));

    label
      .filter(function (d) {
        return (
          +this.getAttribute("fill-opacity") || labelVisible(d, d.target)
        );
      })
      .transition(t)
      .attr("fill-opacity", (d) => +labelVisible(d, d.target))
      .attrTween("transform", (d) => () => labelTransform(d.current));

    centerText.text(p.depth === 0 ? "RFW" : p.data.name);
    updateCaption(p);
  }

  function arcVisible(d) {
    return d.y1 <= root.height + 1 && d.y0 >= 1 && d.x1 > d.x0;
  }

  /**
   * Overview: race + gender labels (hide age until zoomed).
   * Zoomed into a race: gender (+ age if wide enough).
   * Zoomed into a gender: age labels.
   */
  function labelVisible(node, geo) {
    if (!geo || geo.y1 > root.height + 1 || geo.y0 < 1 || geo.x1 <= geo.x0) {
      return false;
    }

    const angle = geo.x1 - geo.x0;
    const rel = node.depth - focus.depth;

    if (focus.depth === 0) {
      // First ring (race) + second ring (gender); no age yet
      if (node.depth === 1) return angle > 0.25;
      if (node.depth === 2) return angle > 0.12;
      return false;
    }

    if (focus.depth === 1) {
      if (rel !== 1 && !(node.depth === 3 && rel === 2)) return false;
      if (node.depth === 2) return angle > 0.2;
      if (node.depth === 3) return angle > 0.28;
      return false;
    }

    // Zoomed into gender (or deeper): show next ring only
    if (rel !== 1) return false;
    return angle > 0.18;
  }

  function labelTransform(d) {
    const x = (((d.x0 + d.x1) / 2) * 180) / Math.PI;
    const y = ((d.y0 + d.y1) / 2) * (radius / (root.height + 1));
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  function updateCaption(p) {
    breadcrumbEl.textContent = pathLabel(p);
    detailEl.textContent = `${d3.format(",")(p.value)} images`;
  }
}

async function main() {
  detailEl.textContent = "Loading dataset…";
  try {
    const raw = await d3.csv(DATA_URL, parseRow);
    const rows = raw.filter((d) => d.race && d.gender && d.ageCategory !== "");
    if (rowCountEl) rowCountEl.textContent = d3.format(",")(rows.length);
    const tree = buildHierarchy(rows);
    drawSunburst(tree);

    window.addEventListener("resize", () => {
      drawSunburst(tree);
    });
  } catch (err) {
    console.error(err);
    detailEl.textContent = "Failed to load dataset.";
  }
}

main();
