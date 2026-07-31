/**
 * RFW hierarchy viz â€” zoomable sunburst + radial cluster tree.
 * Lavender â†’ blue â†’ teal â†’ mint; hierarchy is race â†’ gender â†’ age.
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

const sunburstHost = document.getElementById("sunburst");
const radialHost = document.getElementById("radial");
const breadcrumbEl = document.getElementById("breadcrumb");
const detailEl = document.getElementById("detail");
const radialBreadcrumbEl = document.getElementById("radial-breadcrumb");
const radialDetailEl = document.getElementById("radial-detail");
const rowCountEl = document.getElementById("row-count");

function parseRow(d) {
  const path = d.Path || d.path || "";
  return {
    race: path.split("/")[0] || "Unknown",
    gender: d.Gender || d.gender || "Unknown",
    ageCategory: String(d["Age Category"] ?? "").trim(),
  };
}

/** Moderate saturation lavender â†’ blue â†’ teal â†’ mint */
function sunburstFill(d) {
  const mid = (d.x0 + d.x1) / 2;
  const t = ((mid / (2 * Math.PI)) % 1 + 1) % 1;
  const hue = 290 - t * 145;
  const sat = 0.48 + 0.06 * Math.sin(t * Math.PI * 2);
  const light =
    d.depth === 1 ? 0.54 : d.depth === 2 ? 0.6 : d.depth === 3 ? 0.66 : 0.5;
  return d3.hsl(hue, sat, light).formatHex();
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

function pathLabel(d) {
  const parts = d
    .ancestors()
    .map((n) => n.data.name)
    .reverse()
    .slice(1);
  return parts.length ? parts.join(" â†’ ") : "All images";
}

function chartSize(host) {
  return Math.min(host.clientWidth || 800, 860);
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

function drawSunburst(hierarchyData) {
  sunburstHost.innerHTML = "";

  const size = chartSize(sunburstHost);
  const radius = size / 2;
  const hole = 0.16;

  const root = d3
    .hierarchy(hierarchyData)
    .sum((d) => d.value || 0)
    .sort((a, b) => b.value - a.value);

  d3.partition().size([2 * Math.PI, root.height + 1])(root);

  const ringDepth = root.height + 1;
  const maxLeaf = d3.max(root.leaves(), (d) => d.value) || 1;

  root.each((d) => {
    d.current = { x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1 };
  });

  function ringInner(d) {
    return radius * (hole + (1 - hole) * (d.y0 / ringDepth));
  }

  function ringOuter(d) {
    let r = radius * (hole + (1 - hole) * (d.y1 / ringDepth));
    if (d.depth === root.height && !d.children) {
      const t = d.value / maxLeaf;
      r *= 0.84 + 0.16 * t;
    }
    return Math.max(ringInner(d) + 0.5, r);
  }

  const svg = d3
    .select(sunburstHost)
    .append("svg")
    .attr("viewBox", `${-radius} ${-radius} ${size} ${size}`)
    .style("font", "9.5px Outfit, sans-serif");

  const g = svg.append("g");

  const arc = d3
    .arc()
    .startAngle((d) => d.x0)
    .endAngle((d) => d.x1)
    .padAngle(0.0015)
    .padRadius(radius * 0.5)
    .innerRadius((d) => ringInner(d))
    .outerRadius((d) => ringOuter(d));

  let focus = root;

  const path = g
    .append("g")
    .selectAll("path")
    .data(root.descendants().slice(1))
    .join("path")
    .attr("fill", sunburstFill)
    .attr("fill-opacity", 1)
    .attr("stroke-width", (d) => (d.depth >= root.height ? 0.2 : 0.45))
    .attr("d", (d) => arc(d.current))
    .style("cursor", "pointer")
    .on("click", clicked)
    .on("mouseenter", (_, d) => {
      breadcrumbEl.textContent = pathLabel(d);
      detailEl.textContent = `${d3.format(",")(d.value)} images`;
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
    .attr("r", radius * hole)
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
      .attr("fill-opacity", (d) => (arcVisible(d.target) ? 1 : 0))
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

  function labelVisible(node, geo) {
    if (!geo || geo.y1 > root.height + 1 || geo.y0 < 1 || geo.x1 <= geo.x0) {
      return false;
    }

    const angle = geo.x1 - geo.x0;
    const rel = node.depth - focus.depth;

    if (focus.depth === 0) {
      if (node.depth === 1) return true;
      if (node.depth === 2) {
        if (
          node.data.name === "Female" &&
          node.parent?.data.name === "African"
        ) {
          return true;
        }
        return angle > 0.12;
      }
      return false;
    }

    if (focus.depth === 1) {
      if (rel !== 1 && !(node.depth === 3 && rel === 2)) return false;
      if (node.depth === 2) return angle > 0.2;
      if (node.depth === 3) return angle > 0.28;
      return false;
    }

    if (rel !== 1) return false;
    return angle > 0.18;
  }

  function labelTransform(d) {
    const x = (((d.x0 + d.x1) / 2) * 180) / Math.PI;
    const y =
      radius * (hole + (1 - hole) * ((d.y0 + d.y1) / 2 / ringDepth));
    return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
  }

  function updateCaption(p) {
    breadcrumbEl.textContent = pathLabel(p);
    detailEl.textContent = `${d3.format(",")(p.value)} images`;
  }
}

/**
 * Radial cluster tree â€” same hierarchy as the sunburst.
 * Depth rings: race â†’ gender â†’ age; all nodes sized by share of dataset.
 */
function drawRadialTree(hierarchyData) {
  radialHost.innerHTML = "";

  const size = chartSize(radialHost);
  const radius = size / 2 - 56;

  const root = d3
    .hierarchy(hierarchyData)
    .sum((d) => d.value || 0)
    .sort(hierarchySort);

  d3.cluster().size([2 * Math.PI, radius])(root);

  // One scale for every depth: area âˆ share of full dataset (and each other)
  const total = root.value || 1;
  const sizeK = 40;
  function nodeRadius(d) {
    if (d.depth === 0) return 7;
    return Math.max(3.5, sizeK * Math.sqrt(d.value / total));
  }

  const svg = d3
    .select(radialHost)
    .append("svg")
    .attr("viewBox", `${-size / 2} ${-size / 2} ${size} ${size}`)
    .attr("aria-label", "Radial hierarchy tree");

  const linkRadial = d3
    .linkRadial()
    .angle((d) => d.x)
    .radius((d) => d.y);

  const links = svg
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(root.links())
    .join("path")
    .attr("class", "link")
    .attr("d", linkRadial);

  const node = svg
    .append("g")
    .selectAll("g")
    .data(root.descendants())
    .join("g")
    .attr("class", "node")
    .attr(
      "transform",
      (d) => `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y},0)`
    );

  node
    .append("circle")
    .attr("r", nodeRadius)
    .attr("fill", (d) => (d.depth === 0 ? "#2a2d38" : raceTint(d)))
    .attr("fill-opacity", (d) => (d.depth === 0 ? 0.9 : 0.92))
    .on("mouseenter", (_, d) => highlight(d))
    .on("mouseleave", clearHighlight);

  node.append("title").text((d) => {
    const pct = ((100 * d.value) / total).toFixed(1);
    return `${pathLabel(d)}\n${d3.format(",")(d.value)} images (${pct}%)`;
  });

  // Race labels: horizontal, directly below each race node
  svg
    .append("g")
    .attr("class", "race-labels")
    .selectAll("text")
    .data(root.children || [])
    .join("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "hanging")
    .attr("fill", "#e8eaef")
    .attr("font-size", "8px")
    .attr("font-weight", 500)
    .attr("font-family", "Outfit, sans-serif")
    .attr("x", (d) => Math.sin(d.x) * d.y)
    .attr("y", (d) => -Math.cos(d.x) * d.y + nodeRadius(d) + 4)
    .text((d) => d.data.name);

  // Gender labels: same ring angle/radius as the node, shifted sideways
  svg
    .append("g")
    .attr("class", "gender-labels")
    .selectAll("text")
    .data(root.descendants().filter((d) => d.depth === 2))
    .join("text")
    .attr("dy", "0.32em")
    .attr("text-anchor", "middle")
    .attr("fill", "#e8eaef")
    .attr("font-size", "8px")
    .attr("font-weight", 500)
    .attr("font-family", "Outfit, sans-serif")
    .attr("transform", (d) => {
      const side = nodeRadius(d) + 10;
      const deg = (d.x * 180) / Math.PI - 90;
      const flip = d.x >= Math.PI;
      // Tangential offset so label sits beside the node, not on it
      const y = flip ? -side : side;
      return `rotate(${deg}) translate(${d.y},${y})${flip ? " rotate(180)" : ""}`;
    })
    .text((d) => d.data.name);

  // Age labels outside leaves
  node
    .filter((d) => d.depth >= 3)
    .append("text")
    .attr("dy", "0.32em")
    .attr("x", (d) => (d.x < Math.PI ? 12 : -12))
    .attr("text-anchor", (d) => (d.x < Math.PI ? "start" : "end"))
    .attr("transform", (d) => (d.x >= Math.PI ? "rotate(180)" : null))
    .style("font-size", "8px")
    .style("font-weight", 500)
    .text((d) => d.data.name);

  function highlight(d) {
    const keep = new Set(d.ancestors().concat(d.descendants()));
    node.classed("is-dim", (n) => !keep.has(n));
    links
      .classed("is-active", (l) => keep.has(l.source) && keep.has(l.target))
      .classed("is-dim", (l) => !(keep.has(l.source) && keep.has(l.target)));

    const pct = ((100 * d.value) / total).toFixed(1);
    radialBreadcrumbEl.textContent = pathLabel(d);
    radialDetailEl.textContent = `${d3.format(",")(d.value)} images Â· ${pct}% of dataset`;
  }

  function clearHighlight() {
    node.classed("is-dim", false);
    links.classed("is-active", false).classed("is-dim", false);
    radialBreadcrumbEl.textContent = "Race â†’ Gender â†’ Age";
    radialDetailEl.textContent = "Hover a node";
  }
}

async function main() {
  detailEl.textContent = "Loading dataset…";
  try {
    const raw = await d3.csv(DATA_URL, parseRow);
    const rows = raw.filter((d) => d.race && d.gender && d.ageCategory !== "");
    if (rowCountEl) rowCountEl.textContent = d3.format(",")(rows.length);
    const tree = buildHierarchy(rows);

    const render = () => {
      drawSunburst(tree);
      drawRadialTree(tree);
    };
    render();

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 150);
    });
  } catch (err) {
    console.error(err);
    detailEl.textContent = "Failed to load dataset.";
  }
}

main();

