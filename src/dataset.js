/**
 * In-memory detection log + CSV download.
 */

const rows = [];

export function logDetections(detections) {
  for (const d of detections) {
    rows.push({
      timestamp: d.timestamp ?? Date.now(),
      object: d.object,
      confidence: d.confidence ?? "",
      color: d.color ?? "",
    });
  }
  return rows.length;
}

export function getDataset() {
  return rows.slice();
}

export function clearDataset() {
  rows.length = 0;
}

export function downloadDatasetCSV(filename = "smart-room-dataset.csv") {
  const header = "timestamp,iso_time,object,confidence,color";
  const lines = rows.map((r) => {
    const iso = new Date(r.timestamp).toISOString();
    const obj = String(r.object).replaceAll('"', '""');
    const color = String(r.color ?? "").replaceAll('"', '""');
    return `${r.timestamp},${iso},"${obj}",${r.confidence},"${color}"`;
  });
  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
