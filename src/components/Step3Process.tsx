import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import type { LoadedImage, ProcessedImage, SkuGroup } from "@/lib/imagekit";
import { downloadBlob, loadImageElement, processToSquare } from "@/lib/imagekit";

interface Props {
  images: LoadedImage[];
  groups: SkuGroup[];
  skippedIds: Set<string>;
}

export function Step3Process({ images, groups, skippedIds }: Props) {
  const byId = useRef(new Map(images.map((i) => [i.id, i])));
  byId.current = new Map(images.map((i) => [i.id, i]));

  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [processed, setProcessed] = useState<ProcessedImage[]>([]);
  const [zipping, setZipping] = useState(false);
  const [label, setLabel] = useState("");
  const startedRef = useRef(false);

  const validGroups = groups.filter(
    (g) => g.han.trim() && g.imageIds.some((id) => !skippedIds.has(id)),
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setProcessing(true);
    setDone(false);
    const all: ProcessedImage[] = [];
    const total = validGroups.reduce((acc, g) => {
      const bases = new Set<string>();
      for (const id of g.imageIds) {
        if (skippedIds.has(id)) continue;
        const src = byId.current.get(id);
        if (!src) continue;
        bases.add(src.filename.replace(/\.[^.]+$/, "").toLowerCase());
      }
      return acc + bases.size;
    }, 0);
    setProgress({ done: 0, total, label: "" });

    let i = 0;
    for (const g of validGroups) {
      const han = g.han.trim();

      // Dedupe by basename (filename without extension, lowercased).
      // If the same basename appears as both .png and .jpg, keep the JPG (or
      // whichever was added last). This prevents duplicate processed outputs.
      const byBase = new Map<string, string>(); // basename -> imageId
      for (const id of g.imageIds) {
        if (skippedIds.has(id)) continue;
        const src = byId.current.get(id);
        if (!src) continue;
        const base = src.filename.replace(/\.[^.]+$/, "").toLowerCase();
        const existingId = byBase.get(base);
        if (!existingId) {
          byBase.set(base, id);
          continue;
        }
        const existing = byId.current.get(existingId)!;
        const existingIsJpg = /\.jpe?g$/i.test(existing.filename);
        const currentIsJpg = /\.jpe?g$/i.test(src.filename);
        // Prefer JPG; otherwise keep the later one (current).
        if (!existingIsJpg && currentIsJpg) byBase.set(base, id);
        else if (existingIsJpg && !currentIsJpg) {
          /* keep existing */
        } else byBase.set(base, id);
      }
      const uniqueIds = Array.from(byBase.values());

      let seq = 0;
      for (const id of uniqueIds) {
        const src = byId.current.get(id);
        if (!src) continue;
        seq++;
        i++;
        setProgress({ done: i, total, label: `${han}_${seq}.jpg` });
        try {
          const el = await loadImageElement(src.url);
          const blob = await processToSquare(el, 1000, src.bg === "white");
          const url = URL.createObjectURL(blob);
          all.push({
            id: `${han}-${seq}`,
            han,
            filename: `${han}_${seq}.jpg`,
            blob,
            url,
          });
        } catch (err) {
          console.error(`Failed to process ${src.filename}:`, err);
        }
      }
    }

    setProcessed(all);
    setProcessing(false);
    setDone(true);
  };

  const buildExportName = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;
    const trimmed = label.trim();
    return trimmed ? `${date} ${trimmed} converted` : `${date} converted`;
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      const name = buildExportName();
      const folder = zip.folder(name);
      if (!folder) throw new Error("Failed to create folder");
      for (const p of processed) folder.file(p.filename, p.blob);
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${name}.zip`);
    } catch (e) {
      console.error(e);
      alert("Failed to build ZIP. Please try again.");
    } finally {
      setZipping(false);
    }
  };

  const downloadCsv = () => {
    const maxImages = Math.max(0, ...Object.values(grouped).map((items) => items.length));
    const header = ["han", ...Array.from({ length: maxImages }, (_, i) => `Bild${i + 1}`)].join(";");
    const lines: string[] = [header];
    // Group processed by HAN preserving order from validGroups
    const groupedFiles = new Map<string, string[]>();
    for (const p of processed) {
      if (!groupedFiles.has(p.han)) groupedFiles.set(p.han, []);
      groupedFiles.get(p.han)!.push(p.filename);
    }
    for (const g of validGroups) {
      const han = g.han.trim();
      const files = groupedFiles.get(han) ?? [];
      if (files.length === 0) continue;
      const cells = Array.from({ length: maxImages }, (_, i) => files[i] ?? "");
      lines.push([han, ...cells].join(";"));
    }
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "jtl_import.csv");
  };

  // Group processed for grid display
  const grouped: Record<string, ProcessedImage[]> = {};
  for (const p of processed) {
    grouped[p.han] = grouped[p.han] || [];
    grouped[p.han].push(p);
  }

  const summary = validGroups
    .map((g) => {
      const han = g.han.trim();
      const files = (grouped[han] ?? []).map((p) => p.filename);
      return { han, count: files.length, files };
    })
    .filter((r) => r.count > 0);

  const maxImages = Math.max(0, ...summary.map((r) => r.count));

  return (
    <div className="fade-in space-y-6">
      {processing && (
        <div className="rounded-md border border-border bg-surface p-5">
          <div className="mb-3 flex items-center justify-between font-mono text-xs">
            <span>
              Processing image {progress.done} of {progress.total}…
            </span>
            <span className="text-muted-foreground">{progress.label}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {done && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/30 bg-success/5 px-4 py-3">
            <span className="font-mono text-xs text-success">
              ✅ Done · {processed.length} images processed across {Object.keys(grouped).length} groups
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="add label..."
                className="h-9 w-44 rounded-md border border-border bg-surface px-3 font-mono text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={downloadZip}
                disabled={zipping || processed.length === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {zipping ? "Building ZIP…" : "⬬ Download Images (ZIP)"}
              </button>
              <button
                type="button"
                onClick={downloadCsv}
                disabled={summary.length === 0}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-elevated disabled:opacity-40"
              >
                ⬬ Download CSV (JTL Import)
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {Object.entries(grouped).map(([han, items]) => (
              <div key={han}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{han}</span>
                  <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {items.length} imgs
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((p) => {
                    const kib = p.blob.size / 1024;
                    const outOfRange = kib < 50 || kib > 250;
                    const sizeStr = `${kib.toFixed(0)} KiB`;
                    return (
                      <div
                        key={p.id}
                        className="rounded-md border border-border bg-surface p-2"
                      >
                        <div className="aspect-square overflow-hidden rounded bg-white">
                          <img src={p.url} alt={p.filename} className="h-full w-full object-contain" />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                          <div className="truncate font-mono text-[11px]" title={p.filename}>
                            {p.filename}
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                              outOfRange
                                ? "bg-warning/10 text-warning"
                                : "text-muted-foreground"
                            }`}
                            title={outOfRange ? "Out of 50–250 KiB range" : "File size"}
                          >
                            {outOfRange ? `⚠ ${sizeStr}` : sizeStr}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <table className="w-full">
              <thead className="bg-surface-elevated">
                <tr className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 text-left">HAN</th>
                  <th className="px-3 py-2 text-left">Processed</th>
                  {Array.from({ length: maxImages }, (_, i) => (
                    <th key={i} className="px-3 py-2 text-left">{`Bild${i + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-xs">
                {summary.map((r) => (
                  <tr key={r.han}>
                    <td className="px-3 py-2 font-semibold">{r.han}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.count}</td>
                    {Array.from({ length: maxImages }, (_, i) => (
                      <td key={i} className="px-3 py-2">{r.files[i] ?? ""}</td>
                    ))}
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={2 + maxImages} className="px-3 py-6 text-center text-muted-foreground">
                      Nothing to export
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
